const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('./db');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 8 }
}));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

/* ---------- ADMIN AUTH ---------- */
// Create admin user on first run (username: admin, password: admin123) — change immediately
const ADMIN_USER = 'admin';
const ADMIN_HASH = bcrypt.hashSync('admin123', 10);

function requireAdmin(req, res, next) {
  if (req.session.admin) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && bcrypt.compareSync(password, ADMIN_HASH)) {
    req.session.admin = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Invalid credentials' });
});
app.post('/api/admin/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/admin/me', requireAdmin, (req, res) => res.json({ ok: true }));

/* ---------- PUBLIC STATS ---------- */
app.get('/api/stats', (req, res) => {
  const get = k => db.prepare('SELECT value FROM stats WHERE key=?').get(k)?.value || 0;
  res.json({
    week_joins: get('week_joins'),
    total_joins: get('total_joins'),
    reward_downloads: get('reward_downloads'),
    testimonials_count: db.prepare('SELECT COUNT(*) c FROM testimonials WHERE approved=1').get().c
  });
});

/* ---------- RECORD REAL JOIN CLICK ---------- */
// Called when user actually clicks "Join WhatsApp Channel" — real, not fake
app.post('/api/join-click', (req, res) => {
  const { source } = req.body;
  db.prepare('INSERT INTO join_clicks (source) VALUES (?)').run(source || 'unknown');
  db.prepare('UPDATE stats SET value=value+1 WHERE key=?').run('week_joins');
  db.prepare('UPDATE stats SET value=value+1 WHERE key=?').run('total_joins');
  res.json({ ok: true });
});

/* ---------- TESTIMONIALS ---------- */
app.get('/api/testimonials', (req, res) => {
  res.json(db.prepare('SELECT id,name,text,exam FROM testimonials WHERE approved=1 ORDER BY id DESC LIMIT 6').all());
});
app.post('/api/testimonials', (req, res) => {
  // Public submit — goes to pending queue
  const { name, text, exam } = req.body;
  if (!name || !text) return res.status(400).json({ error: 'name and text required' });
  db.prepare('INSERT INTO testimonials (name,text,exam,approved) VALUES (?,?,?,0)').run(name, text, exam || null);
  res.json({ ok: true, message: 'Submitted for review' });
});

/* ---------- REWARDS (public read, admin write) ---------- */
app.get('/api/rewards', (req, res) => {
  res.json(db.prepare('SELECT id,title,description,exam,file_path,link FROM rewards WHERE active=1 ORDER BY id DESC').all());
});
app.post('/api/reward-download', (req, res) => {
  db.prepare('UPDATE stats SET value=value+1 WHERE key=?').run('reward_downloads');
  res.json({ ok: true });
});

/* ---------- ADMIN: TESTIMONIALS ---------- */
app.get('/api/admin/testimonials', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM testimonials ORDER BY id DESC').all());
});
app.post('/api/admin/testimonials', requireAdmin, (req, res) => {
  const { name, text, exam, approved } = req.body;
  const r = db.prepare('INSERT INTO testimonials (name,text,exam,approved) VALUES (?,?,?,?)')
    .run(name, text, exam || null, approved ? 1 : 0);
  res.json({ id: r.lastInsertRowid });
});
app.patch('/api/admin/testimonials/:id', requireAdmin, (req, res) => {
  const { approved } = req.body;
  db.prepare('UPDATE testimonials SET approved=? WHERE id=?').run(approved ? 1 : 0, req.params.id);
  res.json({ ok: true });
});
app.delete('/api/admin/testimonials/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM testimonials WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

/* ---------- ADMIN: REWARDS ---------- */
app.get('/api/admin/rewards', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM rewards ORDER BY id DESC').all());
});
app.post('/api/admin/rewards', requireAdmin, upload.single('file'), (req, res) => {
  const { title, description, exam, link } = req.body;
  const file_path = req.file ? '/uploads/' + req.file.filename : null;
  const r = db.prepare('INSERT INTO rewards (title,description,exam,file_path,link,active) VALUES (?,?,?,?,?,1)')
    .run(title, description || null, exam || null, file_path, link || null);
  res.json({ id: r.lastInsertRowid });
});
app.patch('/api/admin/rewards/:id', requireAdmin, (req, res) => {
  const { active } = req.body;
  db.prepare('UPDATE rewards SET active=? WHERE id=?').run(active ? 1 : 0, req.params.id);
  res.json({ ok: true });
});
app.delete('/api/admin/rewards/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT file_path FROM rewards WHERE id=?').get(req.params.id);
  if (row?.file_path) fs.unlink(path.join(__dirname, row.file_path), () => {});
  db.prepare('DELETE FROM rewards WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

/* ---------- ADMIN: STATS ---------- */
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const get = k => db.prepare('SELECT value FROM stats WHERE key=?').get(k)?.value || 0;
  res.json({
    week_joins: get('week_joins'),
    total_joins: get('total_joins'),
    reward_downloads: get('reward_downloads'),
    pending_testimonials: db.prepare('SELECT COUNT(*) c FROM testimonials WHERE approved=0').get().c,
    join_clicks_24h: db.prepare("SELECT COUNT(*) c FROM join_clicks WHERE created_at > datetime('now','-1 day')").get().c
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('EduGrowth running on http://localhost:' + PORT));
