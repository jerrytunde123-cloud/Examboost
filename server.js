const dotenv = require('dotenv');
// .env.local is what `vercel env pull` writes; .env is the fallback for local use
for (const file of ['.env.local', '.env']) {
  dotenv.config({ path: require('path').join(__dirname, file) });
}

const express = require('express');
const session = require('express-session');
const PgStore = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { pool, init, query } = require('./db');

const app = express();
const MAX_REWARD_FILES = 30;
const SHARE_GOAL = 5;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const PUBLIC_DIR = path.join(__dirname, 'public');
const USE_BLOB = !!process.env.BLOB_READ_WRITE_TOKEN;
const { put, del } = require('@vercel/blob');

const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.set('trust proxy', 1);
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

app.use(session({
  store: new PgStore({ pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'change-this-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: !!process.env.VERCEL,
    maxAge: 1000 * 60 * 60 * 8
  }
}));

/* ---------- HEALTH CHECK: tells you which piece is missing ---------- */
app.get('/api/health', ah(async (req, res) => {
  const out = {
    on_vercel: !!process.env.VERCEL,
    database_url: !!process.env.DATABASE_URL,
    blob_token: !!process.env.BLOB_READ_WRITE_TOKEN,
    session_secret: !!process.env.SESSION_SECRET,
    db_reachable: false
  };
  try {
    await query('SELECT 1');
    out.db_reachable = true;
  } catch (e) {
    out.db_error = e.message;
  }
  res.status(out.db_reachable ? 200 : 503).json(out);
}));

// Ensures tables exist before the first request on a cold start
app.use(ah(async (req, res, next) => { await init(); next(); }));

// Local development only — Vercel serves public/ from its CDN instead
app.use(express.static(PUBLIC_DIR));
app.use('/uploads', express.static(UPLOAD_DIR));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: MAX_REWARD_FILES,
    fieldSize: 10 * 1024 * 1024
  }
});

/* ---------- FILE STORAGE (Vercel Blob, local disk as fallback) ---------- */
function safeName(original) {
  const raw = path.extname(original || '');
  const ext = /^\.[a-z0-9]{1,6}$/i.test(raw) ? raw.toLowerCase() : '';
  return Date.now() + '-' + Math.random().toString(16).slice(2, 10) + ext;
}

async function saveFile(file) {
  const name = safeName(file.originalname);
  if (USE_BLOB) {
    const { url } = await put('rewards/' + name, file.buffer, {
      access: 'public',
      contentType: file.mimetype || 'application/octet-stream',
      addRandomSuffix: false,
      token: process.env.BLOB_READ_WRITE_TOKEN
    });
    return url;
  }
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, name), file.buffer);
  return '/uploads/' + name;
}

async function saveFiles(files) {
  const out = [];
  for (const f of files || []) out.push(await saveFile(f));
  return out;
}

async function deleteFile(url) {
  if (!url) return;
  try {
    if (/^https?:\/\//i.test(url)) {
      if (USE_BLOB) await del(url, { token: process.env.BLOB_READ_WRITE_TOKEN });
    } else {
      fs.unlink(path.join(__dirname, url), () => {});
    }
  } catch (e) { /* already gone */ }
}

async function deleteFiles(list) {
  for (const url of list || []) await deleteFile(url);
}

/* ---------- ADMIN AUTH ---------- */
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_HASH = process.env.ADMIN_PASSWORD_HASH || bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin123', 10);

function requireAdmin(req, res, next) {
  if (req.session.admin) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && bcrypt.compareSync(password || '', ADMIN_HASH)) {
    req.session.admin = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Invalid credentials' });
});
app.post('/api/admin/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/admin/me', requireAdmin, (req, res) => res.json({ ok: true }));

/* ---------- PUBLIC STATS ---------- */
app.get('/api/stats', ah(async (req, res) => {
  const { rows: stats } = await query('SELECT key, value FROM stats');
  const map = Object.fromEntries(stats.map(r => [r.key, Number(r.value)]));
  const { rows: t } = await query('SELECT COUNT(*)::int AS c FROM testimonials WHERE approved=1');
  res.json({
    week_joins: map.week_joins || 0,
    total_joins: map.total_joins || 0,
    reward_downloads: map.reward_downloads || 0,
    testimonials_count: t[0].c
  });
}));

/* ---------- RECORD REAL JOIN CLICK ---------- */
app.post('/api/join-click', ah(async (req, res) => {
  const { source } = req.body;
  const tasks = req.session.tasks || (req.session.tasks = { joined: false, shares: 0 });
  tasks.joined = true;
  await query('INSERT INTO join_clicks (source) VALUES ($1)', [source || 'unknown']);
  await query("UPDATE stats SET value = value + 1 WHERE key IN ('week_joins','total_joins')");
  res.json({ ok: true, ...unlockState(req) });
}));

/* ---------- TASK PROGRESS: join + 5 shares unlock the content ---------- */
function unlockState(req) {
  const tasks = req.session.tasks || {};
  const shares = Math.min(SHARE_GOAL, Number(tasks.shares) || 0);
  const joined = !!tasks.joined;
  return { joined, shares, needed: SHARE_GOAL, unlocked: joined && shares >= SHARE_GOAL };
}

app.post('/api/share-click', (req, res) => {
  const tasks = req.session.tasks || (req.session.tasks = { joined: false, shares: 0 });
  tasks.shares = Math.min(SHARE_GOAL, (Number(tasks.shares) || 0) + 1);
  res.json(unlockState(req));
});

app.get('/api/unlock', (req, res) => {
  res.json(req.session.admin ? { ...unlockState(req), unlocked: true, admin: true } : unlockState(req));
});

/* ---------- TESTIMONIALS ---------- */
app.get('/api/testimonials', ah(async (req, res) => {
  const { rows } = await query('SELECT id, name, text, exam FROM testimonials WHERE approved=1 ORDER BY id DESC LIMIT 6');
  res.json(rows);
}));
app.post('/api/testimonials', ah(async (req, res) => {
  const { name, text, exam } = req.body;
  if (!name || !text) return res.status(400).json({ error: 'name and text required' });
  await query('INSERT INTO testimonials (name, text, exam, approved) VALUES ($1,$2,$3,0)', [name, text, exam || null]);
  res.json({ ok: true, message: 'Submitted for review' });
}));

/* ---------- REWARDS (public read) ---------- */
function withImages(row) {
  if (!row) return row;
  let images = row.images;
  if (typeof images === 'string') { try { images = JSON.parse(images); } catch (e) { images = []; } }
  if (!Array.isArray(images)) images = [];
  if (!images.length && row.file_path) images = [row.file_path];
  return { ...row, images };
}

// Public list: names only, the full content lives on the permalink page
app.get('/api/rewards', ah(async (req, res) => {
  const { rows } = await query('SELECT * FROM rewards WHERE active=1 ORDER BY id DESC');
  res.json(rows.map(withImages).map(r => ({
    id: r.id, title: r.title, exam: r.exam, slug: r.slug,
    files: r.images.length, created_at: r.created_at
  })));
}));

app.get('/api/rewards/:slug', ah(async (req, res) => {
  const { rows } = await query('SELECT * FROM rewards WHERE slug=$1 AND active=1', [req.params.slug]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });

  const state = unlockState(req);
  if (!state.unlocked && !req.session.admin) {
    // Locked: send the title only so the page can name what is waiting,
    // never the description, files or external link.
    return res.status(403).json({
      error: 'locked',
      title: rows[0].title,
      exam: rows[0].exam,
      files: withImages(rows[0]).images.length,
      ...state
    });
  }

  res.json(withImages(rows[0]));
}));

app.post('/api/reward-download', ah(async (req, res) => {
  await query("UPDATE stats SET value = value + 1 WHERE key = 'reward_downloads'");
  res.json({ ok: true });
}));

/* ---------- ADMIN: TESTIMONIALS ---------- */
app.get('/api/admin/testimonials', requireAdmin, ah(async (req, res) => {
  const { rows } = await query('SELECT * FROM testimonials ORDER BY id DESC');
  res.json(rows);
}));
app.post('/api/admin/testimonials', requireAdmin, ah(async (req, res) => {
  const { name, text, exam, approved } = req.body;
  const { rows } = await query(
    'INSERT INTO testimonials (name, text, exam, approved) VALUES ($1,$2,$3,$4) RETURNING id',
    [name, text, exam || null, approved ? 1 : 0]
  );
  res.json({ id: rows[0].id });
}));
app.patch('/api/admin/testimonials/:id', requireAdmin, ah(async (req, res) => {
  const { approved } = req.body;
  await query('UPDATE testimonials SET approved=$1 WHERE id=$2', [approved ? 1 : 0, req.params.id]);
  res.json({ ok: true });
}));
app.put('/api/admin/testimonials/:id', requireAdmin, ah(async (req, res) => {
  const { rows } = await query('SELECT * FROM testimonials WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  const row = rows[0];
  const { name, text, exam, approved } = req.body;
  await query('UPDATE testimonials SET name=$1, text=$2, exam=$3, approved=$4 WHERE id=$5', [
    name === undefined ? row.name : name,
    text === undefined ? row.text : text,
    exam === undefined ? row.exam : (exam || null),
    approved === undefined ? row.approved : (approved ? 1 : 0),
    req.params.id
  ]);
  res.json({ ok: true });
}));
app.delete('/api/admin/testimonials/:id', requireAdmin, ah(async (req, res) => {
  await query('DELETE FROM testimonials WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

/* ---------- PERMALINK SLUGS ---------- */
function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'content';
}

async function uniqueSlug(base, excludeId) {
  let slug = base, i = 2;
  for (;;) {
    const { rows } = await query('SELECT id FROM rewards WHERE slug=$1', [slug]);
    if (!rows.length || String(rows[0].id) === String(excludeId)) return slug;
    slug = `${base}-${i++}`;
  }
}

/* ---------- ADMIN: REWARDS ---------- */
app.get('/api/admin/rewards', requireAdmin, ah(async (req, res) => {
  const { rows } = await query('SELECT * FROM rewards ORDER BY id DESC');
  res.json(rows.map(withImages));
}));

app.post('/api/admin/rewards', requireAdmin, upload.array('files', MAX_REWARD_FILES), ah(async (req, res) => {
  const { title, description, exam, link } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });
  const files = await saveFiles(req.files);
  const slug = await uniqueSlug(slugify(title));
  const { rows } = await query(
    `INSERT INTO rewards (title, description, exam, file_path, link, active, images, slug)
     VALUES ($1,$2,$3,$4,$5,1,$6::jsonb,$7) RETURNING id`,
    [title, description || null, exam || null, files[0] || null, link || null, JSON.stringify(files), slug]
  );
  res.json({ id: rows[0].id, images: files, slug });
}));

app.put('/api/admin/rewards/:id', requireAdmin, ah(async (req, res) => {
  const { rows } = await query('SELECT * FROM rewards WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  const row = rows[0];
  const { title, description, exam, link, slug } = req.body;
  const newSlug = (slug === undefined || slug === null || String(slug).trim() === '')
    ? row.slug
    : await uniqueSlug(slugify(slug), row.id);
  await query(
    'UPDATE rewards SET title=$1, description=$2, exam=$3, link=$4, slug=$5 WHERE id=$6',
    [
      title === undefined ? row.title : title,
      description === undefined ? row.description : (description || null),
      exam === undefined ? row.exam : (exam || null),
      link === undefined ? row.link : (link || null),
      newSlug,
      req.params.id
    ]
  );
  res.json({ ok: true, slug: newSlug });
}));

app.post('/api/admin/rewards/:id/images', requireAdmin, upload.array('files', MAX_REWARD_FILES), ah(async (req, res) => {
  const { rows } = await query('SELECT * FROM rewards WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  const current = withImages(rows[0]).images;
  const incoming = await saveFiles(req.files);
  const allowed = Math.max(0, MAX_REWARD_FILES - current.length);
  const kept = incoming.slice(0, allowed);
  const ignored = incoming.length - kept.length;
  if (ignored > 0) await deleteFiles(incoming.slice(allowed));
  const merged = current.concat(kept);
  await query('UPDATE rewards SET images=$1::jsonb, file_path=COALESCE(file_path,$2) WHERE id=$3',
    [JSON.stringify(merged), merged[0] || null, req.params.id]);
  res.json({ ok: true, images: merged, count: merged.length, ignored });
}));

app.delete('/api/admin/rewards/:id/images/:index', requireAdmin, ah(async (req, res) => {
  const { rows } = await query('SELECT * FROM rewards WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  const images = withImages(rows[0]).images;
  const i = parseInt(req.params.index, 10);
  if (!(i >= 0 && i < images.length)) return res.status(400).json({ error: 'Bad index' });
  const [removed] = images.splice(i, 1);
  await deleteFile(removed);
  await query('UPDATE rewards SET images=$1::jsonb, file_path=$2 WHERE id=$3',
    [JSON.stringify(images), images[0] || null, req.params.id]);
  res.json({ ok: true, images });
}));

app.patch('/api/admin/rewards/:id', requireAdmin, ah(async (req, res) => {
  const { active } = req.body;
  await query('UPDATE rewards SET active=$1 WHERE id=$2', [active ? 1 : 0, req.params.id]);
  res.json({ ok: true });
}));

app.delete('/api/admin/rewards/:id', requireAdmin, ah(async (req, res) => {
  const { rows } = await query('SELECT * FROM rewards WHERE id=$1', [req.params.id]);
  if (rows.length) await deleteFiles(withImages(rows[0]).images);
  await query('DELETE FROM rewards WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

/* ---------- ADMIN: STATS ---------- */
app.get('/api/admin/stats', requireAdmin, ah(async (req, res) => {
  const { rows: stats } = await query('SELECT key, value FROM stats');
  const map = Object.fromEntries(stats.map(r => [r.key, Number(r.value)]));
  const { rows: pending } = await query('SELECT COUNT(*)::int AS c FROM testimonials WHERE approved=0');
  const { rows: clicks } = await query("SELECT COUNT(*)::int AS c FROM join_clicks WHERE created_at > now() - interval '1 day'");
  res.json({
    week_joins: map.week_joins || 0,
    total_joins: map.total_joins || 0,
    reward_downloads: map.reward_downloads || 0,
    pending_testimonials: pending[0].c,
    join_clicks_24h: clicks[0].c
  });
}));

/* ---------- PUBLIC PERMALINK PAGE: domain.com/necogce-maths ---------- */
const PERMALINK_SHELL = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Loading… — EduBoost</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Segoe UI',Arial,sans-serif;background:#0b3d2e;color:#fff;min-height:100vh}
.top-banner{background:#ffcc00;color:#000;text-align:center;padding:12px;font-weight:bold;font-size:.95rem;border-bottom:4px solid #000}
.container{max-width:540px;margin:0 auto;padding:20px}.card{background:#fff;color:#222;border-radius:14px;padding:22px;margin-bottom:18px;box-shadow:0 6px 20px rgba(0,0,0,.35)}
h1{font-size:1.25rem;color:#0b3d2e;margin-bottom:6px;line-height:1.35}.exam{display:inline-block;background:#e8f5e9;color:#008751;font-size:.72rem;padding:3px 8px;border-radius:6px;font-weight:bold;margin-bottom:12px}
.desc{font-size:.95rem;color:#333;white-space:pre-wrap;line-height:1.55;margin-bottom:14px}.gallery{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}
.gallery a{line-height:0}.gallery img{width:108px;height:108px;object-fit:cover;border-radius:8px;border:1px solid #e0e0e0}
.btn{display:inline-block;background:#008751;color:#fff;padding:11px 16px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:.9rem;margin:0 8px 8px 0}
.btn-ghost{background:#0b3d2e}.note{font-size:.85rem;color:#666}.back{display:inline-block;margin-bottom:14px;color:#ffd700;text-decoration:none;font-size:.9rem;font-weight:bold}
.footer{text-align:center;font-size:.78rem;color:#cfd8d3;margin:8px 0 20px}</style></head><body>
<div class="top-banner">🎓 FREE WAEC / NECO / JAMB PREP MATERIAL — 100% LEGITIMATE EDUCATIONAL SERVICE</div>
<div class="container"><a class="back" href="/">← Back to all content</a><div class="card" id="content"><p class="note">Loading…</p></div>
<p class="footer">EduBoost — real educational service. No payment required.</p></div>
<script src="/js/reward.js"></script></body></html>`;

app.get('/:slug', ah(async (req, res, next) => {
  const slug = req.params.slug;
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return next();
  const { rows } = await query('SELECT id FROM rewards WHERE slug=$1 AND active=1', [slug]);
  if (!rows.length) return next();
  const file = path.join(PUBLIC_DIR, 'reward.html');
  if (fs.existsSync(file)) return res.sendFile(file);
  res.type('html').send(PERMALINK_SHELL);
}));

/* ---------- ERROR HANDLING ---------- */
app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'A file is larger than 50 MB.' });
  if (err && err.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ error: `Too many files — ${MAX_REWARD_FILES} maximum.` });
  if (err && err.code === 'LIMIT_FIELD_VALUE') return res.status(413).json({ error: 'A text field is too large.' });
  if (err && err.code === 'LIMIT_UNEXPECTED_FILE') return res.status(400).json({ error: 'Unexpected file field.' });
  console.error('[error]', err);
  if (err) return res.status(500).json({ error: 'Server error' });
  next();
});

const PORT = process.env.PORT || 3000;
if (!process.env.VERCEL) {
  init()
    .then(() => app.listen(PORT, () => console.log('EduGrowth running on http://localhost:' + PORT)))
    .catch(err => {
      console.error('[fatal] Database not reachable:', err.message);
      console.error('Set DATABASE_URL in .env — see .env.example');
      process.exit(1);
    });
}

module.exports = app;
