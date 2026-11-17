/**
 * One-time migration: copy content from the old SQLite file (edu.db) into Postgres.
 * Usage:  npm run import
 * Requires DATABASE_URL in .env. If BLOB_READ_WRITE_TOKEN is set, local uploads
 * are pushed to Vercel Blob and their URLs are rewritten.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const SQLITE_FILE = path.join(ROOT, 'edu.db');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is missing. Add it to .env first.');
    process.exit(1);
  }
  if (!fs.existsSync(SQLITE_FILE)) {
    console.error('No edu.db found — nothing to import.');
    process.exit(1);
  }

  const { pool, init } = require('../db');
  await init();

  const sqlite = new DatabaseSync(SQLITE_FILE, { readOnly: true });
  const all = sql => { try { return sqlite.prepare(sql).all(); } catch (e) { return []; } };

  const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;
  let put;
  if (useBlob) ({ put } = require('@vercel/blob'));

  async function migrateFile(p) {
    if (!p || /^https?:\/\//i.test(p)) return p;
    const local = path.join(ROOT, p.replace(/^\//, ''));
    if (!fs.existsSync(local)) { console.warn('  missing file on disk:', p); return null; }
    if (!useBlob) return p;
    const { url } = await put('rewards/' + path.basename(local), fs.readFileSync(local), {
      access: 'public',
      addRandomSuffix: false,
      token: process.env.BLOB_READ_WRITE_TOKEN
    });
    console.log('  uploaded', path.basename(local), '->', url);
    return url;
  }

  // stats
  for (const row of all('SELECT key, value FROM stats')) {
    await pool.query(
      'INSERT INTO stats (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
      [row.key, row.value]
    );
  }
  console.log('stats copied');

  // testimonials
  const testis = all('SELECT name, text, exam, approved, created_at FROM testimonials');
  for (const t of testis) {
    await pool.query(
      'INSERT INTO testimonials (name, text, exam, approved, created_at) VALUES ($1,$2,$3,$4,COALESCE($5::timestamptz, now()))',
      [t.name, t.text, t.exam, t.approved, t.created_at]
    );
  }
  console.log(`testimonials copied: ${testis.length}`);

  // rewards
  const rewards = all('SELECT * FROM rewards');
  for (const r of rewards) {
    let images = [];
    try { images = JSON.parse(r.images || '[]'); } catch (e) { images = []; }
    if (!images.length && r.file_path) images = [r.file_path];

    const migrated = [];
    for (const img of images) {
      const next = await migrateFile(img);
      if (next) migrated.push(next);
    }

    await pool.query(
      `INSERT INTO rewards (title, description, exam, file_path, link, active, images, slug, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,COALESCE($9::timestamptz, now()))`,
      [r.title, r.description, r.exam, migrated[0] || null, r.link, r.active,
        JSON.stringify(migrated), r.slug, r.created_at]
    );
    console.log(`reward copied: ${r.title} (${migrated.length} files)`);
  }

  console.log('\nDone. Open the site and check your content.');
  await pool.end();
}

main().catch(err => { console.error('Import failed:', err); process.exit(1); });
