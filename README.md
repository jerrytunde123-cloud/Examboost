# Examboost

Exam-prep lead-generation site: a landing page that rewards students with WAEC /
NECO / JAMB study material after they join the WhatsApp channel and share the
page. Includes a password-protected admin panel for uploading content.

**Stack:** Express · Postgres (Neon/Vercel Postgres) · Vercel Blob · plain HTML/CSS/JS

## Quick start

```powershell
npm.cmd install
Copy-Item .env.example .env    # paste a DATABASE_URL into .env
node server.js
```

- Site: http://localhost:3000
- Admin: http://localhost:3000/admin.html
- Deploying: see [DEPLOY.md](DEPLOY.md)

`node server.js` is used directly because some Windows setups block `npm.ps1`;
`npm.cmd start` works too.

## How content works

1. Admin uploads a reward (title, description, exam, up to 30 files).
2. A slug is generated from the title (`necogce-maths`) and is editable.
3. `/api/rewards` lists **titles only** — no files, no description.
4. The visitor joins the channel and shares the page 5 times. Progress is stored
   in their session **on the server**, not just the browser.
5. Only then does `/api/rewards/<slug>` return the description and files.
6. A shared `/<slug>` link is not a back door: the server redirects strangers to
   `/?unlock=<slug>`. The homepage says "… is locked" and shows the two steps;
   when both are done it returns to `/<slug>` automatically.
7. Access lasts 24 hours (`TASK_TTL_MS`), then the steps are required again.
8. Admins can check their own uploads with `/<slug>?preview=1` while logged in —
   the plain link stays gated even for them.
9. "Share with Classmates" opens `wa.me` directly so the message can be sent to
   groups and chats; the native share sheet often has no WhatsApp entry.

## Environment variables

| Name | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string |
| `BLOB_READ_WRITE_TOKEN` | on Vercel | stores uploads in Vercel Blob; without it uploads go to `./uploads` |
| `SESSION_SECRET` | yes in production | signs the admin session cookie |
| `ADMIN_USER` | no | defaults to `admin` |
| `ADMIN_PASSWORD` | yes in production | defaults to `admin123` |
| `ADMIN_PASSWORD_HASH` | no | bcrypt hash, takes priority over `ADMIN_PASSWORD` |

## One-time data migration

`npm.cmd run import` copies everything from the old `edu.db` SQLite file into
Postgres and uploads the images to Blob. Run it once — see DEPLOY.md.
