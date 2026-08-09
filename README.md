# EduSolution.com

A web application with a React frontend and a Node/Express + SQLite backend,
featuring email/password signup and login, plus a small business-management
module — clients, quotes, invoices, payments/receipts, and financials —
with PDF generation and emailing of quotes/invoices/reminders/receipts.
Responsive on phone, tablet, and desktop, and installable as a PWA on iOS
and Android (add it to your home screen from the browser's share/menu
button).

To actually send quote/invoice/reminder emails, set the `SMTP_*` variables
in `backend/.env` (see `backend/.env.example`) — without them, everything
else works and email-sending routes fail with a clear "not configured"
error instead of crashing.

## Structure

- `frontend/` — React + Vite + Tailwind CSS SPA
- `backend/` — Express API with a SQLite database and JWT-based auth

## Getting started

### Backend

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

The API runs on `http://localhost:4000`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The app runs on `http://localhost:5173` and proxies `/api` requests to the
backend.

See [CLAUDE.md](./CLAUDE.md) for a deeper look at the architecture and
conventions.

## Deploying (Render)

This repo includes a [`render.yaml`](./render.yaml) blueprint that
provisions both services — the backend as a Node web service, the frontend
as a static site — wired to talk to each other.

1. Push this branch to GitHub (already done if you're reading this from
   the repo).
2. Go to [Render's New Blueprint page](https://dashboard.render.com/blueprints),
   connect this GitHub repo, and select the branch to deploy.
3. Render reads `render.yaml` and creates `edusolution-backend` and
   `edusolution-frontend`. Click **Apply** to deploy both.
4. Once deployed, the frontend will be live at
   `https://edusolution-frontend.onrender.com` (and the API at
   `https://edusolution-backend.onrender.com`) — confirm both work before
   moving on to the custom domain below.

**Note on cost/reliability:** `render.yaml` provisions the backend on
Render's **Starter** plan (~$7/mo) with a 1GB **persistent disk** mounted at
`/var/data` — the backend reads `DB_PATH` (see `backend/src/db/index.js`)
so `data.sqlite3` lives on that disk and survives restarts/redeploys. This
is the minimum needed to hold real client/invoice data safely and to keep
the `node-cron` jobs in `lib/scheduler.js` (daily overdue reminders, daily
recurring-invoice generation) firing reliably — Render's **free** plan has
no persistent disk (the database resets on every redeploy) and spins the
service down after 15 minutes idle (cron jobs silently stop firing). The
frontend stays on Render's free static-site tier regardless — only the
backend needs to be paid. If you deploy this blueprint before upgrading,
Render will still show `plan: free` as an option in the dashboard; switch
the backend service to Starter before you rely on it for real data.

**Backups:** a persistent disk protects against restarts/redeploys, but
not against you fat-fingering a delete or Render having a bad day. Since
this holds real financial data, `backend/src/lib/backup.js` runs daily
(03:00 server time, via `lib/scheduler.js`) — it snapshots the database
with SQLite's `VACUUM INTO` (safe against a live WAL-mode write, unlike
copying the raw file), gzips it, and uploads it to any S3-compatible
bucket, keeping the last 7 daily + 4 weekly backups and pruning older ones.
It's off by default — set the `BACKUP_S3_*` vars (see `.env.example`) to
turn it on:

1. Create a bucket on **Cloudflare R2** (cheapest option — no egress fees,
   effectively $0/mo for a database this small) or any other S3-compatible
   provider. In R2: Cloudflare dashboard → R2 → Create bucket, then
   R2 → Manage API Tokens → create a token scoped to that bucket only.
2. Set on the `edusolution-backend` Render service (Settings → Environment):
   `BACKUP_S3_BUCKET`, `BACKUP_S3_ENDPOINT` (R2 gives you this, looks like
   `https://<account_id>.r2.cloudflarestorage.com`), `BACKUP_S3_REGION=auto`,
   `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`.
3. Redeploy. From then on, backups run automatically; `npm run backup` (run
   from `backend/`, with the same env vars set locally or via Render's
   shell) triggers one on demand.

To see what's backed up: `npm run backup:list`. To restore: `npm run
backup:restore -- <key> [dest-path]` downloads a backup to a **separate**
file (it refuses to overwrite the live database) — verify it, then stop
the backend, swap the file in at `DB_PATH`, and restart.

### Custom domain (Namecheap)

`render.yaml` is already wired for **edusolutionsmaldives.cm** — the
frontend serves from `www.edusolutionsmaldives.cm` (with the bare domain
redirecting to it) and the API from `api.edusolutionsmaldives.cm`. If you
use a different domain, edit the two `value:` lines in `render.yaml`
(`CLIENT_ORIGIN` and `VITE_API_URL`) first, then redeploy before continuing.

**In Render**, on each service → **Settings → Custom Domains**:

- `edusolution-frontend` → add `www.edusolutionsmaldives.cm`. Render shows
  a CNAME target (looks like `edusolution-frontend.onrender.com`).
- `edusolution-backend` → add `api.edusolutionsmaldives.cm`. Render shows
  a CNAME target (looks like `edusolution-backend.onrender.com`).

Render provisions a free TLS certificate for each domain automatically
once the DNS below resolves — this can take a few minutes to a few hours.

**In Namecheap**, on the domain → **Manage → Advanced DNS**, add:

| Type | Host | Value | 
|---|---|---|
| CNAME Record | `www` | `edusolution-frontend.onrender.com` (Render's exact target) |
| CNAME Record | `api` | `edusolution-backend.onrender.com` (Render's exact target) |
| Redirect Record (or ALIAS Record) | `@` | `https://www.edusolutionsmaldives.cm` |

Use the exact CNAME targets Render shows you in the Custom Domains panel
(they may differ slightly from the plain `*.onrender.com` names above).
For the bare/apex domain (`@`), a **Redirect Record** (301, to
`https://www.edusolutionsmaldives.cm`) is the simplest option in Namecheap;
if you'd rather the apex serve the site directly without a redirect, use
Namecheap's **ALIAS Record** type pointed at the same CNAME target instead
— DNS doesn't allow a plain CNAME on an apex domain.

Remove any existing Namecheap "Parking Page" redirect first (Namecheap adds
one by default on new domains), and delete any conflicting `@`/`www` A or
CNAME records it created.

DNS changes can take anywhere from a few minutes up to 24–48 hours to
propagate fully, though Namecheap's own records are usually fast (well
under an hour).
