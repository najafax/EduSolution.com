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

**Note:** on Render's free plan the backend has no persistent disk, so the
SQLite database resets whenever the service restarts or redeploys — fine
for trying the app out, not for keeping real data. Attach a paid instance
with a disk (or swap SQLite for a hosted Postgres) before relying on it
long-term. The free plan also spins the backend down after 15 minutes of
inactivity, which both delays the first request after idle *and* means the
`node-cron` jobs in `lib/scheduler.js` (daily overdue reminders, daily
recurring-invoice generation) won't fire reliably unless something is
pinging the service, or unless you're on a paid instance that stays up.

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
