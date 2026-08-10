# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

EduSolution.com is a two-package web app: a React SPA (`frontend/`) and a
Node/Express API (`backend/`) with a SQLite database, connected by a
JWT-based auth flow (login/dashboard). There is no root package.json
— each package is installed and run independently.

Beyond auth, the backend/frontend implement a small business-management
module — clients, quotes, invoices, payments/receipts, expenses, recurring
invoices, a financials summary, an activity log, and global search — all
sharing the same underlying data (single-business model, not multi-tenant).
Within that shared data, access is role/permission-gated per user (admin vs.
staff, with granular per-module view/manage grants for staff) — see "Roles
and permissions" below. Quotes and invoices also have unauthenticated
client-facing views via a `public_token` link. See "Business module" below.

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
  pre-launch; revisit once there's production data). One exception: adding
  `users.role`/`active`/`notify_overdue` and the `user_permissions` table
  (see "Roles and permissions" below) had to run against an already-live
  production database with real accounts, so that change is a one-time,
  idempotent `ALTER TABLE ... ADD COLUMN` block (gated by a
  `PRAGMA table_info(users)` check, so it's a no-op on every run after the
  first) rather than an edit to the `CREATE TABLE` statement — the
  `CREATE TABLE` still reflects the final shape for fresh databases, the
  `ALTER TABLE` block only exists to carry existing databases forward. Same
  pattern, same reason, for `business_settings.session_timeout_minutes`
  (see "Idle session timeout" below) — that table's single row already
  existed in production too. `clients` got a similar migration in the other
  direction: it used to have separate `name` (contact person) and `company`
  columns, which was just a confusing way to ask the same question twice
  — a client here always means the organization being billed, not an
  individual. The one-time migration folds `company` into `name` (company
  wins wherever both were set — `UPDATE clients SET name = company WHERE
  company != ''`, guarded by checking the column still exists) and then
  drops the `company` column outright, rather than just adding one; this
  is safe because SQLite (3.35+, well within what `better-sqlite3` bundles)
  supports `ALTER TABLE ... DROP COLUMN` directly, no legacy
  recreate-the-table dance needed. Same pattern once more for
  `products.tax_rate` (see `routes/products.js` below), added after
  `products` already had real catalog rows in production — a plain
  `ALTER TABLE products ADD COLUMN tax_rate REAL NOT NULL DEFAULT 0`,
  guarded by a `PRAGMA table_info(products)` check.
- `middleware/auth.js` — `requireAuth` verifies the `Authorization: Bearer
  <jwt>` header, then **re-fetches the live user row from the DB** (by the
  id in the JWT payload) rather than trusting the token's claims, and
  attaches `{ id, name, email, role, active, notify_overdue }` to `req.user`
  — rejects with 401 if the user no longer exists or `active` is now 0. This
  is deliberate: a JWT is valid for 7 days, and re-fetching on every request
  means a role change, a permission grant, or deactivating someone takes
  effect on their *next* request instead of waiting out the token's
  lifetime. `requirePermission(module, level = 'view')` (from
  `lib/permissions.js`) is a second middleware, chained after `requireAuth`,
  for routes that need a specific module grant rather than just "logged in"
  — returns 403 with a human-readable message on denial. Any new protected
  route should use `requireAuth` (and `requirePermission` if it touches a
  gated module) rather than re-implementing token/permission checks.
- `lib/permissions.js` — the single source of truth for the permission
  model. `MODULES` is the fixed list of gatable modules (`clients`,
  `products`, `quotes`, `invoices`, `expenses`, `recurring_invoices`,
  `financials`, `activity`, `settings`, `users`, `import`) — kept as a
  hardcoded list
  (rather than derived from route files) so a typo'd module name in a route
  fails closed instead of silently creating a new, ungrantable slot.
  `hasPermission(user, module, level)` short-circuits to `true` for
  `role === 'admin'` (admins never consult `user_permissions` at all);
  for staff it looks up that user's row and requires `can_manage` for
  `level: 'manage'` or either flag for `level: 'view'` (**manage implies
  view**) — a module with no row at all is default-deny
  (`{can_view: false, can_manage: false}`), never falls back to "allowed".
  `setPermissions(userId, permissionsMap)` upserts `user_permissions` rows
  in a transaction and — critically — forces `can_view = 1` in storage
  whenever `can_manage = 1` is being set, so the "manage implies view"
  invariant holds even for code that reads the raw table instead of calling
  `hasPermission()`. `effectivePermissions(user)` is what login/`/me` return
  to the frontend: admins get every module at `{can_view: true, can_manage:
  true}`, staff get their real `getPermissions()` map — the frontend never
  re-implements the "admin bypasses everything" rule itself.
- `routes/auth.js` — `POST /api/auth/login`, `GET /api/auth/me`, `PUT
  /api/auth/me`, `POST /api/auth/change-password`, `PUT
  /api/auth/preferences`, plus `POST /api/auth/forgot-password` and `POST
  /api/auth/reset-password`. **There is deliberately no signup route.**
  Every account can potentially see and edit all business data
  (single-business model, no per-user ownership column), so open
  registration would give anyone who found the URL a route to real
  financial records — access is instead controlled after the fact by role/
  permissions (see "Roles and permissions" below), not by gating who can
  get an account in the first place. Accounts are created out-of-band with
  `npm run create-user` for the bootstrap/recovery path, or in-app via
  `routes/users.js` for ongoing staff accounts — don't add a public signup
  endpoint back without preserving that distinction. Passwords are hashed
  with bcryptjs before storage; JWTs are signed with `JWT_SECRET` from env
  and expire after 7 days. `login` rejects with 401 if `active` is 0 (in
  addition to the usual bad-credentials check) and, on success, returns
  `{ token, user, permissions }` — `permissions` is
  `effectivePermissions(user)`, so the frontend has everything it needs to
  render without a second round-trip; `/me` returns the same shape minus
  the token, re-derived from the live row every time (see `requireAuth`
  above). `publicUser()` is the single place that shapes what user data is
  ever sent to the client — extend it rather than returning raw DB rows
  elsewhere. `PUT /me`/`POST /change-password`/`PUT /preferences` are
  gated by `requireAuth` only, **never** by the `users` permission — every
  account, admin or staff, can always edit its own name/email, change its
  own password (`change-password` verifies `currentPassword` via
  `bcrypt.compare` first), and toggle `notify_overdue` (see
  `lib/scheduler.js` below), regardless of what module grants it has.
- `middleware/rateLimit.js` — `express-rate-limit` instances applied to the
  unauthenticated auth routes: `loginLimiter` (10 per 15min, brute-force
  protection), `forgotPasswordLimiter` (5/hour — tighter because each
  accepted request sends mail from your SMTP account), and
  `resetPasswordLimiter` (10/hour, guards the reset token). All return the
  app's usual `{ error }` shape on 429. State is per-process memory, so it
  resets on restart/redeploy — fine at this scale, but it means a restart
  clears an in-progress lockout. `index.js` sets `trust proxy` to 1 because
  Render terminates TLS at a proxy; without it every visitor would share one
  rate-limit bucket.
- `scripts/create-user.js` (`npm run create-user`) — interactive by default
  (hidden password entry, with a visible-input fallback when stdin isn't a
  TTY, e.g. over `render ssh`). `--list` shows existing accounts (now also
  `role` and an `(deactivated)` suffix when `active = 0`); `--name`/
  `--email`/`--password` (or `CREATE_USER_PASSWORD`) allow non-interactive
  use. Re-running for an existing email offers to reset that user's password
  (and reactivates the account) instead, which doubles as account recovery
  before SMTP is configured, or for un-deactivating someone without going
  through the Users page. **New accounts created here are always
  `role: 'admin'`** — this script requires shell access to the server,
  which is already a higher trust level than anything the in-app permission
  system controls, so it's kept as the bootstrap/recovery path rather than
  a general-purpose account creator. Ongoing staff accounts with granular
  permissions are created in-app via the Users page
  (`routes/users.js`/`pages/Users.jsx`) by an existing admin instead.
  `forgot-password` always returns the same generic response
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

**Pagination convention**: every list route below (`clients.js`,
`products.js`, `expenses.js`, `quotes.js`, `invoices.js`, `recurring.js`,
`users.js`) follows the same opt-in pattern as `routes/activity.js`'s
original `PAGE_SIZE`/`LIMIT ?  OFFSET ?` approach, but **only paginates when
the request includes `?page=`** — with no `page` param, `GET /` still
returns the full unfiltered/unpaginated array under its usual key (e.g.
`{ clients }`), exactly as before pagination existed. This matters because
`SearchableSelect`-based pickers (the client picker in the Quote/Invoice/
RecurringInvoices forms, the product picker in `LineItemsEditor`) call
`api.clients.list()`/`api.products.list()` with no `page` and expect the
complete list back for local typeahead filtering — making pagination
opt-in rather than always-on keeps those pickers working unmodified. When
`page` *is* present, the response additionally carries
`{ page, pageSize: 20, total, totalPages }` (`PAGE_SIZE = 20` in each of
these files, vs. `activity.js`'s own `PAGE_SIZE = 30`), the same shape
`frontend/src/components/Pagination.jsx` (see below) expects. Each of these
routes also accepts `?q=` (already existed on `clients`/`products`/
`expenses`; added for this feature on `quotes`/`invoices`/`recurring`, which
previously had zero backend search and did 100% client-side filtering) —
`q` and `page` compose freely, and CSV export routes (`GET /export.csv`)
are deliberately untouched by either, always returning every row.

- `routes/clients.js`, `routes/settings.js` — plain CRUD for `clients`, and
  GET/PUT for the single-row `business_settings` table (business name,
  address, tax ID, currency symbol, bank details, `session_timeout_minutes`
  — see "Idle session timeout" below — this is what prints on every PDF's
  header/footer, plus the one security policy value). `clients.js` also has
  `GET /export.csv` (registered before `GET /:id` so it isn't shadowed by
  the `:id` param). `PUT /` validates `session_timeout_minutes` is a whole
  number between 1 and 480. `GET /` supports `?q=` (name/email) and
  `?page=` (see "Pagination convention" above).
- `routes/products.js` — plain CRUD for `products` (name/description/
  unit_price/`tax_rate`), `GET /` supports `?q=` search and `?page=` (see
  "Pagination convention" above). `tax_rate` (percent, 0–100, validated on
  create/update) is optional per product and defaults to 0 — it exists so a
  product's tax can auto-fill the quote/invoice's single document-level
  `tax_rate` field the moment it's picked from the catalog (see
  `components/LineItemsEditor.jsx` below); there's no per-line-item tax
  anywhere in the data model, only the one document-level rate
  `lib/totals.js` already computes against, so "add a product's tax" always
  means "set the whole document's tax rate to that product's rate," not a
  new field on the line item itself. This is a standalone reusable
  catalog, not a source of truth referenced by anything else: `invoice_items`/
  `quote_items`/`recurring_invoice_items` still store `description`/
  `unit_price` as plain denormalized values, not a `product_id` foreign key
  — a product is a convenience the frontend copies from once when a line
  item is added (see `components/LineItemsEditor.jsx` below), not a live
  link, so editing or deleting a product never touches historical
  quotes/invoices. No delete guard is needed for the same reason.
- `routes/quotes.js`, `routes/invoices.js` — CRUD plus PDF download
  (`GET /:id/pdf`), email send (`POST /:id/send`), `POST /:id/duplicate`
  (copies client/items/discount/tax/notes into a new `draft` with a fresh
  number, `public_token`, and today's date — invoice duplicate also resets
  `due_date` to +14 days), and `GET /export.csv`. `GET /` supports
  `?status=`, plus `?q=` (matching document number, joined client name, and
  status — the same fields the frontend used to filter client-side before
  this route grew server-side search) and `?page=` (see "Pagination
  convention" above); `status`/`q` compose (both narrow the same query), and
  `?status=` predates this feature — it's not currently driven by any
  frontend UI on the list pages, but stays available for other callers.
  Invoices only:
  `POST /:id/remind` and `POST /:id/payments`. `quotes.js` also has
  `POST /:id/convert-to-invoice`, which copies the quote's line items into
  a new invoice and stamps `quotes.converted_invoice_id`. Both accept
  `discount_type` (`percentage|fixed`) and `discount_value` on create/update,
  computed via `lib/totals.js`. Every mutation (create/update/delete/send/
  duplicate/convert/payment) calls `lib/activity.js`'s `logActivity()`.
  **Invoices only** (not quotes): `PUT /:id` rejects with 409 once
  `status` is `sent` or `paid` — "This invoice has already been sent or
  paid and can no longer be edited." A `void` invoice stays editable (it's
  still a correctable mistake, not a delivered/settled document), and
  `draft` is always editable. This only blocks the edit route itself —
  `/duplicate` (which creates a fresh draft copy) and recording a payment
  are unaffected, and deletion is still governed separately by the
  existing "has recorded payments" guard below.
- `routes/expenses.js` — CRUD for `expenses` (category/description/amount/
  expense_date/notes) plus `GET /` (`?q=` search, `?page=` — see
  "Pagination convention" above) and `GET /export.csv`. `GET /` also always
  returns `totalAmount` (`SUM(amount)` over every row matching the current
  `?q=` filter, computed independently of `LIMIT`/`OFFSET`) alongside
  `expenses` — `Expenses.jsx`'s "Total" row reads this rather than summing
  the current page's `expenses` array, so the total stays the true
  search-filtered grand total once pagination means that array is no longer
  the complete result set. `CATEGORIES` is a fixed list (`rent, utilities,
  supplies, salaries, marketing, software, travel, other`) served to the
  frontend for the category `<select>`.
- `routes/recurring.js` — CRUD for `recurring_invoices` (+ their
  `recurring_invoice_items` template line items) mounted at
  `/api/recurring-invoices`. Frequency is `weekly|monthly|yearly`. `GET /`
  supports `?q=` (client name or frequency) and `?page=` (see "Pagination
  convention" above). Creating/
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
  `invoiceNumberForYear(year)`/`quoteNumberForYear(year)`/
  `receiptNumberForYear(year)` are the same scheme for an arbitrary
  (possibly past) year rather than always "now" — used only by
  `routes/import.js` so a historical invoice gets numbered under its own
  issue year instead of the current one.
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
  enough quoting/escaping for this app's exports. `parseCsv(text)` is the
  counterpart — a small state-machine parser (handles quoted fields with
  embedded commas/newlines/escaped quotes, \r\n or \n line endings) that
  backs `routes/import.js`.
- `routes/import.js` — `POST /api/import/:type` (`type` is `clients`,
  `expenses`, or `invoices`) bulk-imports historical data from CSV text in
  the request body. Always validates every row first; `commit: false`
  (the default) is a dry-run that reports what *would* happen with no DB
  writes, `commit: true` actually inserts the valid rows and skips the
  invalid ones — the frontend always previews before offering to commit.
  Each row gets a `{ row, status: 'ok'|'error', message, preview }` result,
  so partial success is normal, not a failure state. Invoices are matched
  to an existing client by email (import clients first) and require a
  single `amount` rather than itemized line items — it's run through the
  same `computeTotals()` every other invoice uses, just with one synthetic
  line item. An optional `amount_paid`/`paid_date` creates a real `payments`
  row too (not just a number on the invoice), so imported history shows up
  correctly in `recentPayments`/`monthlyTrend` on the financials endpoint,
  not just in the invoice's own totals. Invoice numbers default to the same
  `INV-<year>-####` scheme as live invoices — but year-of-issue-date, not
  year-of-import, via `numbering.js`'s `invoiceNumberForYear()` — or you can
  supply your own `number` column to preserve original historical numbers.
  Within one import batch, auto-generated numbers are handed out from an
  in-memory per-year counter (`makeSequencer()`) seeded from the real DB
  count, rather than re-querying per row — needed because preview mode
  never writes anything, so two same-year rows calling the DB-backed
  numbering function directly would collide on the same "next" number.
  Whole commit runs in one `db.transaction()` since an invoice import
  writes to three tables (`invoices`, `invoice_items`, `payments`) per row.
  Logs one summary `activity_log` entry per import ("bulk imported 42
  clients from CSV"), not one per row.
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
    `last_reminder_sent_at`. After the loop, if any reminders actually went
    out, calls `notifyStaffOfReminders(reminded, settings)` — queries
    `users` for `active = 1 AND notify_overdue = 1` and emails each an HTML
    digest listing every invoice that was just reminded (number/client/
    balance/due date). This is opt-in per-user (see `PUT
    /api/auth/preferences` above) and best-effort: each recipient send is
    its own try/catch so one bad address never blocks the others, and since
    it only runs after the SMTP-configured check above, it's naturally
    dormant (never even reached) when SMTP isn't set — no separate gate
    needed.
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

### Roles and permissions (`backend/src/`)

- Two roles: `admin` (bypasses `user_permissions` entirely — see
  `hasPermission()` in `lib/permissions.js` above) and `staff` (subject to
  granular per-module `can_view`/`can_manage` grants, default-deny). New
  rows default to `role: 'staff'`, but the migration that introduced this
  column (see `db/index.js` above) one-time-promoted every pre-existing
  user to `admin` so shipping this feature could never silently strip
  access from someone already using the app.
- `routes/users.js` (mounted at `/api/users`, `requireAuth` +
  `requirePermission('users', 'view'|'manage')` per route) — the in-app
  admin user-management API: `GET /` (list), `GET /:id` (user +
  `getPermissions()`), `POST /` (create — name/email/password/role,
  optional `permissions` map applied via `setPermissions()`), `PUT /:id`
  (update name/email/role/active/permissions), `POST /:id/reset-password`
  (admin sets a new password directly, no current-password check), `DELETE
  /:id`, and `GET /meta/modules` (returns `MODULES`, for building the
  permissions checkbox grid client-side). `GET /` supports `?q=` (name or
  email) and `?page=` (see "Pagination convention" above). Two safety guards, both checked
  via `activeAdminCount(excludingUserId)`: you can't demote/deactivate/
  delete the last active admin (409), and `DELETE /:id` also blocks
  deleting your own account (400) — both prevent a click from locking
  everyone out. `publicUser()` here (separate from `routes/auth.js`'s) is
  the shape sent for user-management views:
  `{id, name, email, role, active, notify_overdue, created_at}`.
- `routes/search.js` doesn't use `requirePermission` as route middleware
  the way every other business route does — instead each of its four
  per-entity queries (clients/quotes/invoices/expenses) is independently
  wrapped in a `hasPermission(req.user, module, 'view') ? query() : []`
  check, so a partial-access user gets partial results back rather than a
  blanket 403 for the whole search.
- Every other business route file (`clients.js`, `quotes.js`, `invoices.js`,
  `expenses.js`, `recurring.js`, `financials.js`, `activity.js`,
  `settings.js`, `import.js`) applies `requirePermission(module, 'view')`
  to its `GET`s and `requirePermission(module, 'manage')` to everything
  that mutates, chained after the shared `requireAuth`. One route needs two
  grants: `quotes.js`'s `POST /:id/convert-to-invoice` requires both
  `quotes:manage` (it's mutating the quote) and `invoices:manage` (it's
  also creating a new invoice), chained as two middlewares in sequence.
  `import.js` applies `requirePermission('import', 'manage')` once via
  `router.use()` right after `router.use(requireAuth)`, since every route
  in that file is a mutation (there's no read-only CSV-import action).

### Idle session timeout

Separate from the JWT's fixed 7-day expiry (see `middleware/auth.js` above),
the frontend auto-logs-out anyone idle for too long — this is purely a
client-side UX/security layer, not a server-side session: the JWT itself
stays valid until it expires either way, "logging out" just means the
frontend stops holding/sending it.

- `business_settings.session_timeout_minutes` (default 30, admin-editable
  1–480 via the Settings page) is the single policy value, and it applies
  to **every** logged-in user regardless of their own permission grants —
  unlike the rest of `business_settings`, it's returned as a top-level
  `sessionTimeoutMinutes` field on `POST /api/auth/login` and `GET
  /api/auth/me` (see `routes/auth.js`'s `getSessionTimeoutMinutes()`)
  rather than gated behind `GET /api/settings`'s `settings:view`
  permission — a staff member with no settings access still needs to be
  timed out on the same policy as everyone else.
- `context/AuthContext.jsx` stores `sessionTimeoutMinutes` alongside
  `permissions`, set by both `login()` and the `/me` bootstrap effect.
- `components/IdleTimeoutMonitor.jsx` (mounted once in `App.jsx`, always
  present regardless of route) does the actual tracking: a ref holds the
  last-activity timestamp, updated by `mousemove`/`mousedown`/`keydown`/
  `touchstart`/`scroll` listeners, checked every second against
  `sessionTimeoutMinutes * 60_000`. At `min(60s, half the total timeout)`
  before expiry it shows a "Still there?" modal with a live countdown and
  two actions — "Stay signed in" resets the clock, "Log out now" ends the
  session immediately. If neither happens before the countdown reaches
  zero, it logs out automatically. Once the modal is showing, background
  mouse/keyboard activity deliberately stops resetting the clock (a
  `warningActiveRef` guards this) — only an explicit "Stay signed in"
  click does, so a stray cursor twitch can't silently dismiss a warning
  nobody consciously acknowledged.
- The auto-logout redirect hands its banner message
  ("You've been logged out due to inactivity.") to `Login.jsx` via
  `sessionStorage` (`IDLE_LOGOUT_MESSAGE_KEY`, exported from
  `IdleTimeoutMonitor.jsx`), **not** `navigate(..., { state })` like
  `ResetPassword.jsx` uses for its own post-redirect banner. That pattern
  doesn't survive here: clearing the token triggers `ProtectedRoute` to
  independently redirect to `/login` too as soon as it re-renders with
  `token` now falsy, and whichever of the two redirects' history entries
  wins silently drops the other's `state` — regardless of which call
  happens first in source order, since both are part of the same render
  batch. `sessionStorage` sidesteps the race entirely since it isn't
  routing state; `Login.jsx` reads and immediately clears the key on mount
  (falling back to `location.state?.message` for other callers like
  `ResetPassword.jsx`, which redirect from a public route with no
  competing `ProtectedRoute` redirect to race against).

### Frontend (`frontend/src/`)

- `context/AuthContext.jsx` — the single source of truth for auth state.
  Holds the JWT (persisted in `localStorage`), the current user, and the
  current `permissions` map, fetched via `GET /api/auth/me` on load to
  validate the stored token. Exposes `login(token, user, permissions)` /
  `logout()` / `updateUser(nextUser)` (for pages that edit the current
  user's own profile, to update in-memory state without a full `/me`
  round-trip) and `can(module, level = 'view')`, which reads the
  `permissions` map the same way the backend's `hasPermission()` does — no
  separate admin special-case needed here since the backend's
  `effectivePermissions()` already sends admins an all-true map. Any
  component that needs to know if someone is signed in, or whether they
  can see/do something, should read `useAuth()`, not touch `localStorage`
  or re-derive permission logic directly.
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
- `pages/` — one component per route (`Landing`, `Login`, `ForgotPassword`,
  `ResetPassword`, `Dashboard`, `Users`, `MyAccount`), wired up in
  `App.jsx` via `react-router-dom`. There is no `Signup` page or `/signup`
  route — see `routes/auth.js` above for why. `Users.jsx` (route `/users`)
  is the admin user-management UI: lists users, and (behind
  `can('users', 'manage')`) a create/edit form with a module × view/manage
  checkbox grid built from `api.users.modules()`, reset-password and
  delete actions, and the row-level "(you)" tag / self-delete guard on the
  frontend that mirrors the backend's own last-admin/self-delete guards
  (`routes/users.js` above) — those guards are enforced server-side
  regardless, the frontend copy is just so the error surfaces as expected
  UI rather than a raw 409. `MyAccount.jsx` (route `/account`) is the
  personal-settings page every logged-in user gets, admin or staff alike:
  profile (name/email via `api.updateMe`), change password
  (`api.changePassword`), and the `notify_overdue` toggle
  (`api.updatePreferences`) — deliberately separate from the shared
  `Settings.jsx` (business name/address/tax ID/etc.), which is
  organization-wide config, not a personal preference. Both pages guard
  themselves at the top of the component (`if (!can(module, 'view'))
  return <...not authorized...>`) for the case of someone reaching the
  route directly by URL rather than through a nav link — same pattern
  `Dashboard.jsx` already used for its financials-gated view before this
  feature existed. `ForgotPassword`/`ResetPassword` are public routes;
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
  Every page in this directory reads `can(module, 'manage')` from
  `useAuth()` and conditionally renders its New/Edit/Delete/Send/Duplicate/
  Record-payment/etc. buttons and table-action columns on it — a view-only
  user still sees the list/detail data (gated separately by `can(module,
  'view')`, enforced by `ProtectedRoute` + the page load itself 403ing) but
  never sees a button that would just 403 on click; this is UX polish only,
  the real enforcement is the backend's `requirePermission` on each route.
  The `/new` and `/:id/edit` form pages (`InvoiceForm.jsx`, `QuoteForm.jsx`)
  additionally guard themselves at the top of the component (same
  `if (!canManage) return <...not authorized...>` pattern as `Users.jsx`/
  `MyAccount.jsx` above) since those routes are reachable directly by URL
  even when no link to them is rendered. `InvoiceForm.jsx` has a second,
  independent guard on top of that one: after fetching the invoice being
  edited, if its `status` is `sent` or `paid` it sets `lockedStatus` and
  renders a "can no longer be edited" message with a link back to the
  detail page instead of the form — this mirrors the backend's `PUT /:id`
  409 (see `routes/invoices.js` above) so a locked invoice never even shows
  editable fields, rather than letting someone fill out the form and only
  finding out it's rejected on submit. `InvoiceDetail.jsx` computes the
  same `isLocked` check to hide the "Edit" link and show a one-line notice
  ("This invoice has been sent to the client / paid and can no longer be
  edited") — `Delete` is intentionally *not* gated by this, since deleting
  a sent-but-unpaid invoice is still allowed (governed separately by the
  backend's "has recorded payments" guard). Any page that calls
  `api.settings.get()` for the currency-symbol fallback does so with a
  trailing `.catch(() => {})` — `settings` is its own gated module now, so
  a staff user without `settings:view` would otherwise leave an unhandled
  promise rejection on every page load; the page just falls back to `$`.
  `InvoiceForm.jsx`'s `dueDate` and `QuoteForm.jsx`'s `expiryDate` default
  to `todayPlus(14)`/`todayPlus(30)` respectively on create (only
  overwritten by the real stored value when editing) — a still-usable
  placeholder rather than an empty date input someone has to fill in
  themselves every time. The Client field on `InvoiceForm.jsx`,
  `QuoteForm.jsx`, and `RecurringInvoices.jsx` uses
  `components/SearchableSelect.jsx` (a type-to-filter combobox: text input
  + a matching dropdown list, keyboard nav, click-outside-to-close) instead
  of a plain `<select>` — the same component in all three places so the
  client field behaves identically everywhere it appears. Because it's a
  custom widget rather than a native form control, it can't carry an HTML
  `required` attribute, so each of those three forms checks
  `if (!clientId)` itself in `handleSubmit` and sets the same `error` state
  the rest of the form already displays on, rather than relying on
  browser-native validation for just this one field.
  `components/LineItemsEditor.jsx` and `components/StatusBadge.jsx` are
  shared between the quote and invoice form/detail pages — extend those
  rather than duplicating item-row or status-color logic per page.
  `LineItemsEditor` also takes an optional `products` array prop (each
  form fetches `api.products.list()` — with no `q`/`page` args, so it gets
  the full catalog for local typeahead rather than a paginated slice, per
  the "Pagination convention" note above — alongside clients/settings and
  passes it down); when non-empty it renders a searchable product picker
  (an inline `ProductPicker` sub-component defined in the same file — a
  type-to-filter combobox modeled on `SearchableSelect.jsx`, but that never
  "holds" a selected value: every pick immediately appends a new line item
  and resets back to an empty search box, matching the old plain
  `<select>`'s one-shot `e.target.value = ''` reset behavior rather than
  `SearchableSelect`'s persistent-selection behavior) that appends a new
  line item pre-filled with that product's `name`/`unit_price` — a one-time
  copy, not a live link, so the row is still freely editable afterward and
  never references the product again (see `routes/products.js` above for
  why). An optional `onProductTaxRate(rate)` callback fires every time a
  product is picked, passed the product's `tax_rate` (0 if unset) —
  `QuoteForm.jsx`/`InvoiceForm.jsx` wire this straight to their own
  `setTaxRate`, so picking a product auto-fills the document's single
  tax-rate field to match (see `routes/products.js` above for why this is
  document-level, not per-line-item); the *last* product picked wins if
  more than one is added with different rates, since there's nowhere else
  for a second rate to go. A `catalogOnly` boolean prop (set by
  `QuoteForm.jsx`/`InvoiceForm.jsx` only, **not** by `RecurringInvoices.jsx`
  — recurring templates still allow free-text manual entry) hides the
  "+ Add item" manual-entry button entirely and makes each item's
  description input `readOnly` (grayed out), so a line item on those two
  forms can only be created by picking from the catalog — quantity and unit
  price stay freely editable either way, only the *entry method* is
  restricted, and pre-existing manually-typed items on an invoice/quote
  being edited still display and remain editable, they just can't be
  created fresh that way going forward. Because `catalogOnly` forms start
  with an empty `items` array (there's no default blank row to fill in
  manually anymore), both forms check `items.length === 0` in
  `handleSubmit` and show the same inline `error` state the rest of the
  form uses ("Please add at least one item from the product catalog") —
  mirroring `lib/totals.js`'s own "at least one line item is required"
  guard so the failure surfaces before the request round-trip rather than
  only as a 400 from the backend. `Products.jsx`
  itself follows the same list+inline-form+FAB pattern as `Clients.jsx`,
  plus a "Tax rate (%)" field (0–100) in the create/edit form and a "Tax"
  column in the list table.
  `Expenses.jsx` and `RecurringInvoices.jsx` also follow that pattern (no
  separate detail page — edit happens inline in the list).
  `ActivityLog.jsx` is a simple paginated read-only list. `Import.jsx` (linked from `Settings.jsx`, not a top-level
  Navbar item — it's a rare-use admin tool) reads a chosen CSV file
  client-side via `FileReader`, calls `api.import.run(type, csv, commit,
  token)` first with `commit: false` to preview, then again with `commit:
  true` after the user reviews the row-by-row results and confirms —
  mirrors the two-phase `POST /api/import/:type` contract exactly, the
  frontend does no CSV parsing of its own. Per-type CSV templates are
  generated client-side as static strings and downloaded via a blob URL,
  the same throwaway-`<a>` pattern as `downloadFile()` in `lib/api.js`.
- `components/GlobalSearch.jsx` — a debounced (250ms) search box that calls
  `api.search.query()` and renders a grouped dropdown (clients/quotes/
  invoices/expenses); clicking a result navigates there. Mounted twice in
  `Navbar.jsx` — once in the desktop nav (narrower, `hidden lg:flex`) and
  once inside the mobile slide-down menu — both instances exist in the DOM
  simultaneously, so anything that queries this input in tests must scope
  to the visible one. Has its own inline `×` clear button (same
  `aria-label="Clear search"` pattern as `SearchInput.jsx`, but hand-rolled
  since this component doesn't use `SearchInput` — it needs the dropdown-open
  behavior `SearchInput` doesn't have) that appears whenever `query` is
  non-empty and resets it to `''`.
- `components/SearchInput.jsx` — the search box used by every business list
  page (Clients/Products/Expenses/Quotes/Invoices/RecurringInvoices/Users).
  Renders a leading search icon and, whenever `value` is non-empty, a
  trailing `×` clear button (`aria-label="Clear search"`) that calls
  `onChange('')` — the one place this behavior is implemented, so every
  page using `SearchInput` gets it for free rather than each page wiring up
  its own clear button.
- `components/Pagination.jsx` — the shared Previous/Next pager for every
  server-paginated list page, extracted from the pattern
  `pages/business/ActivityLog.jsx` established first. Takes
  `{ page, totalPages, onChange }` — the same `{ page, totalPages }` shape
  every paginated list endpoint's response carries (see "Pagination
  convention" above) — and renders nothing when `totalPages <= 1`. Every
  list page that fetches with a `page` state variable follows the same
  shape: `useEffect` re-fetches on `[token, search, page]` change, a
  separate `useEffect` resets `page` back to `1` whenever `search` changes
  (so a new search always starts from page 1 instead of potentially landing
  past the end of the filtered result set), and the response's pagination
  fields are stored separately from the list itself (e.g.
  `pageInfo`) so `<Pagination>` only renders once a paginated response has
  actually come back (i.e. `pageInfo` stays `null` until a `page` param was
  sent and `totalPages` was present in the response).
- `components/Navbar.jsx` — `BUSINESS_LINKS` entries each carry a `module`
  (`null` for Dashboard, which is always visible); the rendered link list
  is filtered through `can(link.module, 'view')` so a restricted user never
  sees a nav link leading to a page that would just reject them — same
  UX-only caveat as the business-page button gating above, not a security
  boundary on its own. "My account" is appended after the filtered links,
  unconditionally visible to any logged-in user (admin or staff) since it's
  never permission-gated.
- `pages/Dashboard.jsx` — `SHORTCUTS` (the quick-link tiles) each carry a
  `module` and are filtered through `can(s.module, 'view')` the same way as
  `Navbar.jsx`'s links. The whole KPI/chart view additionally requires
  `can('financials', 'view')`; a staff user without it sees just the
  filtered shortcut tiles instead (with a "nothing to show yet" message if
  even those are empty), never a loading spinner that never resolves — the
  financials API call itself is skipped entirely rather than made and
  403ing.
- `pages/Dashboard.jsx` and `pages/business/Financials.jsx` charts
  (`components/RevenueTrendChart.jsx`, `components/StatusBreakdownChart.jsx`)
  are hand-rolled SVG/CSS, no charting library. Status colors there are
  pinned to match `StatusBadge`/`lib/pdf.js` (draft=slate, sent=indigo,
  paid=emerald, void=red) rather than a generic categorical palette —
  status is state, not series identity, so don't reassign those colors when
  adding a chart. Both pages also share `components/KpiCard.jsx` (icon +
  label + value + optional `sub` context line, `tone` picks the icon-circle
  and value color from a fixed neutral/positive/negative/warning set) and
  `components/MeterBar.jsx` (a labeled progress bar — fill color and its
  fixed-lighter-step track color come from the same `tone`-style palette) so
  a KPI or a rate means the same thing everywhere it's used, rather than
  each page inventing its own ad hoc card styling. `components/icons.jsx`
  is a small set of hand-rolled 20×20 outline icons (no icon-library
  dependency) used inside `KpiCard`'s tinted circle.
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

1. An admin creates the account — out-of-band with `npm run create-user`
   for the bootstrap/recovery path (always `role: 'admin'`), or in-app via
   the Users page for ongoing staff accounts with granular permissions (see
   "Roles and permissions" above); there is no self-serve signup. The
   `Login` page submits to `api.login`.
2. On success, the returned `{ token, user, permissions }` is passed to
   `AuthContext.login()`, which persists the token and updates state,
   including the `permissions` map `can()` reads from.
3. `ProtectedRoute` (used for every authenticated route, including
   `/dashboard`, `/users`, and `/account`) checks `AuthContext` and
   redirects unauthenticated visitors to `/login`; it only checks that
   *someone* is logged in — per-module authorization is a separate check
   each page does itself via `can()` (see "Roles and permissions"/frontend
   sections above), not something `ProtectedRoute` is aware of.
4. Every subsequent authenticated request (e.g. the `/auth/me` check on
   page load) sends the token as `Authorization: Bearer <token>`, verified
   server-side by `requireAuth`, which re-fetches the live user row on
   every call — so a role/permission change or deactivation made by an
   admin takes effect on that user's very next request, not after their
   JWT eventually expires.
5. Forgotten passwords: `ForgotPassword` submits an email to
   `api.forgotPassword`, which always shows the same generic success
   message (see `routes/auth.js` above). The emailed link
   (`/reset-password?token=...`) opens `ResetPassword`, which submits the
   new password + token to `api.resetPassword` and redirects to `/login`
   with a success banner.
