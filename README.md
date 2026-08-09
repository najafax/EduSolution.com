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
   `https://edusolution-backend.onrender.com`).

**Note:** on Render's free plan the backend has no persistent disk, so the
SQLite database resets whenever the service restarts or redeploys — fine
for trying the app out, not for keeping real data. Attach a paid instance
with a disk (or swap SQLite for a hosted Postgres) before relying on it
long-term.
