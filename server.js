const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('./db');

const app = express();
const MAX_REWARD_FILES = 30;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const raw = path.extname(file.originalname || '');
    const ext = /^\.[a-z0-9]{1,6}$/i.test(raw) ? raw.toLowerCase() : '';
    cb(null, Date.now() + '-' + Math.random().toString(16).slice(2, 10) + ext);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024,      // 50 MB per file
    files: MAX_REWARD_FILES,          // 30 files per upload
    fieldSize: 10 * 1024 * 1024       // 10 MB per text field (long descriptions)
  }
});

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
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
// A reward can carry up to 30 attachments stored as a JSON array in rewards.images
function withImages(row) {
  if (!row) return row;
  let images = [];
  if (row.images) { try { images = JSON.parse(row.images) || []; } catch (e) { images = []; } }
  if (!Array.isArray(images)) images = [];
  if (!images.length && row.file_path) images = [row.file_path];
  return { ...row, images };
}
function unlinkFiles(list) {
  (list || []).forEach(p => { if (p) fs.unlink(path.join(__dirname, p), () => {}); });
}

/* ---------- PERMALINK SLUGS ---------- */
function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'content';
}
function uniqueSlug(base, excludeId) {
  let slug = base, i = 2;
  for (;;) {
    const row = db.prepare('SELECT id FROM rewards WHERE slug=?').get(slug);
    if (!row || row.id === excludeId) return slug;
    slug = `${base}-${i++}`;
  }
}
// Give every existing reward a permalink on startup
for (const r of db.prepare("SELECT id,title FROM rewards WHERE slug IS NULL OR slug=''").all()) {
  db.prepare('UPDATE rewards SET slug=? WHERE id=?').run(uniqueSlug(slugify(r.title)), r.id);
}

// Public list: names only (the full content lives on the permalink page)
app.get('/api/rewards', (req, res) => {
  res.json(db.prepare('SELECT * FROM rewards WHERE active=1 ORDER BY id DESC').all()
    .map(withImages)
    .map(r => ({
      id: r.id,
      title: r.title,
      exam: r.exam,
      slug: r.slug,
      files: r.images.length,
      created_at: r.created_at
    })));
});

// Public detail for one piece of content
app.get('/api/rewards/:slug', (req, res) => {
  const row = db.prepare('SELECT * FROM rewards WHERE slug=? AND active=1').get(req.params.slug);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(withImages(row));
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
app.put('/api/admin/testimonials/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM testimonials WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const { name, text, exam, approved } = req.body;
  db.prepare('UPDATE testimonials SET name=?, text=?, exam=?, approved=? WHERE id=?').run(
    name === undefined ? row.name : name,
    text === undefined ? row.text : text,
    exam === undefined ? row.exam : (exam || null),
    approved === undefined ? row.approved : (approved ? 1 : 0),
    req.params.id
  );
  res.json({ ok: true });
});
app.delete('/api/admin/testimonials/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM testimonials WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

/* ---------- ADMIN: REWARDS ---------- */
app.get('/api/admin/rewards', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM rewards ORDER BY id DESC').all().map(withImages));
});

// Upload a new reward with up to 30 files
app.post('/api/admin/rewards', requireAdmin, upload.array('files', MAX_REWARD_FILES), (req, res) => {
  const { title, description, exam, link } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });
  const files = (req.files || []).map(f => '/uploads/' + f.filename);
  const slug = uniqueSlug(slugify(title));
  const r = db.prepare('INSERT INTO rewards (title,description,exam,file_path,link,active,images,slug) VALUES (?,?,?,?,?,1,?,?)')
    .run(title, description || null, exam || null, files[0] || null, link || null, JSON.stringify(files), slug);
  res.json({ id: r.lastInsertRowid, images: files, slug });
});

// Edit any text field of a reward (description has no length limit)
app.put('/api/admin/rewards/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM rewards WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const { title, description, exam, link, slug } = req.body;
  const newSlug = slug === undefined || slug === null || String(slug).trim() === ''
    ? row.slug
    : uniqueSlug(slugify(slug), row.id);
  db.prepare('UPDATE rewards SET title=?, description=?, exam=?, link=?, slug=? WHERE id=?').run(
    title === undefined ? row.title : title,
    description === undefined ? row.description : (description || null),
    exam === undefined ? row.exam : (exam || null),
    link === undefined ? row.link : (link || null),
    newSlug,
    req.params.id
  );
  res.json({ ok: true, slug: newSlug });
});

// Add more attachments to an existing reward (total capped at 30)
app.post('/api/admin/rewards/:id/images', requireAdmin, upload.array('files', MAX_REWARD_FILES), (req, res) => {
  const row = db.prepare('SELECT * FROM rewards WHERE id=?').get(req.params.id);
  if (!row) { unlinkFiles((req.files || []).map(f => '/uploads/' + f.filename)); return res.status(404).json({ error: 'Not found' }); }
  const current = withImages(row).images;
  const incoming = (req.files || []).map(f => '/uploads/' + f.filename);
  const allowed = Math.max(0, MAX_REWARD_FILES - current.length);
  const merged = current.concat(incoming.slice(0, allowed));
  const ignored = incoming.length - Math.min(incoming.length, allowed);
  if (ignored > 0) unlinkFiles(incoming.slice(allowed));
  db.prepare('UPDATE rewards SET images=?, file_path=COALESCE(file_path, ?) WHERE id=?')
    .run(JSON.stringify(merged), merged[0] || null, req.params.id);
  res.json({ ok: true, images: merged, count: merged.length, ignored });
});

// Remove one attachment from a reward
app.delete('/api/admin/rewards/:id/images/:index', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM rewards WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const images = withImages(row).images;
  const i = parseInt(req.params.index, 10);
  if (!(i >= 0 && i < images.length)) return res.status(400).json({ error: 'Bad index' });
  const [removed] = images.splice(i, 1);
  unlinkFiles([removed]);
  db.prepare('UPDATE rewards SET images=?, file_path=? WHERE id=?')
    .run(JSON.stringify(images), images[0] || null, req.params.id);
  res.json({ ok: true, images });
});

app.patch('/api/admin/rewards/:id', requireAdmin, (req, res) => {
  const { active } = req.body;
  db.prepare('UPDATE rewards SET active=? WHERE id=?').run(active ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/admin/rewards/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM rewards WHERE id=?').get(req.params.id);
  if (row) unlinkFiles(withImages(row).images);
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

/* ---------- PUBLIC PERMALINK PAGE: domain.com/necogce-maths ---------- */
app.get('/:slug', (req, res, next) => {
  const slug = req.params.slug;
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return next();
  const row = db.prepare('SELECT id FROM rewards WHERE slug=? AND active=1').get(slug);
  if (!row) return next();
  res.sendFile(path.join(__dirname, 'public', 'reward.html'));
});

/* ---------- ERROR HANDLING (uploads, oversized fields) ---------- */
app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'A file is larger than 50 MB.' });
  if (err && err.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ error: `Too many files — ${MAX_REWARD_FILES} maximum.` });
  if (err && err.code === 'LIMIT_FIELD_VALUE') return res.status(413).json({ error: 'A text field is too large.' });
  if (err && err.code === 'LIMIT_UNEXPECTED_FILE') return res.status(400).json({ error: 'Unexpected file field.' });
  if (err) return res.status(500).json({ error: err.message || 'Server error' });
  next();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('EduGrowth running on http://localhost:' + PORT));
