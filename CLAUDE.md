# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

EduSolution.com is a two-package web app: a React SPA (`frontend/`) and a
Node/Express API (`backend/`) with a SQLite database, connected by a
JWT-based auth flow (signup/login/dashboard). There is no root package.json
— each package is installed and run independently.

Beyond auth, the backend/frontend implement a small business-management
module — clients, quotes, invoices, payments/receipts, expenses, recurring
invoices, a financials summary, an activity log, and global search —
shared across every logged-in user (single-business model, not
multi-tenant). Quotes and invoices also have unauthenticated client-facing
views via a `public_token` link. See "Business module" below.

## Commands

### Backend (`backend/`)

```bash
cd backend
npm install
cp .env.example .env      # first time only; edit JWT_SECRET for anything beyond local dev
npm run dev                # nodemon, auto-restart, http://localhost:4000
npm start                  # plain node, no auto-restart
```

No test suite or linter is configured yet.

### Frontend (`frontend/`)

```bash
cd frontend
npm install
npm run dev                # Vite dev server, http://localhost:5173
npm run build               # production build to frontend/dist
npm run preview             # serve the production build locally
npm run lint                 # oxlint
```

No test suite is configured yet.

### Running the full app locally

Both dev servers must be running simultaneously (separate terminals/processes):
backend on `:4000`, frontend on `:5173`. The Vite dev server proxies
`/api/*` to `http://localhost:4000` (see `frontend/vite.config.js`), so the
frontend always calls its own origin's `/api/...` — never hardcode the
backend port in frontend code.

## Architecture

### Backend (`backend/src/`)

- `index.js` — Express app entry point: CORS (restricted to `CLIENT_ORIGIN`
  from env), JSON body parsing, mounts routes under `/api`, 404 + error
  handlers.
- `db/index.js` — opens the SQLite file via `better-sqlite3` (a synchronous
  SQLite driver — no async/await needed for queries) and runs
  `CREATE TABLE IF NOT EXISTS` on startup. Path is `DB_PATH` from env if
  set, else `backend/data.sqlite3` — in production this should point at a
  persistent disk mount (see `render.yaml`'s `disk`/`DB_PATH` for the
  Render deployment) so the database survives restarts/redeploys. This is
  the only place schema is defined; there is no migration tool, so schema
  changes are made by editing the `CREATE TABLE` statement directly (fine
  pre-launch; revisit once there's production data).
- `middleware/auth.js` — `requireAuth` verifies the `Authorization: Bearer
  <jwt>` header and attaches the decoded payload to `req.user`. Any new
  protected route should use this middleware rather than re-implementing
  token checks.
- `routes/auth.js` — `POST /api/auth/signup`, `POST /api/auth/login`,
  `GET /api/auth/me`, plus `POST /api/auth/forgot-password` and
  `POST /api/auth/reset-password`. Passwords are hashed with bcryptjs before
  storage; JWTs are signed with `JWT_SECRET` from env and expire after 7
  days. `publicUser()` is the single place that shapes what user data is
  ever sent to the client — extend it rather than returning raw DB rows
  elsewhere. `forgot-password` always returns the same generic response
  regardless of whether the email exists (prevents account enumeration);
  it stores a random token + 1-hour expiry on `users.reset_token`/
  `reset_token_expires` and emails a `${CLIENT_ORIGIN}/reset-password?token=`
  link (silently logs if email isn't configured — the response doesn't
  change either way). `reset-password` validates the token/expiry, requires
  an 8+ char password, and clears the token after use (single-use).

Environment variables (see `backend/.env.example` for the full list with
comments): `PORT`, `JWT_SECRET`, `CLIENT_ORIGIN`, `DB_PATH` (optional,
production-only — see `db/index.js` above), `SMTP_HOST`/`PORT`/
`USER`/`PASS`/`FROM`/`SECURE` for outgoing email, and `BACKUP_S3_BUCKET`/
`ENDPOINT`/`REGION`/`ACCESS_KEY_ID`/`SECRET_ACCESS_KEY`/
`BACKUP_RETENTION_DAILY`/`_WEEKLY` for automated backups (see
`lib/backup.js` below). `backend/data.sqlite3`
and `.env` are gitignored — they're local/per-environment state, not source.

### Business module (`backend/src/`)

All routes below are mounted under `/api` and protected by `requireAuth` —
data is shared across every logged-in user, there's no per-user ownership
column anywhere in this module.

- `routes/clients.js`, `routes/settings.js` — plain CRUD for `clients`, and
  GET/PUT for the single-row `business_settings` table (business name,
  address, tax ID, currency symbol, bank details — this is what prints on
  every PDF's header/footer). `clients.js` also has `GET /export.csv`
  (registered before `GET /:id` so it isn't shadowed by the `:id` param).
- `routes/quotes.js`, `routes/invoices.js` — CRUD plus PDF download
  (`GET /:id/pdf`), email send (`POST /:id/send`), `POST /:id/duplicate`
  (copies client/items/discount/tax/notes into a new `draft` with a fresh
  number, `public_token`, and today's date — invoice duplicate also resets
  `due_date` to +14 days), and `GET /export.csv`. Invoices only:
  `POST /:id/remind` and `POST /:id/payments`. `quotes.js` also has
  `POST /:id/convert-to-invoice`, which copies the quote's line items into
  a new invoice and stamps `quotes.converted_invoice_id`. Both accept
  `discount_type` (`percentage|fixed`) and `discount_value` on create/update,
  computed via `lib/totals.js`. Every mutation (create/update/delete/send/
  duplicate/convert/payment) calls `lib/activity.js`'s `logActivity()`.
- `routes/expenses.js` — CRUD for `expenses` (category/description/amount/
  expense_date/notes) plus `GET /` (`?q=` search) and `GET /export.csv`.
  `CATEGORIES` is a fixed list (`rent, utilities, supplies, salaries,
  marketing, software, travel, other`) served to the frontend for the
  category `<select>`.
- `routes/recurring.js` — CRUD for `recurring_invoices` (+ their
  `recurring_invoice_items` template line items) mounted at
  `/api/recurring-invoices`. Frequency is `weekly|monthly|yearly`. Creating/
  updating a template validates line items and discount/tax via
  `computeTotals()` for feedback only — the real totals are recomputed fresh
  from current unit prices every time an invoice is actually generated (see
  `lib/scheduler.js` below), since prices may have changed since the
  template was saved.
- `routes/public.js` — mounted at `/api/public`, the one route file **not**
  behind `requireAuth`. Looks quotes/invoices up by their `public_token`
  (a random 16-byte hex column generated on every quote/invoice create,
  duplicate, convert-to-invoice, and recurring-invoice generation) rather
  than by id, so a client with the link can view/download a document
  without an account. `GET /quotes/:token` and `GET /invoices/:token`
  return the document + client + business settings; `GET .../pdf` streams
  the same PDF the authenticated routes produce; `POST /quotes/:token/respond`
  lets the client accept/decline (only while `status` is `draft`/`sent`;
  stores `quotes.client_response`/`client_responded_at` and updates
  `status`). The emails sent from `quotes.js`/`invoices.js` `/send` routes
  link here (`${CLIENT_ORIGIN}/q/:token`, `${CLIENT_ORIGIN}/i/:token`).
- `routes/activity.js` — `GET /` returns a paginated (30/page) read of the
  `activity_log` table, newest first. There's no write endpoint — every
  other route's mutations write to this table themselves via
  `lib/activity.js`'s `logActivity({ userName, action, entityType,
  entityId, entityLabel })`.
- `routes/search.js` — `GET /?q=` runs one `LIKE %q%` query per entity
  (clients, quotes, invoices, expenses — each matched on its own set of
  text columns, quotes/invoices also match on client name via a join) and
  returns up to 8 grouped results per entity. Empty/missing `q` returns all
  empty arrays rather than erroring.
- `routes/financials.js` — `GET /summary`: totals invoiced/paid/outstanding,
  overdue count/amount, client count, quote/invoice counts by status, a
  6-month invoiced-vs-paid trend (`monthlyTrend`, oldest month first), the
  10 most recent payments, `totalExpenses` (sum of `expenses.amount`), and
  `netProfit` (`totalPaid - totalExpenses`). Same endpoint backs both
  `Dashboard` and `Financials` pages. Computed from `invoices`/`payments`/
  `clients`/`expenses` on every request, nothing is cached or denormalized
  beyond `invoices.amount_paid`.
- `lib/totals.js` — `computeTotals(items, taxRate, discountType, discountValue)`
  validates a raw line-items payload and computes subtotal → discount → tax
  → total, in that order (tax applies to the post-discount amount).
  `discountType` is `percentage` (validated ≤100) or `fixed` (validated ≤
  subtotal). Shared by quotes, invoices, and recurring-invoice
  create/update/generate; this is the only place that math happens — don't
  recompute totals in route handlers or on the frontend.
- `lib/numbering.js` — sequential per-year document numbers
  (`Q-2026-0001`, `INV-2026-0001`, `R-2026-0001` for quotes/invoices/
  receipts). Relies on `better-sqlite3` being synchronous (no `await`
  between the count and the insert that consumes it) to avoid a race — if
  any of this code becomes async, this numbering scheme needs a real lock.
- `lib/pdf.js` — renders quote/invoice/receipt PDFs with `pdfkit` (pure JS,
  no headless browser). One shared header/items-table/totals layout, reused
  by `renderQuotePdf`/`renderInvoicePdf`/`renderReceiptPdf`, and by both the
  authenticated `:id/pdf` routes and the public `public.js` routes.
- `lib/mailer.js` — `sendMail()` wraps `nodemailer` with SMTP settings from
  env (`SMTP_HOST`/`PORT`/`USER`/`PASS`/`FROM`/`SECURE`). If `SMTP_HOST`
  isn't set, it throws `EMAIL_NOT_CONFIGURED` rather than crashing — routes
  catch this and return `503` with a message telling the caller which env
  vars to set. Everything else (PDF download, payments, financials) works
  with no SMTP configured at all.
- `lib/activity.js` — `logActivity({ userName, action, entityType,
  entityId, entityLabel })` inserts one row into `activity_log`. Called
  from every create/update/delete/send/duplicate/convert/payment/respond
  across clients, quotes, invoices, expenses, and recurring invoices —
  when adding a new mutation, call this too rather than letting it go
  unlogged.
- `lib/csv.js` — `toCsv(rows, columns)`, a minimal hand-rolled RFC-4180-ish
  serializer (`columns` is `{ label, key }` or `{ label, value: fn }`).
  Backs every `GET /export.csv` route; not a general-purpose library, just
  enough quoting/escaping for this app's exports.
- `lib/backup.js` — `runBackup()`: skips entirely if `BACKUP_S3_BUCKET`
  isn't set. Otherwise runs `VACUUM INTO` to write a consistent snapshot of
  the live database (safe against catching a WAL-mode write mid-flight,
  unlike copying `data.sqlite3`'s bytes directly), gzips it, and uploads it
  to `backups/daily/<timestamp>.sqlite3.gz` in any S3-compatible bucket
  (Cloudflare R2, Backblaze B2, or real S3 — configured via
  `BACKUP_S3_ENDPOINT`/`REGION`/`ACCESS_KEY_ID`/`SECRET_ACCESS_KEY`). Also
  writes to `backups/weekly/` on Sundays (UTC). After upload, prunes each
  prefix down to `BACKUP_RETENTION_DAILY`/`_WEEKLY` (default 7/4) oldest-first
  by listing objects and deleting the excess — keys embed an ISO timestamp so
  lexical sort is chronological sort. `backend/scripts/backup.js`,
  `list-backups.js`, and `restore.js` (`npm run backup`/`backup:list`/
  `backup:restore`) wrap this for manual use outside the cron schedule;
  `restore.js` always downloads to a separate file and refuses to write
  directly over the live `DB_PATH` — swapping a restored file in is a
  deliberate manual step (stop the backend, replace the file, restart).
- `lib/scheduler.js` — `startScheduler()` (called once from `index.js`'s
  `app.listen` callback) registers three `node-cron` jobs, all server-time:
  - `0 3 * * *` — `runBackup()` (see `lib/backup.js` above), scheduled
    ahead of the other two jobs so a backup reflects state from before
    the day's automated invoice/reminder mutations.
  - `0 7 * * *` — `generateDueRecurringInvoices()`: for every
    `recurring_invoices` row with `active=1` and `next_run_date <= today`,
    recomputes totals from the template's current line items via
    `computeTotals()`, inserts a new **draft** invoice (with
    `recurring_invoice_id` set, a fresh number/`public_token`, and
    `due_date = today + due_in_days`), then advances `next_run_date` by the
    template's frequency (`advanceDate()`: weekly +7d, yearly +1y, else
    +1 month) and stamps `last_generated_at`. Generated invoices are never
    auto-emailed — they're created as drafts for a human to review and send
    from the Invoices page. Per-row try/catch so one bad template doesn't
    block the rest.
  - `0 8 * * *` — `runOverdueReminders()`: skips entirely if `SMTP_HOST`
    isn't set. Selects `invoices` where `status='sent'`,
    `amount_paid < total`, `due_date < today`, and
    `last_reminder_sent_at` is either null or over 7 days old (so a human
    sending a manual reminder, or a previous automated one, suppresses
    re-nagging for a week). Emails the invoice PDF and updates
    `last_reminder_sent_at`.
  All three jobs are also exported directly (`runBackup`,
  `generateDueRecurringInvoices`, `runOverdueReminders`) so they can be
  invoked outside the cron schedule (tests, or a manual "run now" action).

Status/derived-field conventions worth knowing before touching this code:
- Quote `status`: `draft | sent | accepted | declined | expired`, set
  explicitly by `PUT`/`/send`/`/convert-to-invoice`, or by the client via
  `POST /api/public/quotes/:token/respond` (`accepted`/`declined`, also
  stored in `client_response`/`client_responded_at`).
- Invoice `status`: only `draft | sent | void | paid` are ever stored —
  `paid` is set automatically the moment `amount_paid >= total` inside the
  `POST /:id/payments` handler. "Overdue" and "partially paid" are **not**
  stored; `invoices.js`'s `withComputed()` (also duplicated in `public.js`
  for the unauthenticated view) derives `is_overdue` and `is_partially_paid`
  from `status`/`due_date`/`amount_paid` on every read, so there's no cron
  job or background process keeping status in sync.
- Deletes are guarded at the DB level in the route handlers, not via FK
  constraints: a client with any quotes/invoices can't be deleted, and an
  invoice with any recorded payments can't be deleted.
- `public_token` (random 16-byte hex, unique) exists on every quote and
  invoice row and is regenerated on duplicate/convert/recurring-generation
  — never reused across documents, and never exposed anywhere except the
  document it belongs to.

### Frontend (`frontend/src/`)

- `context/AuthContext.jsx` — the single source of truth for auth state.
  Holds the JWT (persisted in `localStorage`) and the current user, fetched
  via `GET /api/auth/me` on load to validate the stored token. Exposes
  `login(token, user)` / `logout()`. Any component that needs to know if
  someone is signed in should read `useAuth()`, not touch `localStorage`
  directly.
- `components/ProtectedRoute.jsx` — wraps route elements that require auth;
  redirects to `/login` when there's no valid token. Wrap new authenticated
  pages with this rather than checking auth state ad hoc.
- `lib/api.js` — the only module that calls the backend. All requests go
  through `request()`, which prefixes `/api`, attaches the bearer token when
  passed, and normalizes error responses to `throw new Error(data.error)`.
  Add new endpoints here rather than calling `fetch` directly from
  components. PDF endpoints don't go through `request()` (they return
  binary, not JSON) — `openPdf()` fetches with the auth header, turns the
  response into a blob URL, and `window.open()`s it; a plain `<a href>`
  can't attach the Authorization header, which is why this exists.
  `downloadFile()` is the equivalent for CSV/other exports that should
  force a real download rather than open in a tab (throwaway `<a download>`
  click). The `public` object (`getQuote`, `respondQuote`, `getInvoice`,
  `openQuotePdf`, `openInvoicePdf`) hits `/api/public/...` and is the one
  set of calls that never passes a token.
- `pages/` — one component per route (`Landing`, `Login`, `Signup`,
  `ForgotPassword`, `ResetPassword`, `Dashboard`), wired up in `App.jsx` via
  `react-router-dom`. `ForgotPassword`/`ResetPassword` are public routes;
  `ResetPassword` reads its token from `useSearchParams()` and, on success,
  navigates to `/login` passing a message via router state (shown as a
  banner on the login page). `PublicQuote`/`PublicInvoice` (routes `/q/:token`
  and `/i/:token`) are also public — they render a read-only view of a
  quote/invoice by its `public_token` via `api.public.*`, with a "Download
  PDF" button and, on quotes still `draft`/`sent`, Accept/Decline buttons.
  These pages exist *outside* `ProtectedRoute` and never touch
  `AuthContext`/`localStorage`.
- `pages/business/` — the client/quote/invoice/payment/settings/financials/
  expenses/recurring-invoices/activity pages (see "Business module" below).
  `components/LineItemsEditor.jsx` and `components/StatusBadge.jsx` are
  shared between the quote and invoice form/detail pages — extend those
  rather than duplicating item-row or status-color logic per page.
  `Expenses.jsx` and `RecurringInvoices.jsx` follow the same
  list+inline-form+FAB pattern as `Clients.jsx` (no separate detail page —
  edit happens inline in the list). `ActivityLog.jsx` is a simple paginated
  read-only list.
- `components/GlobalSearch.jsx` — a debounced (250ms) search box that calls
  `api.search.query()` and renders a grouped dropdown (clients/quotes/
  invoices/expenses); clicking a result navigates there. Mounted twice in
  `Navbar.jsx` — once in the desktop nav (narrower, `hidden lg:flex`) and
  once inside the mobile slide-down menu — both instances exist in the DOM
  simultaneously, so anything that queries this input in tests must scope
  to the visible one.
- `pages/Dashboard.jsx` charts (`components/RevenueTrendChart.jsx`,
  `components/StatusBreakdownChart.jsx`) are hand-rolled SVG/CSS, no
  charting library. Status colors there are pinned to match
  `StatusBadge`/`lib/pdf.js` (draft=slate, sent=indigo, paid=emerald,
  void=red) rather than a generic categorical palette — status is state,
  not series identity, so don't reassign those colors when adding a chart.
- Styling is Tailwind CSS v4 via the `@tailwindcss/vite` plugin (see
  `vite.config.js` and `src/index.css`) — no `tailwind.config.js`/PostCSS
  setup exists or is needed for v4's Vite integration. Utility classes are
  used directly in JSX; there's no separate component-style layer.

### Responsive / PWA

The app is a responsive installable PWA (installable on iOS/Android home
screens), configured via `vite-plugin-pwa` in `vite.config.js`:

- The manifest (name, icons, `theme_color`, `display: standalone`) is
  generated from the `manifest` option at build time — don't hand-edit a
  `manifest.webmanifest` file, it doesn't exist in source, only in `dist/`.
- Icon source files live in `frontend/public/` (`favicon.svg`,
  `pwa-192x192.png`, `pwa-512x512.png`, `maskable-icon-512x512.png`,
  `apple-touch-icon.png`). The two `.svg` files are the design source; the
  PNGs were rasterized from them (there's no build step that regenerates
  PNGs from the SVGs — if the design changes, re-rasterize by hand and
  replace the PNGs).
- iOS Safari doesn't read the manifest for install metadata, so
  `index.html` carries iOS-specific tags directly (`apple-touch-icon` link,
  `apple-mobile-web-app-capable`, etc.) — keep these in sync with the
  manifest's icons/name if either changes.
- All form inputs use `text-base` (16px), not `text-sm` — iOS Safari
  auto-zooms the page on focus for inputs under 16px, so this isn't just a
  style choice.
- Touch targets (`Navbar` links/buttons, form inputs/buttons) use
  `min-h-11` (44px) to meet Apple's minimum tap-target guidance.
- `npm run build` also emits a generated service worker (`sw.js`) that
  precaches the built assets; `workbox.navigateFallbackDenylist` excludes
  `/api/*` so navigation fallback never intercepts API routes. There is no
  offline-data story beyond asset precaching — API calls always hit the
  network.

### Auth flow end-to-end

1. `Signup`/`Login` pages submit to `api.signup`/`api.login`.
2. On success, the returned `{ token, user }` is passed to
   `AuthContext.login()`, which persists the token and updates state.
3. `ProtectedRoute` (used for `/dashboard`) checks `AuthContext` and
   redirects unauthenticated visitors to `/login`.
4. Every subsequent authenticated request (e.g. the `/auth/me` check on
   page load) sends the token as `Authorization: Bearer <token>`, verified
   server-side by `requireAuth`.
5. Forgotten passwords: `ForgotPassword` submits an email to
   `api.forgotPassword`, which always shows the same generic success
   message (see `routes/auth.js` above). The emailed link
   (`/reset-password?token=...`) opens `ResetPassword`, which submits the
   new password + token to `api.resetPassword` and redirects to `/login`
   with a success banner.
