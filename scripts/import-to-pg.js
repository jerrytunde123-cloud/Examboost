/**
 * One-time migration: copy content from the old SQLite file (edu.db) into Postgres.
 * Usage:  npm run import
 * Requires DATABASE_URL in .env. If BLOB_READ_WRITE_TOKEN is set, local uploads
 * are pushed to Vercel Blob and their URLs are rewritten.
 */
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');

// .env.local is what `vercel env pull` writes; .env is the local fallback
for (const file of ['.env.local', '.env']) {
  dotenv.config({ path: path.join(ROOT, file) });
}

const SQLITE_FILE = path.join(ROOT, 'edu.db');

async function main() {
  const force = process.argv.includes('--force');

  if (!process.env.DATABASE_URL) {
    console.error([
      'DATABASE_URL is missing.',
      '',
      'Create a file named .env.local in the project root containing:',
      '  DATABASE_URL=postgresql://...',
      '  BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...',
      '  SESSION_SECRET=any-long-random-string',
      '',
      'Or run:  npx.cmd vercel@latest env pull .env.local'
    ].join('\n'));
    process.exit(1);
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error([
      'BLOB_READ_WRITE_TOKEN is missing.',
      '',
      'Without it the images would be copied as "/uploads/..." paths that only',
      'exist on this computer — they would 404 on Vercel. Add the token to',
      '.env.local (Vercel → Storage → your Blob store → .env.local tab).',
      '',
      'If you really want a local-only import, re-run with:  --force'
    ].join('\n'));
    if (!force) process.exit(1);
  }

  if (!fs.existsSync(SQLITE_FILE)) {
    console.error('No edu.db found — nothing to import.');
    process.exit(1);
  }

  const { pool, init } = require('../db');
  await init();

  // Guard against running twice and duplicating every reward
  const { rows: existing } = await pool.query('SELECT COUNT(*)::int AS c FROM rewards');
  if (existing[0].c > 0 && !force) {
    console.error(
      `The database already holds ${existing[0].c} reward(s). Importing again would ` +
      'create duplicates.\nNothing was changed. Re-run with --force if you are sure.'
    );
    await pool.end();
    process.exit(1);
  }

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
