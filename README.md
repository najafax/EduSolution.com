# EduSolution.com

A web application with a React frontend and a Node/Express + SQLite backend,
featuring email/password login with role-based access control and an
idle-session timeout (everyone is warned, then automatically logged out
after a set number of minutes of inactivity — configurable by an admin),
plus a small business-management module — clients, a product catalog,
quotes, invoices, payments/receipts, and financials — with PDF generation
and emailing of quotes/invoices/reminders/receipts. Once an invoice has
been sent to a client or paid, it's locked from further edits so the
record stays fixed. Responsive on phone, tablet, and desktop, and
installable as a PWA on iOS and Android (add it to your home screen from
the browser's share/menu button).

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

### Creating user accounts

There is **no public signup** — accounts are always created deliberately,
either by an operator with server access or by an existing admin in-app:

```bash
cd backend
npm run create-user              # interactive; password entry is hidden
npm run create-user -- --list    # show existing accounts
```

This CLI path always creates an **admin** account (full access to
everything, no restrictions) — it's meant for bootstrapping the first
account or account recovery, since it already requires server shell
access. Re-running it for an email that already exists offers to reset
that user's password (and reactivate the account if it was deactivated),
which is also how you recover a locked-out account before SMTP is
configured. In production, run the same command from Render's shell on the
`edusolution-backend` service.

For ongoing staff accounts, log in as an admin and use the **Users** page
in the app instead — it lets you create a `staff` account and grant it
view and/or manage access on a per-module basis (Clients, Quotes,
Invoices, Expenses, Recurring invoices, Financials, Activity, Settings,
Users, Import), rather than all-or-nothing access. A staff member without
a grant for a module simply doesn't see it; granting "manage" always
implies "view" too. Every account — admin or staff — can edit its own
name/email/password and an overdue-reminder email-digest preference from
the **My account** page, regardless of what else it's allowed to touch.

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

## Deploying (DigitalOcean droplet)

Production runs entirely on one DigitalOcean droplet: nginx serves the built
React frontend at `www.edusolutionsmaldives.com` and proxies
`api.edusolutionsmaldives.com` to the Node backend (systemd) with the SQLite
database in `/var/data`. There is no Render service any more. Set-up, deploys,
DNS and TLS are documented in
[`deploy/digitalocean/README.md`](./deploy/digitalocean/README.md); every deploy is
`./deploy/digitalocean/deploy.sh` on the droplet (it pulls `main`, restarts the
backend and rebuilds the frontend). Pushing to GitHub does not deploy by itself.

**Backups:** `backend/src/lib/backup.js` runs daily (03:00 server time via
`lib/scheduler.js`): a `VACUUM INTO` snapshot of the database, gzipped and
uploaded to any S3-compatible bucket (keeps 7 daily + 4 weekly). Off until the
`BACKUP_S3_*` vars are set in `backend/.env` (see `.env.example`).
`npm run backup` triggers one, `npm run backup:list` lists them,
`npm run backup:restore -- <key> [dest-path]` downloads one to a separate file
(it never overwrites the live database: stop the backend, swap the file in at
`DB_PATH`, restart).

## Importing historical data

Settings → **Import historical data**, or go directly to `/import`. Brings
in existing **clients**, **expenses**, or **invoices with payment history**
from a CSV file — useful for backfilling records from before you started
using the app, rather than starting from zero.

- **Order matters**: import clients first if you're also importing
  invoices — each invoice row is matched to a client by email, so the
  client has to already exist.
- Every import previews first (nothing is saved) and shows a row-by-row
  report of what would happen; only after you review it and click confirm
  does anything get written. A file with some bad rows is fine — valid
  rows still import, invalid ones are skipped with a reason shown.
- Each type has a **Download template** button showing the exact expected
  columns; required columns are required, everything else can be left
  blank.
- For invoices, `amount` is a single total (not itemized line items) —
  fine for historical backfill where you have summary figures, not the
  original quote breakdown. If you include `amount_paid` and `paid_date`,
  a real payment record is created too, so historical revenue shows up
  correctly in Financials, not just as a number on the invoice.
- Invoice numbers are auto-generated using the invoice's own **issue
  year**, not the year you're importing in — a 2023 invoice gets an
  `INV-2023-####` number, so it doesn't collide with this year's real
  numbering. Or supply your own `number` column to keep original invoice
  numbers from your previous system.

## Going live with real data — checklist

Ordered so nothing depends on a step that hasn't happened yet.

1. **Deploy the blueprint** and confirm both `*.onrender.com` URLs respond.
2. **Backend on Starter with the disk attached** — without the persistent
   disk the database is wiped on every redeploy. Verify `DB_PATH` is set to
   `/var/data/data.sqlite3` on the service.
3. **Create your account**: `npm run create-user` from Render's shell, then
   confirm you can log in. (No public signup exists — see above.) This
   first account is always an admin; create any staff accounts afterward
   from the in-app **Users** page, with only the module access each person
   actually needs.
4. **Custom domain + DNS**, then confirm HTTPS works on both `www` and `api`.
5. **SMTP** — set the `SMTP_*` vars. Until this is done, sending quotes and
   invoices, overdue reminders, and password reset all fail (with a clear
   "not configured" error, not a crash). Send one real quote to yourself to
   confirm deliverability before relying on it.
6. **Backups** — set the `BACKUP_S3_*` vars, then run `npm run backup` once
   and `npm run backup:list` to confirm an object actually landed in the
   bucket. Don't skip the verification; an untested backup isn't a backup.
7. **Business settings** — in the app under Settings, set the currency
   symbol (defaults to `$`), tax ID, and bank details. These print on every
   quote, invoice, and receipt PDF, so check one PDF before sending to a
   real client.
8. **Test a full cycle on real-ish data**: create a client → quote → send →
   convert to invoice → record payment → download the receipt PDF.

Worth knowing: rate-limit state lives in process memory, so a redeploy
clears any in-progress login lockout. And the daily cron jobs (backup 03:00,
recurring invoices 07:00, reminders 08:00) run on **server** time, which is
UTC on Render — five hours behind Maldives time.
