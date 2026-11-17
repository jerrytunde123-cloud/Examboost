const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('[db] DATABASE_URL is not set. Add your Postgres connection string to .env (Neon, Supabase or Vercel Postgres).');
}

const local = /localhost|127\.0\.0\.1/.test(connectionString || '');

const pool = new Pool({
  connectionString,
  max: 5,
  ssl: connectionString && !local ? { rejectUnauthorized: false } : undefined
});

let initPromise = null;

async function init() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS stats (
        key TEXT PRIMARY KEY,
        value INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS testimonials (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        text TEXT NOT NULL,
        exam TEXT,
        approved INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS rewards (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        exam TEXT,
        file_path TEXT,
        link TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        images JSONB NOT NULL DEFAULT '[]'::jsonb,
        slug TEXT UNIQUE
      );

      CREATE TABLE IF NOT EXISTS join_clicks (
        id SERIAL PRIMARY KEY,
        source TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    for (const key of ['week_joins', 'total_joins', 'reward_downloads']) {
      await pool.query('INSERT INTO stats (key, value) VALUES ($1, 0) ON CONFLICT (key) DO NOTHING', [key]);
    }

    const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM testimonials');
    if (rows[0].c === 0) {
      await pool.query(
        `INSERT INTO testimonials (name, text, exam, approved) VALUES
         ($1,$2,$3,1),($4,$5,$6,1),($7,$8,$9,1)`,
        [
          'Adeola M.', 'The JAMB past questions here are the exact format. Scored 298. Thank you!', 'JAMB',
          'Chiamaka O.', 'Got my WAEC syllabus breakdown — helped me plan my reading. Legit service.', 'WAEC',
          'Ibrahim S.', 'NECO answers were well explained, not just answers. Worth sharing.', 'NECO'
        ]
      );
    }
  })();
  return initPromise;
}

module.exports = { pool, init, query: (text, params) => pool.query(text, params) };
