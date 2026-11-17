# Deploying Examboost to Vercel

The app now runs on **Vercel + Postgres + Vercel Blob**. Nothing is stored on the
server's disk any more, so content survives redeploys and cold starts.

You need three things wired up before the site will load:

| What | Env var | Why |
| --- | --- | --- |
| Postgres database | `DATABASE_URL` | rewards, testimonials, stats, admin sessions |
| Blob store | `BLOB_READ_WRITE_TOKEN` | uploaded images and files |
| Session secret | `SESSION_SECRET` | signs the admin login cookie |

Until `DATABASE_URL` exists, every page returns **500 FUNCTION_INVOCATION_FAILED**.
That is expected, not a bug.

---

## 1. Create the database

1. Open your Vercel project → **Storage** tab → **Create Database**.
2. Choose **Neon** (serverless Postgres, free tier) and connect it to this project.
3. Vercel adds `DATABASE_URL` (and a few `PG*` vars) to the project automatically.

If you prefer Supabase or a self-hosted Postgres, any standard connection string works:

```
postgresql://user:password@host/dbname?sslmode=require
```

The tables are created automatically on the first request — no SQL to run by hand.

## 2. Create the Blob store

1. Same **Storage** tab → **Create** → **Blob**.
2. Connect it to the project. Vercel creates `BLOB_READ_WRITE_TOKEN`.

Without this token the app falls back to writing into `./uploads`, which is
read-only on Vercel — uploads would fail, so do not skip this step.

## 3. Set the remaining variables

**Project → Settings → Environment Variables** (add to Production *and* Preview):

```
SESSION_SECRET=<paste a long random string>
ADMIN_USER=admin
ADMIN_PASSWORD=<a password you choose — do not leave the default>
```

`SESSION_SECRET` can be any long random text. On PowerShell:

```powershell
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 48 | % {[char]$_})
```

If you leave `ADMIN_PASSWORD` unset the login falls back to `admin` / `admin123`,
which is public knowledge — always set it on a live site.

## 4. Redeploy

**Deployments → ⋯ → Redeploy**, or push a commit. Then open the URL. The landing
page should load with the yellow banner and the content list.

## 5. Move your existing content into Postgres

Your old data lives in `edu.db` (SQLite) plus the images in `uploads/`. Run the
one-time migration from your computer:

```powershell
cd "C:\Users\KIMG JAY\Documents\Default Project\Examboost"

# pull the deployed env vars into .env
vercel link
vercel env pull .env.local

# import: copies stats, testimonials, rewards and pushes images to Blob
npm.cmd run import
```

The script prints one line per reward and per uploaded file. Afterwards every
`/uploads/...` path in the database becomes a `https://....public.blob.vercel-storage.com/...` URL.

**Run it once.** Running it twice copies the rewards again as duplicates.

---

## Running locally

```powershell
npm.cmd install
Copy-Item .env.example .env      # then paste your DATABASE_URL into .env
node server.js
```

Open http://localhost:3000 — admin panel is at `/admin.html`.

Locally, `express.static()` serves `public/` and uploads go to `./uploads`
(no Blob token needed). On Vercel, `public/` is served by the CDN instead and
`express.static()` is ignored, which is fine.

## Notes and limits on Vercel

- **Request size is capped at 4.5 MB.** The admin page splits uploads into
  batches under 3.5 MB automatically, so 30 files still work — but each single
  file must stay under roughly 4 MB.
- **Admin sessions live in Postgres** (`session` table), so logging in survives
  redeploys and works across regions.
- **Shareable content links** are `https://<your-domain>/<slug>`, e.g.
  `https://examboost-three.vercel.app/neco-gce-2026-mathematics-questions-and-answers`.
  Change a slug in the admin edit dialog; old links then 404.
- **`/api/rewards` returns titles only.** Full content and files load only on the
  slug page, so nothing is revealed before the join/share steps.
