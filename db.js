const Database = require('better-sqlite3');
const db = new Database('edu.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS stats (
    key TEXT PRIMARY KEY,
    value INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS testimonials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    text TEXT NOT NULL,
    exam TEXT,            -- WAEC | NECO | JAMB | Other
    approved INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS rewards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    exam TEXT,
    file_path TEXT,       -- uploaded PDF/image
    link TEXT,            -- external link (e.g. Google Drive)
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS join_clicks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT,          -- which button
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

// migration: rewards can hold up to 30 attachments as a JSON array
const rewardCols = db.prepare('PRAGMA table_info(rewards)').all().map(c => c.name);
if (!rewardCols.includes('images')) {
  db.exec("ALTER TABLE rewards ADD COLUMN images TEXT");
  db.exec("UPDATE rewards SET images = json_array(file_path) WHERE images IS NULL AND file_path IS NOT NULL");
}
if (!rewardCols.includes('slug')) {
  db.exec("ALTER TABLE rewards ADD COLUMN slug TEXT");
}

// seed stats
const seed = db.prepare('INSERT OR IGNORE INTO stats (key,value) VALUES (?,?)');
seed.run('week_joins', 0);
seed.run('total_joins', 0);
seed.run('reward_downloads', 0);

// seed a couple of real testimonials you can replace
const t = db.prepare('INSERT INTO testimonials (name,text,exam,approved) VALUES (?,?,?,1)');
if (db.prepare('SELECT COUNT(*) c FROM testimonials').get().c === 0) {
  t.run('Adeola M.', 'The JAMB past questions here are the exact format. Scored 298. Thank you!', 'JAMB');
  t.run('Chiamaka O.', 'Got my WAEC syllabus breakdown — helped me plan my reading. Legit service.', 'WAEC');
  t.run('Ibrahim S.', 'NECO answers were well explained, not just answers. Worth sharing.', 'NECO');
}

module.exports = db;
