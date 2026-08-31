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

- `index.js` — Express app entry point: `compression()` (gzips every
  response above the package's default 1kb threshold — JSON list payloads,
  PDF downloads, etc.; the frontend's own static assets already get this
  from Render's CDN, but this Node API service doesn't compress its own
  responses unless told to, so this was added once the API side of the app
  was audited for the same thing), CORS (restricted to `CLIENT_ORIGIN` from
  env), JSON body parsing, mounts routes under `/api`, 404 + error
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
  guarded by a `PRAGMA table_info(products)` check. Same pattern again for
  `licenses.url` (see `routes/licenses.js` below) — this one is a cautionary
  example of the rule this section opens with: a brand-new table only
  needs a plain `CREATE TABLE IF NOT EXISTS` edit *the first time it's
  created*, but the moment that table has shipped and a real deploy has
  run against it even once, every column added afterward needs the
  `ALTER TABLE` treatment regardless of how "new" the feature still feels —
  `url` was added to the `licenses` `CREATE TABLE` statement directly
  (reasoning, at the time, that the table itself was created earlier in the
  same work session so surely had no production data yet), but the
  Licenses feature had already been deployed by then, so every environment
  that had pulled that earlier deploy still had a `licenses` table with no
  `url` column — every write naming that column (manual create/edit,
  `POST /api/import/licenses`) 500'd with "table licenses has no column
  named url" until the follow-up `ALTER TABLE licenses ADD COLUMN url TEXT
  NOT NULL DEFAULT ''`, guarded by the usual `PRAGMA table_info(licenses)`
  check. Same pattern once more for `business_settings.starting_balance`
  (see "Bank balance" in `routes/financials.js` below) — added directly to
  the `ALTER TABLE` migration list this time, having learned the `licenses.url`
  lesson above, since `business_settings`'s single row has had real
  production data since the very first deploy. Same pattern again for
  `expenses.payee` (see "Expense filters" in `routes/expenses.js` below) —
  `expenses` has carried real rows since long before this column existed.
  Same pattern once more for `expenses.exchange_rate`/
  `payee_account_number`/`usd_destination` (see "Currency exchange
  details" in `routes/expenses.js` below) — same reasoning, `expenses`
  already had real rows. Same pattern again for `client_viewed_at` on both
  `quotes` and `invoices` (see "Client view tracking" in `routes/public.js`
  below) — both tables have carried real documents since the app's first
  deploy, so this went straight into the `ALTER TABLE` list rather than the
  `CREATE TABLE` statement, same lesson `licenses.url` learned the hard
  way. Same pattern once more for `users.notify_payment_proofs` (see
  "Payment proof upload" below) — `users` already had real accounts by
  then too. `payment_proofs` itself, by contrast, is a brand-new table
  with no prior deploy to carry forward, so it's a plain `CREATE TABLE IF
  NOT EXISTS` edit, same as `client_portal_accounts` was when the portal
  itself first shipped.
- **Indexes**: same file's tail also carries a block of
  `CREATE INDEX IF NOT EXISTS` statements — safe to append to on every
  boot the same way the `CREATE TABLE IF NOT EXISTS` statements above it
  are, since an index needs no data migration the way a new column does
  (see the `ALTER TABLE` discussion above); a fresh index on an
  already-populated table just gets built once, next startup. The
  original set only covered foreign keys (`quotes.client_id`,
  `invoices.client_id`, `licenses.client_id`, etc.) and a few
  `created_at` columns; an audit of this file's own most frequent
  queries — every list route's default `ORDER BY`, `lib/scheduler.js`'s
  daily cron jobs (`WHERE status = 'sent' AND due_date < ?`, `WHERE
  active = 1 AND next_run_date <= ?`, etc.), and `routes/reports.js`'s
  date-range `SUM`s — found a second wave of columns driving a full table
  scan on every one of those, unindexed since SQLite only auto-indexes
  `PRIMARY KEY`/`UNIQUE` columns, not a plain column named in a `WHERE`/
  `ORDER BY`. Added: `invoices(status, due_date)` (composite, matching
  the scheduler's overdue-reminder query exactly — equality column
  first, range column second, per SQLite's own left-to-right index
  usage), `invoices(issue_date)`, `quotes(status)`, `quotes(issue_date)`,
  `quotes(expiry_date)` (the `expireOverdueQuotes` job's own filter),
  `expenses(expense_date)`, `expenses(category)`,
  `recurring_invoices(client_id)` (the one table among
  quotes/invoices/licenses/recurring_invoices that was missing this —
  presumably an oversight when `recurring_invoice_items`'s own FK index
  was added instead), `recurring_invoices(next_run_date)`,
  `payments(paid_at)`, `capital_contributions(contribution_date)`,
  `owner_draws(draw_date)`, `license_renewals(license_id)`,
  `quote_requests(status)`, and `activity_log(entity_type, action)` (the
  exact composite every analytics route's `activity_log` lookup already
  filters on — `WHERE entity_type = 'invoice' AND action = 'voided'` and
  its siblings in `routes/quotes.js`/`routes/licenses.js`). Verified with
  `EXPLAIN QUERY PLAN` against each of the actual queries above — every
  one now reports `SEARCH ... USING INDEX` (or `SCAN ... USING INDEX` for
  the plain `ORDER BY` cases) instead of a bare table scan. Harmless at
  this app's current row counts — nothing here changes behavior, only
  how SQLite gets there — but each mirrors a query this app already runs
  on every relevant page load or every day via the scheduler, so the
  gap only would have grown as a business accumulates real history.
  Deliberately *not* added: a composite `(license_id, renewed_at)` on
  `license_renewals` to avoid its own query's small `TEMP B-TREE FOR
  ORDER BY` step — a single license's renewal history is inherently tiny
  (see `routes/licenses.js`'s own note on `GET /:id/renewals`), so
  sorting that in memory after the index narrows to one license's rows
  isn't worth a second index; and a plain index on `owner_draws(type)` or
  similar two-value enum columns elsewhere, since a column with only two
  distinct values gives SQLite's query planner little to narrow down —
  the *date* half of each of those composite-shaped queries is what
  actually cuts the row count, which is exactly the column that got
  indexed instead.
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
  `licenses`, `financials`, `activity`, `settings`, `users`, `import`,
  `campaigns`) —
  kept as a hardcoded list
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
`q` and `page` compose freely, and export routes (`GET /export.csv`/
`GET /export.xlsx` — see `lib/xlsx.js` above for why every export-capable
route ships both formats from one shared row/column definition) are
deliberately untouched by either, always returning every row.

- `routes/clients.js`, `routes/settings.js` — plain CRUD for `clients`, and
  GET/PUT for the single-row `business_settings` table (business name,
  address, tax ID, currency symbol, bank details, `session_timeout_minutes`
  — see "Idle session timeout" below — this is what prints on every PDF's
  header/footer, plus the one security policy value). `clients.js` also has
  `GET /export.csv`/`GET /export.xlsx` (both registered before `GET /:id`
  so neither is shadowed by the `:id` param). `PUT /` validates
  `session_timeout_minutes` is a whole
  number between 1 and 480, and `starting_balance` is any finite number
  (negative allowed — an overdraft on the day you started using the app is
  a valid starting point, see "Bank balance" in `routes/financials.js`
  below). `GET /` supports `?q=` (name/email) and
  `?page=` (see "Pagination convention" above). `Clients.jsx`'s own list
  shows `address` as its own column too, alongside the existing
  `phone` — same `|| '—'` em-dash-when-blank treatment `phone` already
  has, both on the desktop table and the mobile `MobileListAccordion`
  detail rows. The desktop cell is capped (`max-w-xs truncate`, with a
  `title` attribute carrying the full text) rather than `whitespace-nowrap`
  like every other column in this table, since an address is free text
  that can run much longer than a name/email/phone and would otherwise
  force the table far wider than it needs to be; the mobile row has no
  such cap, since it already wraps naturally onto its own line with no
  competing columns to protect.
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
  `visible_in_portal` (boolean, defaults `false`/0 — same `ALTER TABLE`
  migration pattern `tax_rate` itself used, added after `products` already
  had real catalog rows) opts a product into the client portal's own
  catalog (see `routes/clientPortal.js`'s `GET /products` below) — the
  full catalog here is still what staff sees on `Products.jsx`/the
  quote/invoice `LineItemsEditor` picker; only an admin-opted-in subset is
  ever exposed to a client. Defaulting to hidden rather than visible was
  deliberate: flipping the whole existing catalog client-visible the
  moment this shipped would be a much bigger, more surprising change than
  requiring each product to be explicitly reviewed and opted in one at a
  time. `Products.jsx`'s create/edit form gets a "Visible in client
  portal" checkbox (with a one-line explanation of what it does), and the
  list (desktop table + `MobileListAccordion`) shows a small emerald
  "Portal" badge next to a product's name when it's on — same
  only-show-the-exception-case convention as `Clients.jsx`'s own
  `PortalBadge` (nothing rendered for the common, unopted-in case).
- `routes/quotes.js`, `routes/invoices.js` — CRUD plus PDF download
  (`GET /:id/pdf`), email send (`POST /:id/send`), `POST /:id/duplicate`
  (copies client/items/discount/tax/notes into a new `draft` with a fresh
  number, `public_token`, and today's date — invoice duplicate also resets
  `due_date` to +14 days), and `GET /export.csv`/`GET /export.xlsx`. `GET /` supports
  `?status=`, plus `?q=` (matching document number, joined client name, and
  status — the same fields the frontend used to filter client-side before
  this route grew server-side search) and `?page=` (see "Pagination
  convention" above); `status`/`q` compose (both narrow the same query), and
  `?status=` predates this feature — it's not currently driven by any
  frontend UI on the list pages, but stays available for other callers.
  **Export/reimport**: unlike `clients`/`expenses`/`licenses`/`products`,
  this export is deliberately *not* a full reimport source, and can't be
  made one by renaming columns the way those four were — `loadInvoiceExport()`/
  `loadQuoteExport()` gained `Client email` (alongside the existing
  `Client` column, renamed `Client name`) purely so client-matching
  works correctly if someone tries reimporting this file, mirroring
  `routes/licenses.js`'s own fix for the same "Client" mismatch. But
  `routes/import.js`'s `processInvoices()`/`processQuotes()` always
  collapse a document to one synthetic line item with a hardcoded zero
  discount (see those functions' own `INSERT` statements) — there's no
  column here (`Subtotal`/`Discount`/`Tax`/`Total`/`Amount paid`/`Balance
  due`, all aggregated/computed figures) that reverses safely to the raw
  `amount`/`tax_rate`/`description` the importer needs, and a document
  that ever had a real discount or more than one line item would
  reimport to a *different*, wrong total even with perfect column names
  — worse than the reimport just failing outright. So this stays a
  financial summary/report export, not a backup format; reimporting it
  now correctly fails on the missing `amount` column (with client
  matching no longer masking that behind an unrelated "no client found"
  error) rather than silently producing incorrect figures.
  Invoices only:
  `POST /:id/remind` and `POST /:id/payments`. `quotes.js` also has
  `POST /:id/convert-to-invoice`, which copies the quote's line items into
  a new invoice and stamps `quotes.converted_invoice_id`. Both accept
  `discount_type` (`percentage|fixed`) and `discount_value` on create/update,
  computed via `lib/totals.js`. Every mutation (create/update/delete/send/
  duplicate/convert/payment) calls `lib/activity.js`'s `logActivity()`.
  **PO number**: `invoices.po_number` (`db/index.js`, `ALTER TABLE`-guarded
  — `invoices` has carried real documents since the app's first deploy,
  same lesson `licenses.url` learned the hard way) is an optional,
  free-text field for the *client's own* purchase-order reference, not
  anything this app generates itself — a quote has no equivalent field,
  since a PO number is specifically what a client issues once they've
  actually decided to buy, which is exactly the moment a quote becomes an
  invoice. `POST /:id/convert-to-invoice` accepts an optional `po_number`
  in the body alongside the existing required `due_date` and stores it on
  the new invoice; `POST /` (create) and `PUT /:id` (edit) both accept and
  persist it too — same `notes = ''`-style default-to-empty-string
  treatment `notes` itself gets — so it's not write-once at conversion
  time: staff can add one to a manually-created invoice, or correct one
  after the fact, the same as any other editable invoice field.
  `QuoteDetail.jsx`'s inline "Convert to invoice" form gains a "PO number
  (optional)" text input next to the existing due-date field (that field's
  own default is `todayPlus(30)`, a still-usable placeholder rather than a
  blank date input someone has to fill in themselves every time — same
  reasoning `InvoiceForm.jsx`'s/`QuoteForm.jsx`'s own `todayPlus(...)`
  defaults already document, just its own 30-day figure rather than either
  of theirs);
  `InvoiceForm.jsx`'s create/edit form gains the identical field (loaded
  from the existing invoice on edit, so editing an invoice never silently
  wipes out a PO number set at conversion time — every other optional
  field on this form already round-trips the same explicit way). Shown
  wherever the rest of an invoice's metadata already is, only when
  non-blank (the common case has no PO number, same "only show the
  exception case" convention every other optional field in this app
  follows): `InvoiceDetail.jsx`'s "Details" card, the client-facing public
  link (`PublicInvoice.jsx`) and portal (`PortalInvoiceDetail.jsx`) views,
  the invoice PDF's own header meta rows (`lib/pdf.js`'s `drawHeader`/
  `drawMinimalHeader`, both already conditionally render `TIN`/
  `Prepared By` rows the same way — this is genuinely the field's whole
  point, since a client matching the invoice against their own purchase
  order is what a PO number is *for*), and the `GET /export.csv`/
  `GET /export.xlsx` invoice export.
  **Quotes only, the mirror of invoices' own locked-status guard below**:
  `PUT /:id` on `quotes.js` rejects with 409 once `converted_invoice_id` is
  set — "This quote has already been converted to an invoice and can no
  longer be edited". Before this, edits were silently allowed: a converted
  quote had no effect on the invoice it had already produced (the two
  documents share nothing live, `POST /:id/convert-to-invoice` only ever
  *copies* the quote's client/items/totals once at conversion time), so an
  edit here just quietly diverged from the real, already-sent-or-paid
  invoice with nothing telling staff that had happened. `QuoteForm.jsx`
  mirrors `InvoiceForm.jsx`'s own `lockedStatus` pattern (a `locked` flag
  set after fetching the quote being edited, short-circuiting to a "can no
  longer be edited" message + "View quote" link instead of the form) so
  navigating straight to `/quotes/:id/edit` by URL is blocked the same way,
  not just the button that would normally lead there. `QuoteDetail.jsx`'s
  Edit header button and `Quotes.jsx`'s row-action Edit `IconActionButton`
  are both gated on `!quote.converted_invoice_id` (same "never show a
  button that would just error" convention every other locked-state gate
  in this app already follows — `InvoiceDetail.jsx`'s own `isLocked`/
  `canVoid` checks, `Licenses.jsx`'s Renew/Remind guards); every other
  action (Download PDF, Copy public link, Email to client, Duplicate) stays
  available, since none of those mutate the quote itself. `QuoteDetail.jsx`'s
  "Converted to invoice" notice reads "...and can no longer be edited or
  voided" so the reason the buttons are gone is stated explicitly, not left
  for staff to infer from their absence.
  **Invoices only** (not quotes): `PUT /:id` rejects with 409 once
  `status` is `sent` or `paid` — "This invoice has already been sent or
  paid and can no longer be edited." A `void` invoice stays editable (it's
  still a correctable mistake, not a delivered/settled document), and
  `draft` is always editable. This only blocks the edit route itself —
  `/duplicate` (which creates a fresh draft copy) and recording a payment
  are unaffected. **Invoices only**, also: `POST /:id/void` is the actual
  way an invoice becomes `void` — a dedicated action route rather than a
  `status` value on the generic `PUT /:id` above, because that route
  already 409s once `status` is `sent`/`paid`, but voiding is precisely the
  escape hatch a *sent* invoice needs (cancel a mistake, e.g. a client
  backed out) — it has to work exactly where `PUT` refuses to. (`PUT /:id`
  still technically accepts `status: 'void'` in its body too, but since
  it's blocked for `sent`/`paid` invoices and the frontend never sends a
  `status` field at all, that path is effectively dead — `POST /:id/void`
  is the only route that matters in practice.) Blocked with 409 if the
  invoice is already `void`, already `paid` (voiding real money needs a
  refund process, not a status flip), or has *any* recorded payment at all
  — a partially-paid sent invoice can't have its payments silently orphaned
  by voiding it. Voiding also has ripple effects on the other invoice
  actions, all enforced server-side: `POST /:id/send` and `POST /:id/remind`
  both 409 on a `void` invoice (there's no reason to email or nag a client
  about a cancelled invoice), and `POST /:id/payments` already rejected
  `void` the same as `draft` before this feature existed. A voided invoice
  is excluded from `routes/financials.js`'s summary and the sales/tax PDF
  reports in `routes/reports.js` (both filter `status != 'void'`), the
  same way those already excluded nothing else — void is the only status
  either of them filters out.
- **Neither quotes nor invoices can be deleted, in any circumstance —
  voiding, with a required reason, is the only way to cancel either.** Both
  routers used to carry a `DELETE /:id` (guarded — a quote blocked once
  converted, an invoice blocked once it had any recorded payment), but
  both were removed outright rather than left as a "cancel this by mistake"
  escape hatch: a quote/invoice is a real business record, and this app
  now never lets one simply disappear. This lost no real capability — the
  old `DELETE` guards already only ever let a *zero-payment* invoice
  through (any recorded payment, partial or full, blocked it), and quote
  deletion was already blocked once converted — exactly the same set of
  documents `POST /:id/void` already covers, so removing `DELETE` doesn't
  strand anything that used to be deletable and now isn't reachable any
  other way. Both `POST /:id/void` routes (quotes' own mirrors invoices'
  — see above) now require a non-blank `reason` in the body (400
  otherwise: "A reason is required to void a quote/an invoice"), stored in
  a new `void_reason` column (`quotes`/`invoices`, `db/index.js`,
  `ALTER TABLE`-guarded — both tables have carried real documents since
  the app's first deploy) rather than only living in a one-line
  `activity_log` entry — `logActivity()`'s own `entityLabel` for a void
  is `` `${number} — ${reason}` `` too, so the reason is genuinely
  double-recorded, not just on the row. Voiding a quote is blocked (409)
  once it's already `void`, or once `converted_invoice_id` is set — the
  real transaction has already moved to a live invoice by then, so voiding
  the quote itself would be meaningless; that's the same terminal state
  `PUT /:id` above already locks against, just extended to the new action.
  A voided quote's `total` is excluded from `GET /quotes/analytics`'s
  `amountQuoted`/`totals.totalQuoted` (both now `filter(q => q.status !==
  'void')` before summing) the same way a void invoice is already excluded
  from `amountInvoiced` — a voided quote never became real business, so it
  shouldn't inflate either figure; `byStatus`'s status-count map gained a
  `void: 0` default alongside the original five so a business with no
  voided quotes yet still reports a real zero, not `undefined`. `quotes.js`'s
  `PUT /:id` `validStatuses` also grew a `void` entry (mirroring invoices'
  own list) purely for consistency — the frontend never sends `status` on
  a quote `PUT` either, so this is the same effectively-dead path invoices'
  own copy already documents.
  `components/VoidReasonModal.jsx` is the one shared popup behind every
  void action on either document — a `Modal` wrapping a required textarea
  + Cancel/red "Void" footer, modeled directly on `InvoiceDetail.jsx`'s
  own pre-existing "Reject this payment proof" modal (same shape, a plain
  `confirm()` can't collect free text) — four callers
  (`Quotes.jsx`/`QuoteDetail.jsx`/`Invoices.jsx`/`InvoiceDetail.jsx`) is
  well past this app's own "three real duplicates" bar for promoting a
  pattern into a shared component. The submit button stays disabled until
  the reason is non-blank, and a failed `onVoid()` call keeps the modal
  open with the server's error shown inline rather than closing on
  failure. `Quotes.jsx`/`Invoices.jsx`'s own list-row `TrashIcon` "Delete"
  `IconActionButton` was replaced with an `XIcon` "Void" one (red tone,
  same as the icon `InvoiceDetail.jsx`'s own header Void button already
  used), gated the same way each detail page's own Void button already
  is — `!quote.converted_invoice_id && quote.status !== 'void'` for
  quotes, `(status === 'draft' || status === 'sent') && amount_paid === 0`
  for invoices (a small `canVoid()` helper on each list page, mirroring
  `InvoiceDetail.jsx`'s own) — clicking it opens `VoidReasonModal` for
  that specific row rather than navigating anywhere first.
  `InvoiceDetail.jsx`'s/`QuoteDetail.jsx`'s existing "voided" notice
  (`"This invoice has been voided and is excluded from financial totals
  and reports."` / the quote equivalent) now also renders `` Reason:
  {void_reason} `` right after it, only when the column is actually set —
  the common case for any document voided before this feature shipped has
  a blank `void_reason`, so nothing extra renders for those.
  `lib/api.js`'s `quotes`/`invoices` objects both lost their `remove()`
  entry entirely (there is no `DELETE /:id` left to call) — `void()` on
  both now takes `(id, reason, token)` instead of `(id, token)`.
  `routes/dataReset.js`'s Danger Zone is unaffected by any of this: it
  deletes by raw `DELETE FROM <table>` SQL directly against the tables in
  a transaction, never through these routers' own endpoints, so removing
  `DELETE /:id` here doesn't touch that separate, already
  super-admin-gated, type-`DELETE`-to-confirm bulk-reset tool at all.
- **Invoice/quote analytics**: `GET /invoices/analytics` and
  `GET /quotes/analytics` (both `view`-gated, each registered before its own
  `GET /:id` for the same "don't let `:id` swallow a literal path" reason
  `routes/licenses.js`'s own `GET /analytics` documents — these two are the
  same year-over-year shape applied to invoices/quotes, built when that
  page's pattern was asked for again on these two entities). For every year
  from the earliest issue_date through the current year (gap years included
  at zero, never skipped, same as licenses), `invoices.js` reports
  `issued`/`amountInvoiced` (by `issue_date`; `amountInvoiced` excludes
  `void` invoices, same convention `routes/financials.js`'s own
  `totalInvoiced` and `routes/reports.js` already use) and
  `paymentsReceived`/`amountCollected` (by `payments.paid_at`) — unlike
  `routes/licenses.js`'s `revenueEstimate`, this is an **exact** figure, not
  a proxy: every invoice payment already records its own real amount, so
  there's no "value it at today's price" stand-in needed — plus `voided`
  (by the `activity_log` `'voided'` entry `POST /:id/void` above writes).
  `quotes.js` reports `created`/`amountQuoted` (by `issue_date`, every
  status included — a quote has no void-equivalent status to exclude) and
  `accepted`/`declined` (by `COALESCE(client_responded_at, updated_at)` — a
  client responding via the public link stamps `client_responded_at` (see
  `routes/public.js`'s respond route below), but a status flipped manually
  by staff via `PUT /:id` instead has no dedicated response timestamp, so
  falls back to `updated_at` as the best available proxy for when the
  decision happened) and `converted` (by the `activity_log`
  `'converted to invoice'` entry `POST /:id/convert-to-invoice` below
  writes). Both also return a current-snapshot `byStatus` count map, a
  `topClients` top-5 (by total invoiced/quoted amount, then count — the
  license page's own `topClients` orders by count first since a license
  count matters more there; here the money figure is the more natural
  primary sort), and a `totals` block (all-time sums/counts) —
  `quotes.js`'s totals additionally include `winRate`
  (`accepted / (accepted + declined) * 100`, `null` when nothing's been
  decided yet rather than a division-by-zero `NaN`).
  `pages/business/InvoiceAnalytics.jsx` (route `/invoices/analytics`) and
  `pages/business/QuoteAnalytics.jsx` (route `/quotes/analytics`) are the
  frontend for these, both modeled directly on `pages/business/
  LicenseAnalytics.jsx` (KPI strip via `KpiCard`, a grouped year-by-year bar
  chart, a current-split breakdown panel, a year-by-year table, and a top-
  clients table — desktop `hidden overflow-x-auto sm:block` tables +
  `MobileListAccordion` `sm:hidden` mobile counterparts throughout, per
  "Mobile design system" below) and linked from `Invoices.jsx`'s/
  `Quotes.jsx`'s own header next to "Export CSV", same placement as
  `Licenses.jsx`'s own "Analytics" link. Building a third page on this
  exact shape is also what prompted pulling the shape itself out of
  `LicenseAnalytics.jsx`'s local-only components into two shared ones —
  `components/YearlyBarChart.jsx` (generalized from hardcoded
  `newLicenses`/`renewals` fields to a `series` prop of exactly two
  `{ key, label, color }` entries read off each `data` row) and
  `components/BreakdownBars.jsx` (already fully generic in its original
  local form, so this was a straight lift, no logic changes) — three real
  duplicates of the same chart code was the threshold for promoting it,
  matching every other shared component in this app (`KpiCard`,
  `MobileListAccordion`, `Pagination`, etc.); `LicenseAnalytics.jsx` itself
  was migrated to the shared components in the same change, with no visual
  or behavioral difference. Money figures throughout both new pages go
  through `lib/money.js`'s `money()` (the Dashboard/Financials-style
  compact formatter — this is the same kind of summary view with several
  large numbers shown together, so the same scoping call applies), not the
  full-precision `.toFixed(2)` a single-record page like `InvoiceDetail.jsx`
  uses.
- **License auto-renewal on invoice payment**: `POST /invoices/:id/payments`
  auto-renews any of the invoice's client's *active or cancelled* licenses
  that the invoice was actually billing for, the moment the payment brings
  the invoice fully to `status: 'paid'` (not on a partial payment) — matches
  the "once they've paid, renew it" framing the manual Renew button already
  uses (see `routes/licenses.js` above), just triggered by a payment
  instead of a click. There's no `invoice_id` column on `licenses` linking
  the two — matching is by content: each `invoice_items.description` is
  trimmed/lowercased and checked against that client's active-or-cancelled
  licenses' `name` the same way, so a line item literally naming a license
  (e.g. "LMS Pro Annual License") renews that specific license, and an
  invoice for something unrelated never touches any license at all.
  Multiple matching line items still only renew a license once each; an
  invoice can auto-renew more than one license if it bills for more than
  one by name. A matched license that's currently `cancelled` is
  reactivated first (`status` flipped back to `active`, with its own
  `logActivity()` entry using the exact `action: 'reactivated'` string
  `PUT /:id`'s own structured-change-tracking uses — not a payment-specific
  variant — so `GET /licenses/analytics`'s `reactivated`-per-year count,
  which matches on that literal string, picks this up the same as a manual
  status-flip edit; the "via invoice payment" context goes in
  `entity_label` instead) before being renewed — deliberately different
  from the manual Renew button, which stays blocked on a `cancelled`
  license and requires an explicit Reactivate click first (see
  `routes/licenses.js`'s `POST /:id/renew` above): a real payment is a
  stronger, unambiguous signal than a renew click, so auto-reactivating on
  the client's behalf is the correct outcome here, not friction to route
  around. The actual renewal — extend `expiry_date` by one billing cycle,
  insert the `license_renewals` row, reset `last_reminder_sent_at` — is
  `lib/licenseRenewal.js`'s `renewLicense()`, the exact same function
  `routes/licenses.js`'s `POST /:id/renew` calls for a human clicking
  "Renew"; extracting it there was what let this feature reuse it here with
  no duplicated logic. Each auto-renewal still gets its own separate
  `logActivity()` entry (`action: 'auto-renewed via invoice payment for'`,
  attributed to whoever recorded the payment — this is a direct consequence
  of their action, not an unattended background job like
  `lib/scheduler.js`'s cron jobs, so it's *not* logged as `'Automated'` the
  way those are) and is included in the response's `autoRenewedLicenses`
  array (`{ id, name, expiry_date, reactivated }[]`). `InvoiceDetail.jsx`'s
  `handleRecordPayment()` splits that array on the `reactivated` flag and
  appends "Also renewed: X." and/or "Also reactivated and renewed: Y." to
  the existing "Payment recorded." notice, so the person recording the
  payment sees the side effect immediately rather than discovering it later
  on the Licenses page.
- **Email preview before sending**: every client-facing email this app
  sends from a button click (not the automated overdue-reminder digest —
  see `lib/scheduler.js` below, which stays fully automatic) goes through
  a review step first rather than sending immediately. Each send action
  has a matching `GET .../<action>-preview` route — `GET
  /quotes/:id/send-preview`, `GET /invoices/:id/send-preview`, `GET
  /invoices/:id/remind-preview`, `GET
  /invoices/:id/payments/:paymentId/receipt-preview`, `GET
  /licenses/:id/remind-preview` — all gated `manage`
  (same as the send routes themselves) that return `{ to, subject,
  message }`. `lib/emailTemplates.js` is the single source of that default
  text (`quoteSendEmail`/`invoiceSendEmail`/`invoiceRemindEmail`/
  `receiptSendEmail`/`licenseRemindEmail`, each taking the relevant row(s) +
  `settings` + `publicUrl` where applicable) — the preview route and the
  actual send route call the *same* function, so what's shown for editing
  can never drift from what would be sent if left unedited. The send routes
  (`POST /quotes/:id/send`, `POST /invoices/:id/send`, `POST
  /invoices/:id/remind`, `POST /invoices/:id/payments/:paymentId/send-
  receipt`, `POST /licenses/:id/remind`) now accept optional
  `subject`/`message` in the body —
  a blank/whitespace-only value (or the field omitted entirely) falls back
  to `emailTemplates.js`'s default rather than sending an empty subject/
  body, so a programmatic caller that skips the preview step still gets
  today's behavior. `message` is plain text (not HTML) — `lib/mailer.js`'s
  `textToHtml()` converts it: escapes HTML entities first (so a literal
  `<`/`&` a user types can't break the markup), auto-linkifies bare `http(s)://`
  URLs (the public quote/invoice link is plain text in the default
  message, see `emailTemplates.js`), and turns blank-line-separated blocks
  into `<p>` paragraphs with single newlines as `<br>`.
  `components/EmailPreviewModal.jsx` is the shared frontend piece: given a
  `loadPreview()` (calls the matching `*Preview` function in `lib/api.js`)
  and `onSend({ subject, message })`, it fetches the default text on open,
  renders To (read-only)/Subject/Message (both editable) fields, and only
  calls `onSend` — the real `POST .../send` — once "Send email" is
  clicked; "Cancel" or the backdrop/Escape close it without sending
  anything. `QuoteDetail.jsx` uses one instance for its single send
  action; `InvoiceDetail.jsx` uses one shared instance for all three of
  its send actions (send/remind/receipt), switched by an `emailModal`
  state object (`{ type: 'send' | 'remind' | 'receipt', paymentId? }`)
  that picks which preview/send API calls to wire up. An optional
  `showAttachmentNote` prop (default `true`) toggles the "The PDF is
  attached automatically" hint line — `Licenses.jsx` passes `false` for its
  own reminder instance, since a license reminder has no PDF to attach
  (see `routes/licenses.js` above).
- `routes/expenses.js` — CRUD for `expenses` (category/description/amount/
  expense_date/`payee`/notes) plus `GET /` (`?q=` search, `?page=` — see
  "Pagination convention" above) and `GET /export.csv`/`GET /export.xlsx`. `GET /` also always
  returns `totalAmount` (`SUM(amount)` over every row matching the current
  filters, computed independently of `LIMIT`/`OFFSET`) alongside
  `expenses` — `Expenses.jsx`'s "Total" row reads this rather than summing
  the current page's `expenses` array, so the total stays the true
  filtered grand total once pagination means that array is no longer
  the complete result set. `CATEGORIES` is a fixed list (`rent, utilities,
  supplies, salaries, shareholder payments, marketing, software, travel,
  currency exchange, other`) served to the frontend for the category
  `<select>`/filter chips — the same list (`EXPENSE_CATEGORIES`) is
  duplicated in `routes/import.js`
  for CSV import validation, so a category added here needs to be added
  there too. **Expense filters**: `GET /` also accepts `?category=` (exact
  match against `CATEGORIES`) and `?payee=` (exact match against `payee`),
  composing freely with each other and with `?q=` (which now also matches
  `payee`, not just `description`/`category`) — the same "narrow the same
  query" convention every other list route's filters already follow.
  `payee` is a free-text, optional field (blank default) capturing who an
  expense was paid to — a shareholder, an employee, a landlord, a vendor —
  not a separate `payees` table, since this app has no shareholder/employee
  entity of its own to reference; a business just types the same name
  consistently across expenses. `distinctPayees()` returns every non-blank
  `payee` value used so far (case-insensitive sort), served as `payees` on
  every `GET /` response alongside `categories` — independent of whatever
  filter is currently applied, same reasoning as `categories`, so the
  payee filter's own dropdown always offers everyone ever paid, not just
  who survived the current filter. `Expenses.jsx` renders `categories`
  through the existing `StatusFilterChips` (reused as-is — a fixed list of
  9 categories is exactly what that component already handles for status
  filters elsewhere) and `payees` through `SearchableSelect` (an
  open-ended, potentially-long list is what that component is for) with a
  prepended `{ value: '', label: 'All payees' }` option; the payee filter
  is only rendered once `payees.length > 0`, so a business that's never
  used the field doesn't see a pointless "All payees"-only dropdown.
  Payee is shown as its own column in the desktop table (falling back to
  an em dash when blank) and, unlike `notes`, as its own mobile-accordion
  detail row — but only when non-blank, so most expenses (which have no
  payee) don't show an empty row.
- **Currency exchange details**: three columns —
  `exchange_rate`/`payee_account_number`/`usd_destination` — exist only to
  serve the `currency exchange` category specifically (a business paying
  local currency to buy USD, then spending or investing that USD
  elsewhere); every other category leaves all three unset. `exchange_rate`
  is the one nullable numeric column in this table (every other optional
  number in the app defaults to 0 — see `products.tax_rate`) since 0 would
  be a nonsensical rate and risks a divide-by-zero; `NULL` unambiguously
  means "not a currency-exchange row." `amount` keeps meaning exactly what
  it always has — the local-currency figure actually spent — so for a
  currency-exchange row it's specifically what was paid to *buy* the USD,
  not the USD amount itself. The USD actually received is never stored:
  `withComputedUsd()` derives it fresh on every read as `amount /
  exchange_rate` (only when `category === 'currency exchange'` and the
  rate is a real positive number, else `null`) — same don't-store-what-
  you-can-compute approach `invoices.js`'s `withComputed()` takes for
  `is_overdue`, so it can never drift from the two numbers it's computed
  from. `POST /`/`PUT /:id` both route the three fields through
  `currencyExchangeFields()`, which discards them (writes `NULL`/`''`)
  for any other category regardless of what a stray value in the request
  body claims — switching the form's Category dropdown away from
  "currency exchange" and saving always clears them server-side, not just
  hides them client-side. `validate()` requires a positive `exchange_rate`
  specifically when `category === 'currency exchange'`, so `amount_usd`
  can never silently compute against a missing rate. `GET
  /export.csv`/`GET /export.xlsx` gained four columns (`Exchange rate`,
  `Amount (USD)`, `Payee account number`, `USD destination`) via
  `value: (r) => …` accessors rather than plain `key`s (the first two are
  computed, not real columns) — blank for every non-currency-exchange row,
  same convention `Payee`/`Notes` already follow for rows that never set
  them. `routes/import.js`'s `processExpenses()` mirrors the same rule for
  historical bulk import — `exchange_rate` required and validated the same
  way for a `currency exchange` row, the other two columns optional and
  ignored for every other category — and `Import.jsx`'s CSV template/column
  hint list grew the three columns to match.
  **Export/reimport round-tripping**: `loadExpenseExport()`'s own `Date`
  column is labeled `Expense date` specifically so it survives a reimport
  of the file it produced — see `lib/csv.js`'s own note on `parseCsv()`
  for the full story (a business exporting its expenses, clearing them,
  and reimporting the same file used to come back with zero expenses
  instead of the same ones, silently inflating `netProfit` since
  `totalExpenses` had dropped to zero while nothing else changed). Every
  other column here already round-trips correctly once `parseCsv()`
  normalizes whitespace — `Exchange rate`/`Payee account
  number`/`USD destination` needed no rename, only `Date` did (a
  single-word label that would otherwise normalize to `date`, not
  `expense_date`).
  `pages/business/Expenses.jsx`'s New/Edit form shows a distinct
  `bg-slate-50` sub-panel with all three fields plus a live, read-only
  "Amount received (USD)" preview (recomputed from the form's own draft
  `amount`/`exchange_rate` on every keystroke, mirroring the backend's own
  formula) — but only while `form.category === 'currency exchange'`, so
  every other category's form looks exactly as it did before this feature.
  The desktop table's Amount cell and the mobile `MobileListAccordion`
  summary both grow a small secondary `$X.XX @ rate` line under the
  local-currency amount for a currency-exchange row (nothing added for any
  other row); the mobile accordion's expanded body adds Exchange
  rate/Amount (USD)/Payee account number/USD destination detail rows,
  each only rendered when non-blank, same "only show the exception case"
  convention `payee`'s own detail row already follows. `amount_usd` is
  rounded to 2dp inside `withComputedUsd()` itself (`Math.round(x * 100) /
  100`) rather than left as a raw division — without it, a rate like
  `15.4667` produces floating-point noise (`599.9987068993386`) that would
  otherwise leak into the list, CSV/Excel export, and the analytics
  transaction table below exactly as returned, since none of those
  reformat the figure themselves beyond `.toFixed(2)` on display.
- **Expense analytics**: `GET /expenses/analytics` (`view`-gated, no
  route-ordering concern the way `licenses.js`'s/`invoices.js`'s own
  `GET /analytics` have — this router has no `GET /:id` at all, only
  `PUT`/`DELETE /:id`, so there's no literal-path-vs-param collision to
  register ahead of) is the year-over-year + currency-exchange-detail
  report backing `pages/business/ExpenseAnalytics.jsx` (route
  `/expenses/analytics`, linked from `Expenses.jsx`'s header next to
  "Export CSV", same placement as every other list page's own "Analytics"
  link). Same "fetch every row once, loop in JS" approach
  `routes/licenses.js`'s own `GET /analytics` takes rather than a
  `GROUP BY strftime(...)` per metric — fine at this app's scale. For
  every year from the earliest `expense_date` through the current year
  (gap years included at zero, same convention every other analytics
  endpoint follows), `byYear` reports `total` (every category, local
  currency) and `count`, plus `currencyExchangeSpent` (`currency
  exchange` rows only, local currency) and `currencyExchangeUsd` (that
  same subset's computed USD received). `byCategory` is an all-time
  `{ category: amount }` map across the fixed `CATEGORIES` list (0 for a
  category never used, so the frontend can filter those out itself rather
  than the backend guessing which are worth returning). `topPayees` is a
  top-5-by-total-amount `GROUP BY payee` query, the same shape
  `routes/licenses.js`'s own `topClients` already uses. The one thing
  this report does that no other analytics endpoint needs to:
  `currencyExchangeTransactions` returns the **full, un-paginated** list
  of every currency-exchange row (through `withComputedUsd()`, so each
  carries its own `amount_usd`) — this is what actually answers "show
  these details" for the feature, versus the rolled-up `byYear`/
  `byCategory`/`totals` numbers around it; no pagination since this
  category's row count is expected to stay small at this app's scale (an
  occasional MVR→USD conversion, not a high-volume transaction type),
  same "don't build it until needed" call `routes/licenses.js`'s own
  `GET /:id/renewals` already makes for a comparably small per-entity
  list. `totals.averageExchangeRate` is the *blended* rate — total local
  currency spent divided by total USD actually received, not an average
  of the individual per-transaction rates (which would weight a $10
  exchange the same as a $10,000 one) — `null` when nothing's been
  exchanged yet rather than a division-by-zero.
  `pages/business/ExpenseAnalytics.jsx` follows the same shape every
  other analytics page does (KPI strip via `KpiCard`, a year-by-year
  table, `hidden overflow-x-auto sm:block` desktop tables +
  `MobileListAccordion` `sm:hidden` mobile counterparts throughout) with
  two deliberate departures: the yearly `YearlyBarChart` pairs `total`
  against `currencyExchangeSpent` rather than two unrelated counts —
  both are local-currency money figures so they're directly comparable on
  one axis, unlike `currencyExchangeUsd`, which is a different currency
  entirely and would misrepresent scale if plotted alongside either (USD
  figures are reported separately instead, in the KPI strip and the
  year-by-year table's own column). And the category breakdown is a
  small local horizontal-bar block, not `components/BreakdownBars.jsx` —
  that shared component's fixed `w-6` value column and unformatted
  `{r.value}` rendering are tuned for the small integer counts every
  other caller (Licenses' billing-cycle split) passes it, and would
  either clip or misrender a money figure like `$24700.00`; since this is
  the only current caller that would need a wider, currency-formatted
  value column, it stays a page-local block rather than complicating the
  shared component for one caller. `USD`-denominated figures throughout
  this page are prefixed with a literal `$`, never `settings.currency_symbol`
  — a currency exchange result is always US dollars regardless of what
  the business's own configured currency is.
- `routes/capitalContributions.js` — CRUD for `capital_contributions`
  (`contributor_name`/`amount`/`contribution_date`/`notes`), mounted at
  `/api/capital-contributions`. This is the deliberate mirror of an
  `expenses` row tagged `shareholder payments`: that category is money a
  shareholder/partner *takes out* of the business; this table is money one
  *puts in* (repaying a prior draw, or a fresh injection of personal
  funds). It's a separate table rather than a negative-amount expense —
  `expenses.amount` is validated `> 0` everywhere (route validation, every
  report's SUM, the Expenses page's total row), and letting one category
  go negative would mean auditing every one of those call sites for a sign
  assumption, versus a same-shaped sibling table with its own always-
  positive `amount`. Follows `routes/expenses.js`'s exact conventions:
  `GET /` supports `?q=`/`?contributor=` (the `contributor_name` analog of
  `payee`/`payeeFilter`, via the same `distinctContributors()`-backed
  dropdown pattern) composed with `?page=` (see "Pagination convention"
  above), always returns `totalAmount` (independent of pagination, same
  reasoning as `expenses`'s own `totalAmount`), and has a matching
  `GET /export.csv`/`GET /export.xlsx`. Gated by the existing `expenses` permission rather
  than a new `MODULES` entry — same "reuse when the sensitivity level
  already matches" call `routes/reports.js` makes reusing `financials`
  (see below): this is the same kind of non-invoice cash-movement data
  `expenses` already covers, and its outbound mirror (`shareholder
  payments`) already lives there. `pages/business/CapitalContributions.jsx`
  (route `/capital-contributions`, nav link "Capital" right after
  "Expenses" in `Navbar.jsx`'s `BUSINESS_LINKS`, also gated on `expenses`)
  is the same list+modal-form+FAB shape as `Expenses.jsx`, including the
  confirm-then-undo-toast delete pattern (`lib/useConfirm.js` +
  `lib/useUndoableDelete.js` together, see `components/ConfirmDialog.jsx`
  above) and the standard desktop-table + `MobileListAccordion` mobile
  split. Also included in `routes/dataReset.js`'s Danger Zone as its own
  standalone category (`capital_contributions` — no cascading needed, no
  other table references it) and `Import.jsx`'s matching checkbox list;
  there's no CSV *import* type for it yet (only export), since the
  original ask was recording new contributions going forward, not
  backfilling historical ones — add one the same way `expenses` has one if
  that's ever needed. **Financial impact**: `routes/financials.js`'s
  `GET /summary` sums this table as `totalCapitalContributions` and adds it
  into `bankBalance`, but deliberately *not* into `netProfit` — a capital
  contribution is an owner/partner injecting personal money, not the
  business earning it, so folding it into net profit would overstate how
  profitable the business actually was. It still belongs in the bank
  balance, since that cash really did land in the account; see
  `routes/financials.js`'s own comment for the reasoning. `Financials.jsx`
  renders it as its own `KpiCard` (icon: `UsersIcon`, tone `neutral`,
  positioned right before the "Bank balance" card) so it reads as a
  distinct line rather than being silently absorbed into another figure —
  `bankBalance`'s own `sub` text was updated to "Starting balance + net
  profit + contributions" to match. `routes/reports.js`'s
  `GET /bank-balance/pdf` (and `lib/reportPdf.js`'s `renderBankBalancePdf`)
  got the same treatment: opening/closing balance both add contributions
  recorded in/before the range, and the PDF's summary box only renders a
  "Capital contributions" row when the period's total is non-zero, so a
  business that's never used this feature doesn't see a pointless `$0.00`
  line on every statement.
- `routes/ownerDraws.js` — CRUD for `owner_draws` (`type`/`taken_by_name`/
  `amount`/`draw_date`/`notes`), mounted at `/api/owner-draws`. This is the
  mirror image of `capital_contributions` above — money an owner/partner
  takes *out* of the business, rather than putting in — but it's a
  deliberately separate table, not a `capital_contributions` row with a
  negative amount or an opposite sign: `type` is a real column (`draw` |
  `return`, both stored, `TYPES` array validated the same way
  `discount_type`/license `billing_cycle` are elsewhere) so a single table
  can hold both halves of the relationship — money taken, and any of it
  later paid back — under one running balance. `type: 'return'` is *not*
  the same real-world event as a fresh `capital_contributions` row, even
  though the cash movement looks identical (money flowing into the
  business from an owner): a contribution is new personal money being
  injected with no prior draw behind it, a return is specifically money
  that was taken out being paid back — keeping them in separate tables
  would lose that distinction and make "how much is still outstanding"
  impossible to compute without cross-referencing two unrelated tables by
  date/amount/name, which is exactly the kind of fragile matching this app
  avoids elsewhere (see `POST /invoices/:id/payments`'s license
  auto-renewal matching by *content*, not id, for the closest comparison
  of "matching without a real link" and why it's still preferred to
  nothing — here there's no need for content-matching at all, since `type`
  already answers the question directly). Also not a plain `expenses` row
  tagged `shareholder payments` — a plain expense has no notion of a
  running balance or a later repayment recorded against it, and treating a
  draw as a normal expense would also wrongly pull it into `netProfit`
  (see "Financial impact" below for why that would be wrong).
  Gated on the existing `expenses` permission rather than a new `MODULES`
  entry — same "reuse when the sensitivity level already matches" call
  `capitalContributions.js`/`reports.js` already make: this is the same
  kind of non-invoice cash-movement data `expenses` already covers, and
  its own outbound-money category (`shareholder payments`) already lives
  there. Follows `capitalContributions.js`'s exact conventions: `GET /`
  supports `?q=` (matching `taken_by_name`/`notes`), `?type=` (exact match
  against `TYPES`), and `?takenBy=` (the `taken_by_name` analog of
  `contributor`, via the same `distinctNames()`-backed dropdown pattern
  `distinctContributors()`/`distinctPayees()` already establish) — all
  compose freely with `?page=` (see "Pagination convention" above; `GET /`
  with no `page` still returns the full unfiltered array, same convention
  every other list route follows). `GET /summary` (independent of
  pagination/search/filters, same convention `licenses.js`'s own
  `GET /summary` and `capitalContributions.js`'s own `totalAmount`
  establish) returns `{ totalDraws, totalReturns, outstandingBalance }` —
  the running balance across every draw and return on file, backing the
  KPI strip at the top of `OwnerDraws.jsx`. Has the matching
  `GET /export.csv`/`GET /export.xlsx` pair. Every mutation
  (create/update/delete) calls `logActivity()`, with `action` text that
  distinguishes a draw from a return (`'recorded a draw for'` vs.
  `'recorded a return from'`, and the update/delete equivalents) rather
  than one generic verb, so the activity feed reads naturally either way.
  `pages/business/OwnerDraws.jsx` (route `/owner-draws`, nav link "Owner
  draws" right after "Capital" in `Navbar.jsx`'s `BUSINESS_LINKS`, also
  gated on `expenses`) is the same list+modal-form+FAB shape as
  `CapitalContributions.jsx`, with two additions on top: a KPI strip
  (`KpiCard`s for Total drawn/Total returned/Outstanding balance, from
  `GET /summary` — refreshed on load and, since the actual DELETE behind
  `useUndoableDelete.js`'s undo toast doesn't fire until its 5-second undo
  window closes, on a matching delayed refresh after a delete rather than
  immediately) and a `type` selector in the create/edit form (a two-button
  Draw/Return toggle, not a `<select>`, since there are only ever two
  values and a toggle makes the choice more visually obvious than a
  dropdown) plus a matching `StatusFilterChips` row above the list
  (All/Draws/Returns, wired to `?type=`) — otherwise the same
  confirm-then-undo-toast delete pattern, `SearchInput` + `SearchableSelect`
  name filter, and standard desktop-table + `MobileListAccordion` mobile
  split (each row's `type` also renders as a small colored pill — amber
  for draw, emerald for return — matching the same semantic-color
  convention `StatusBadge` uses elsewhere, and the mobile accordion gets a
  matching `accent` stripe). Also included in `routes/dataReset.js`'s
  Danger Zone as its own standalone category (`owner_draws` — no
  cascading needed, no other table references it) — there's no CSV
  *import* type for it yet, same reasoning `capital_contributions` doesn't
  have one: the ask was recording new draws/returns going forward, not
  backfilling history. **Financial impact**: `routes/financials.js`'s
  `GET /summary` sums this table as `totalOwnerDraws`/`totalOwnerReturns`
  and factors the *net* of the two into `bankBalance` (subtracting draws,
  adding returns back) — deliberately *not* into `netProfit`, mirroring
  `capital_contributions`'s own exclusion in the opposite direction: an
  owner draw is personal money leaving the business, not a business
  expense, so folding it into net profit would understate how profitable
  the business actually was (the mirror image of why a contribution isn't
  added to net profit either). It still belongs in `bankBalance`, since
  the cash really did leave the account; see `routes/financials.js`'s own
  comment for the reasoning. `Financials.jsx` renders it as its own
  `KpiCard` ("Owner draws (net)", icon: `TrendDownIcon`, tone `warning`
  when outstanding, positioned right before the "Bank balance" card,
  matching where the Capital contributions card sits relative to it) —
  `bankBalance`'s own `sub` text was updated to "Starting balance + net
  profit + contributions − owner draws" to match. `routes/reports.js`'s
  `GET /bank-balance/pdf` (and `lib/reportPdf.js`'s `renderBankBalancePdf`)
  got the same treatment as `capital_contributions` did: opening/closing
  balance both subtract draws and add back returns recorded in/before the
  range, and the PDF's summary box only renders an "Owner draws"/"Owner
  returns" row when that period's respective total is non-zero — same
  "don't show a pointless `$0.00` line" convention the existing "Capital
  contributions" row already follows.
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
- `routes/licenses.js` — CRUD for `licenses` (a client's subscription/
  license, not a document like an invoice — no PDF, no public token, no
  numbering scheme). `status` only ever *stores* `active` | `cancelled`;
  everything else a viewer cares about (`expired`, `expiring_soon`) is
  *derived* at read time from `expiry_date` vs. today, the same
  don't-store-what-you-can-compute approach `invoices.js`'s `withComputed()`
  takes for `is_overdue`/`is_partially_paid` — every response carries both
  the raw `status` and a computed `display_status` (`active` | `expiring_soon`
  | `expired` | `cancelled`), and only `display_status` is what
  `StatusBadge`/the mobile accent stripe render. `EXPIRY_WARNING_DAYS = 30`
  is the one threshold controlling both when a still-active license starts
  reading as `expiring_soon` and which licenses `lib/scheduler.js`'s
  automated alert job (below) treats as candidates — duplicated as a literal
  over there rather than imported (same acceptable-duplication call as
  `EXPENSE_CATEGORIES` between `routes/expenses.js`/`routes/import.js`; keep
  both in sync). `GET /` supports `?q=` (license name or client name) and
  `?status=` (one of the four `display_status` values — `statusWhere()`
  translates each into the actual SQL date comparison against `expiry_date`,
  since only `cancelled` is a direct column match) composed with `?page=`
  (see "Pagination convention" above). List order is `last_renewed_at DESC,
  id DESC` — the most recently renewed license first, so the list surfaces
  what's just been paid/renewed rather than what happens to expire soonest;
  a license that's never been renewed has `last_renewed_at = NULL`, which
  SQLite sorts last in `DESC` order by default, so those naturally fall to
  the bottom with no extra `CASE` needed. (`GET /export.csv`/`GET
  /export.xlsx` below keep their own separate `expiry_date ASC` order — a
  downloaded report reads better chronologically by expiry than by renewal
  recency.) `GET /summary` is independent of
  pagination/search — a `{ active, expiring_soon, expired, cancelled, total }`
  count across every license, backing the KPI strip at the top of
  `Licenses.jsx` — and `GET /export.csv`/`GET /export.xlsx`, both following
  the usual conventions. **Export/reimport round-tripping**:
  `loadLicenseExport()`'s columns are named so a downloaded export
  reimports correctly through `routes/import.js`'s license importer (see
  `lib/csv.js`'s own note on `parseCsv()` for why this needed fixing at
  all) — `Client email`/`Client name` (both now included; previously a
  single `Client` column matched neither `client_email` nor
  `client_name`), `Name` (previously `License`, which never matched
  `row.name`), and a `Notes` column that didn't exist in this export at
  all before. The `Status` column is the one place a straight rename
  wasn't enough: it exports `display_status` (`active` | `expiring_soon`
  | `expired` | `cancelled` — the more informative value a human actually
  wants to see in a downloaded report, matching what `Licenses.jsx`'s own
  table shows) rather than the two raw stored values (`active` |
  `cancelled`), so `validateLicenseRow()` normalizes `expiring_soon` and
  `expired` back to `active` on the way in — both are just `withComputed()`
  deriving a richer view of `status: 'active'` plus `expiry_date` at read
  time, never a separately stored state, so reimporting either value as
  `active` reflects reality exactly, not a lossy approximation. **The core
  action**: `POST /:id/renew` is "the client paid,
  extend it" — advances `expiry_date` by exactly one `billing_cycle`
  (`monthly` or `yearly`, month-end-clamped the same way `lib/scheduler.js`'s
  own `advanceDate()` handles Jan 31 → Feb) from the *current* `expiry_date`,
  always landing on the same day-of-month as the original expiry — including
  for a badly lapsed license (expired well over a cycle ago), where the new
  expiry can itself still land in the past; that's preferred over quietly
  renewing from today's date instead, which would produce a new expiry whose
  day-of-month has nothing to do with the license's real billing cycle. A
  license renewed while still lapsed just reads as `expired` again
  (`display_status`, see below) until renewed once more. Blocked (409)
  only when `status` is already `cancelled` — a cancelled license needs an
  explicit edit back to `active` first, `renew` is for "still active, just
  needs paying," not for un-cancelling. Renewing also clears
  `last_reminder_sent_at` back to `NULL`, so a license that was reminded
  right before renewal doesn't inherit a stale suppression window blocking
  its *next* expiry cycle's alerts — and, same reasoning,
  `last_renewal_confirmation_sent_at` too, so the "Send renewal
  confirmation" action (see "Renewal confirmation email" below) becomes
  available again for the license's new renewal rather than staying
  suppressed by the previous one's. The actual expiry-advancing/
  `license_renewals`-writing logic lives in `lib/licenseRenewal.js`'s
  `renewLicense()`, not inline in this route — it's also called from
  `routes/invoices.js`'s `POST /:id/payments` for auto-renewal on a paid
  invoice (see "License auto-renewal on invoice payment" below), so both
  callers extend/record a renewal identically; this route's own job is just
  the `cancelled` guard and the `logActivity()` call, since a human-clicked
  renewal and an auto-renewal are logged under different `action` text.
  **Email reminder**: `GET
  /:id/remind-preview` + `POST /:id/remind` follow the exact "preview then
  send" contract documented under "Email preview before sending" below —
  `lib/emailTemplates.js`'s `licenseRemindEmail()` backs both, logged to
  `email_log` as type `license_remind`. Unlike invoice/quote sends, there's
  no PDF attachment (a license isn't a document), so the send route is
  plain `sendMail({ to, subject, html })` with no buffer/attachment step.
  Blocked (409) the same as renew when `status` is `cancelled`. Every
  mutation (create/update/delete/renew/remind) calls `logActivity()`.
  **Renewal confirmation email**: `GET /:id/renewal-confirm-preview` +
  `POST /:id/renewal-confirm` are a second, distinct manual send — not a
  reminder that a client should renew, but a confirmation *after* the fact
  that they have, styled as a real designed HTML email rather than the
  plain-text-through-`textToHtml()` shape every other send in this app
  uses. `lib/licenseRenewalEmail.js`'s `renderLicenseRenewalEmail()`
  builds it: a gradient header (this app's own `lagoon` palette, see
  `frontend/src/index.css`) with the business name and "License Renewed",
  a generic "Dear Sir/Madam," salutation (deliberately not the client's own
  name — this table-based HTML email's own details section, immediately
  below, already names the client explicitly, and a generic salutation
  reads as more appropriate business correspondence than an informal
  first-name-style greeting here), a details table (client, license, billing cycle, amount, the license's
  own `url` when set — see that column's own note above, this is the
  "future activation-email template" it was captured for — and the new
  expiry date), and an "Access license" button linking to `url` when
  present. Table-based layout with inline styles throughout, and the
  header's gradient is layered over a solid `background-color` fallback,
  for the widest email-client compatibility. Deliberately **not** routed
  through `lib/emailTemplates.js`'s admin-editable template system — a
  renewal confirmation is a fixed structured summary of the license's own
  data, not prose an admin would want to freely rewrite, so like the
  automated overdue-reminder digest it stays outside that system by
  design (see that file's own top-of-file note); accordingly, the `POST`
  route accepts no `subject`/`message` override the way every other
  manual send in this app does. Blocked (409) the same as renew/remind
  when `status` is `cancelled`; no PDF attachment, same reasoning as
  `remind`. Not tied to a renewal having *just* happened when it's sent —
  it always builds from the license's current row, not a snapshot from
  whenever it was last renewed, so staff can renew and then send this a
  moment later once they've double-checked details. Logged to `email_log`
  as type `license_renewal_confirm` (`routes/emailCenter.js`'s own
  `TYPE_LABELS` gained a matching entry, alongside a note on why this type
  has no editable template either) and to `activity_log` as `'sent
  renewal confirmation for'`. On the frontend, `Licenses.jsx`'s
  `rowActions()` gains a `SendIcon`/`emerald` button opening
  `components/HtmlEmailPreviewModal.jsx` — the read-only counterpart to
  `EmailPreviewModal.jsx`: since there's nothing editable here, it shows
  To/Subject read-only and renders the actual HTML in a sandboxed
  (`sandbox=""`) `<iframe srcDoc={html}>` so staff see exactly what the
  client will receive before clicking "Send email".
  **One confirmation per renewal, not a repeatable action**: a successful
  send also stamps `licenses.last_renewal_confirmation_sent_at`
  (`db/index.js`, `ALTER TABLE`-guarded — `licenses` already had real
  rows, same lesson `licenses.url` learned the hard way), and the button's
  own gate on `Licenses.jsx` grew from just `status !== 'cancelled'` to
  also require `!last_renewal_confirmation_sent_at` — so once a
  confirmation actually goes out, the button disappears from that row
  (both the desktop table and the mobile accordion) rather than staying
  around to be clicked again for the same renewal. `lib/licenseRenewal.js`'s
  `renewLicense()` — the one function both a human's `POST /:id/renew`
  click and an invoice's auto-renewal-on-payment call to actually extend a
  license — clears this column back to `NULL` in the same `UPDATE` that
  already resets `last_reminder_sent_at`, so *any* real renewal (manual or
  automatic) is what brings the button back, not a timer: the column
  means "already confirmed for the license's current renewal," which is
  only ever true again once there's been a new one. The `HtmlEmailPreviewModal`
  instance's own `onSend` calls `load()` after a successful send (`POST
  /:id/renewal-confirm` now returns `{ license: withComputed(...) }`,
  matching `/:id/remind`'s own response shape, rather than a bare message)
  so the row updates and the button vanishes the instant the modal closes,
  with no manual refresh needed. The row itself also gains a small
  confirming note the instant `last_renewal_confirmation_sent_at` is set —
  "Renewal confirmation sent {relative time}" in a small emerald line right
  under the license name (`Licenses.jsx`'s desktop `<td>` and the mobile
  accordion's summary both render it, same shared-markup convention every
  other per-row detail in this app follows so the two breakpoints can't
  drift), via `lib/date.js`'s `timeAgo()` — the same relative-time helper
  `InvoiceDetail.jsx`'s own "Viewed by client {time}" line already uses.
  This exists because the button disappearing on its own reads as "the
  action isn't available," not "I already did this" — staff scanning the
  list needs a positive, remembered signal that a confirmation really went
  out for that license, not just the absence of a button that used to be
  there. Only rendered when the column is actually set, same "only show
  the exception case" convention every other optional per-row detail in
  this app already follows (the `payee`/`address`/`url` rows above are the
  closest precedent) — the common case (no confirmation sent yet, or
  none needed) shows nothing extra.
  **Renewal history**: every `POST /:id/renew` above also inserts one row
  into `license_renewals` (`license_id`, `previous_expiry_date`,
  `new_expiry_date`, `renewed_by_name`, `renewed_at`), in the same
  `db.transaction()` as the `licenses` `UPDATE` so the two never drift.
  This is deliberately a separate table from `activity_log` (which already
  gets its own one-line "renewed" entry per renewal, see `lib/activity.js`
  below) — `activity_log`'s `entity_label` is a free-text summary string
  meant for a global chronological feed, not something built to be queried
  per-license or to expose the exact previous/new expiry pair as structured
  data. `GET /:id/renewals` (`view`-gated, same as every other read on this
  router) returns that license's own renewals newest-first with no
  pagination — a single license's renewal count is inherently small (at
  most one per billing cycle since the license existed). `url`
  is an optional free-text field (no format validation beyond trimming,
  stored/exported/imported alongside `notes`) for the client's activation/
  portal link; nothing currently reads it back out for an email — it's
  captured now so a future activation-email template can interpolate it,
  not wired into `lib/emailTemplates.js`'s `licenseRemindEmail()` yet.
  Unlike `notes`, `url` **is** shown in the list itself: `Licenses.jsx`'s
  desktop table gets its own "URL" column (a compact `LinkIcon` + "Open"
  link, `target="_blank"`, falling back to an em dash when blank — same
  "own column, em-dash fallback" convention `Expenses.jsx`'s own `payee`
  column already established) and the mobile `MobileListAccordion` gets a
  matching detail row, but only when `url` is actually set (same "only
  show the exception case" convention `payee`'s own mobile row follows
  too — most licenses have no URL, so most cards don't gain an extra row
  for it). **Structured change
  tracking**: `PUT /:id` compares the incoming `billing_cycle`/`status`
  against the existing row and, on top of the generic `'updated'`
  `logActivity()` call every edit already gets, writes a second, distinct
  entry when either actually changed — `action: 'changed billing cycle'` (an
  edit whose only distinguishing feature is that specific field flipping,
  e.g. monthly → yearly) or `action: 'cancelled'`/`'reactivated'` (status
  `active` ↔ `cancelled`) rather than one generic `'changed status'`, so the
  two directions read naturally in the activity feed and can be counted
  separately. This exists so `GET /analytics` (below) can count these
  transitions precisely by exact `action` string — the free-text
  `entity_label` on the generic `'updated'` entry was never structured
  enough to query reliably. Both are attributed to whoever made the edit,
  same as `'updated'` itself; the `renewed`/`created`/`deleted` actions
  elsewhere in this router are unaffected.
- **License analytics**: `GET /licenses/analytics` (`view`-gated,
  registered before `GET /:id` for the same "don't let `:id` swallow a
  literal path" reason `GET /summary`/`GET /export.csv` already are) is a
  year-over-year view, distinct from `GET /summary`'s current-snapshot
  counts. For every year from the earliest license's `start_date` through
  the current year (gap years included at zero, not skipped, so the
  frontend's chart/table never silently jumps), it reports `newLicenses`
  (by `start_date` year), `renewals` (by `license_renewals.renewed_at`
  year), `cancelled`/`reactivated`/`billingCycleChanges` (by the
  `activity_log` entries `PUT /:id` now writes for those transitions, see
  above), and `revenueEstimate`. That estimate is deliberately not exact
  history — `license_renewals` only ever recorded the previous/new expiry
  dates, never what was actually charged at the time (no per-renewal amount
  column, no link back to a specific invoice/payment) — so every license
  counted in a given year (new or renewed) is valued at its **current**
  `amount` as a stand-in for "what it'd be worth at today's pricing," the
  same kind of clearly-labeled proxy `routes/financials.js`'s own
  `bankBalance` already is for a different figure, not a claim about what
  was actually billed that year. Also returns `byBillingCycle` (current
  monthly/yearly counts), `topClients` (top 5 by license count, then by
  current total `amount`, via a plain `GROUP BY`), and a `totals` block
  (all-time sums of the same five per-year metrics). Because
  `cancelled`/`reactivated`/`billingCycleChanges` only exist from the
  `activity_log` entries introduced alongside this feature, every year
  before it shipped reads `0` for those three columns even if such changes
  really happened — `pages/business/LicenseAnalytics.jsx` (route
  `/licenses/analytics`, linked from `Licenses.jsx`'s header next to
  "Export CSV") says so directly above the yearly table rather than letting
  a `0` read as "nothing happened." That page follows the same
  permission-gate-at-the-top-of-the-component pattern as `Reports.jsx`
  (`can('licenses', 'view')`, not a dedicated module), a KPI strip via the
  shared `KpiCard`, a grouped year-by-year bar chart (`components/
  YearlyBarChart.jsx`, same shared-axis/hover-tooltip shape as
  `components/RevenueTrendChart.jsx` but counts instead of money — see
  "Invoice/quote analytics" above for why this and the billing-cycle
  breakdown below were later promoted out of this page into shared
  components rather than staying local, once Invoice/Quote Analytics
  needed the identical shape), a billing-cycle breakdown via
  `components/BreakdownBars.jsx` (modeled on `components/
  StatusBreakdownChart.jsx`'s horizontal-bar shape), and the standard
  `hidden overflow-x-auto sm:block` desktop table + `MobileListAccordion`
  `sm:hidden` mobile counterpart (see "Mobile design system" below) for
  both the yearly table and the top-clients table.
- `routes/public.js` — mounted at `/api/public`, the one route file **not**
  behind `requireAuth`. Looks quotes/invoices up by their `public_token`
  (a random 16-byte hex column generated on every quote/invoice create,
  duplicate, convert-to-invoice, and recurring-invoice generation) rather
  than by id, so a client with the link can view/download a document
  without an account. `GET /quotes/:token` and `GET /invoices/:token`
  return the document + client + business settings — the settings row is
  passed through `publicSettings()` first, which strips
  `starting_balance` and `session_timeout_minutes` before the response is
  sent: those are internal-only (a financial figure and a security policy
  value, respectively), and unlike the rest of `business_settings` there's
  no client-facing reason for either to be readable by anyone holding a
  public link. Every other settings field is intentionally left as-is
  (business name/address/tax ID/bank details/logo etc.) since it's the
  same data the token's own PDF route (below) already renders; the PDF
  routes fetch `settings` straight from the table with no filtering, since
  `lib/pdf.js` never reads either excluded field anyway. `GET .../pdf`
  streams the same PDF the authenticated routes produce; `POST /quotes/:token/respond`
  lets the client accept/decline (only while `status` is `draft`/`sent`;
  stores `quotes.client_response`/`client_responded_at` and updates
  `status`). The emails sent from `quotes.js`/`invoices.js` `/send` routes
  link here (`${CLIENT_ORIGIN}/q/:token`, `${CLIENT_ORIGIN}/i/:token`).
  **Client view tracking**: `GET /quotes/:token` and `GET /invoices/:token`
  both call a small `markViewed(table, id)` helper that stamps
  `client_viewed_at` (`quotes`/`invoices`, `ALTER TABLE`-added — see
  `db/index.js` below) the *first* time the document is opened —
  `UPDATE ... SET client_viewed_at = datetime('now') WHERE id = ? AND
  client_viewed_at IS NULL`, so it's a no-op (and safe to call
  unconditionally on every request) once already set. Deliberately the
  first view only, not the most recent one: the question this answers is
  "has the client ever actually seen this," and overwriting on every
  repeat view would erase that earliest, more useful timestamp for no
  benefit — a client re-opening a link they've already read isn't a
  new signal worth capturing. `routes/clientPortal.js`'s own `GET
  /quotes/:id`/`GET /invoices/:id` call an identically-shaped `markViewed()`
  (its own copy, not imported — same duplication precedent as that file's
  `withComputedInvoice()`/`publicSettings()`) so a client viewing through
  the portal counts exactly the same as viewing via the public link; both
  write to the same column, so staff get one unified "did they see it"
  signal regardless of which route the client actually used. `table` is
  always a literal (`'quotes'` or `'invoices'`) supplied by the call site,
  never request input, so the string-interpolated table name carries no
  injection risk (same reasoning `routes/dataReset.js`'s own
  table-name-from-a-fixed-map already relies on). No route change was
  needed on the staff-side `GET /api/quotes/:id`/`GET /api/invoices/:id` —
  both already `SELECT *` the row, so `client_viewed_at` flows through
  automatically the moment the column exists.
  `QuoteDetail.jsx`/`InvoiceDetail.jsx` render a small "Viewed by client
  {relative time}" line (via `lib/date.js`'s new `timeAgo()` helper) only
  once that column is actually set — the common case (not yet viewed)
  shows nothing, same "only show the exception case" convention
  `PortalBadge`/the expense `payee` detail row already follow — positioned
  right under the header's action-button row (for `InvoiceDetail.jsx`,
  directly below the existing `last_reminder_sent_at` line, so both
  "did we nag them" and "did they actually look" read together in one
  place). **Copy public link**: both detail pages also gained a "Copy
  public link" header button (`LinkIcon`, next to "Download PDF") that
  writes `${window.location.origin}/q/:token` (or `/i/:token`) to the
  clipboard via `navigator.clipboard.writeText()` and shows the same
  inline `notice`/`error` line every other action on these pages already
  uses — deliberately built from the *browser's own* origin rather than
  trusting the backend's `CLIENT_ORIGIN` env var to match what's actually
  being served, so the copied link is always correct for whichever
  environment (local dev, staging, production) the person copying it is
  really looking at. This exists so a document's link is reachable without
  depending on the "Email to client" send actually working (SMTP being
  configured, the email not landing in spam) — a business that primarily
  reaches clients over WhatsApp or another channel can grab the link and
  share it however they actually communicate, and staff get an easy way to
  eyeball the URL itself before relying on it.
  **The emailed link now matches the copied link exactly, for the same
  reason "Copy public link" avoids `CLIENT_ORIGIN` in the first place**: the
  quote/invoice send routes (`GET /:id/send-preview`, `POST /:id/send`) used
  to build their own `public_url` straight from `process.env.CLIENT_ORIGIN`
  — so if that env var had ever drifted from the real, currently-served
  frontend domain (a custom domain added after it was set, a
  staging/preview deploy, a typo), the *emailed* link would point somewhere
  different from the *copied* one, and specifically could land on an older
  build of the app that still showed a "Log in" button on `/q/:token`/
  `/i/:token` even though the current build (and the copied link) correctly
  hides it (see `Navbar.jsx`'s own `isPublicDocLink` note above). Fixed by
  having the frontend pass its own `window.location.origin` along with
  every send-preview/send call — `?client_origin=` on the `GET
  .../send-preview` query string, `client_origin` in the `POST .../send`
  body (both added in `lib/api.js`'s `quotes.sendPreview`/`send` and
  `invoices.sendPreview`/`send`, so every call site — `QuoteDetail.jsx`,
  `InvoiceDetail.jsx`, and the `Quotes.jsx`/`Invoices.jsx` row-action
  versions — picked this up with no changes of their own). Each route's own
  `resolveClientOrigin(candidate)` (duplicated between `routes/quotes.js`
  and `routes/invoices.js` — same small-duplication precedent as
  `EXPIRY_WARNING_DAYS` between `routes/licenses.js`/`lib/scheduler.js`,
  not worth a shared module for one four-line function) uses that value
  when it's present and actually looks like an `http(s)://` URL, falling
  back to `CLIENT_ORIGIN`/`localhost:5173` only for a non-browser caller
  that skips it — so the email's `{{public_url}}` is now derived from the
  same real, browser-verified origin as "Copy public link," not a
  server-side env var that can silently go stale. `invoice_remind`/
  `receipt_send`/`license_remind` don't carry a `public_url` placeholder at
  all (see `PLACEHOLDERS` in `lib/emailTemplates.js`), so those send routes
  are untouched by this.
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
  beyond `invoices.amount_paid`. **Bank balance**: `bankBalance` is
  `business_settings.starting_balance` (admin-editable on the Settings page,
  see `routes/settings.js` above) plus `netProfit` plus
  `totalCapitalContributions` (`SUM(capital_contributions.amount)`, see
  `routes/capitalContributions.js` above) minus the *net* of
  `totalOwnerDraws`/`totalOwnerReturns` (`SUM(owner_draws.amount)` per
  `type`, see `routes/ownerDraws.js` above — draws subtract, returns add
  back) — the one number this app can vouch for without a real bank feed:
  whatever balance you had the day you set `starting_balance`, plus every
  payment, capital contribution, and owner return collected, minus every
  expense and owner draw recorded since. `totalCapitalContributions`/net
  owner draws are both deliberately excluded from `netProfit` itself (an
  owner/partner injecting personal money isn't the business earning it,
  and a draw isn't a business expense) but still counted in `bankBalance`
  (that cash really did move through the account either way) — see
  `routes/capitalContributions.js`'s/`routes/ownerDraws.js`'s own
  "Financial impact" notes for why. It's a running proxy, not a live
  balance — anything moving money outside the `payments`/`expenses`/
  `capital_contributions`/`owner_draws` tables (a loan, a tax remittance)
  isn't reflected, so it can drift from the real account over time if
  those go unrecorded. `Dashboard.jsx`/`Financials.jsx` both render
  `bankBalance` as a `KpiCard`
  (icon: `BankIcon`) alongside the other summary figures, tone flipping to
  `negative` the same way `netProfit`'s own card does when the number goes
  below zero (a startup deficit or heavy early spending). On `Dashboard.jsx`
  it's still rendered full-width (`col-span-2 sm:col-span-3 lg:col-span-6`,
  via `KpiCard`'s optional `className` prop) as a standalone headline below
  the other shortcut-tile-adjacent KPIs. `Financials.jsx` instead renders
  all 9 of its KPI cards — including `bankBalance` and `ownerDraws`'s own
  net-draws card — in one uniform `grid-cols-2` grid, same size, no card
  singled out for extra width; this page is the deeper financial-detail
  view (vs. Dashboard's quick-glance summary), so once `capitalContributions`
  (and later `ownerDraws`) brought the count up, an even grid reads more
  like a real balance-sheet-style overview than one card visually shouting
  over the rest.
  **Period filter on `Financials.jsx`**: `GET /summary` accepts optional
  `?from=&to=` (`YYYY-MM-DD`) — omitted, it's the exact unfiltered/all-time
  query this endpoint has always run (what `Dashboard.jsx`'s own call still
  gets, unconditionally; malformed or partial input falls back to
  unfiltered too, rather than 400ing, since this isn't a hand-typed form).
  `Financials.jsx` renders a `StatusFilterChips` row (This year/Last year/
  This month/Last month/All time, defaulting to **This year**) right under
  the page intro, computing each option's exact `{from, to}` fresh on every
  call (not memoized) the same way `Reports.jsx`'s own quick-pick presets
  do, so "This year"/"This month" stay relative to today rather than to
  whenever the page first loaded; switching tabs doesn't reset `summary` to
  `null` first, so the numbers swap directly instead of flashing back to
  the page's "Loading…" state. When a range is present, `totalInvoiced`/
  `totalPaid`/`totalOutstanding`/`overdueCount`/`overdueAmount`/
  `invoiceCounts` are all scoped to invoices by `issue_date` (accrual,
  same convention `routes/reports.js`'s own sales/tax reports use) —
  `invoiceCounts` is its own query rather than derived from the same
  `invoices` array the totals use, since that array is `status != 'void'`
  (voided invoices stay excluded from every financial total, as always)
  while the status *breakdown* chart still needs to count void as one of
  its own slices (see `StatusBreakdownChart`'s own `void` entry) — deriving
  it from the totals array would have silently dropped every voided
  invoice from the chart, including in the unfiltered case. `totalExpenses`/
  `totalCapitalContributions`/`totalOwnerDraws`/`totalOwnerReturns`/
  `recentPayments` are each scoped by their own natural date column
  (`expense_date`/`contribution_date`/`draw_date`/`payments.paid_at`)
  the same way `routes/reports.js`'s own per-report queries are.
  **`netProfit` is cash-basis** (`cashRevenue - totalExpenses`, where
  `cashRevenue` is `SUM(payments.amount)` by `paid_at` in range) —
  deliberately **not** `totalPaid - totalExpenses` the way it reads for the
  unfiltered/all-time case, even though the two are the same grand total
  when unfiltered (every dollar in `amount_paid` traces back to exactly
  one `payments` row, and neither sum is date-restricted then). They
  diverge the moment a real period filter is applied: an invoice issued
  last year but paid this year contributes to this year's cash revenue
  but not to this year's accrual `totalPaid` (its `issue_date` falls
  outside the range) — an earlier version of this filter used `totalPaid`
  for `netProfit` too, which silently missed that payment while
  `routes/reports.js`'s own `GET /profit-loss/pdf` (cash-basis since it
  was first built) counted it, so the same "Net profit" figure disagreed
  between the Financials page and its own PDF report for the identical
  date range — the bug that prompted this fix. `cashRevenue` is also
  returned on the response so `Financials.jsx`'s own margin % divides by
  the same figure `netProfit` was actually computed from, rather than the
  accrual `totalPaid`, which wouldn't reconcile with it. `totalPaid`
  itself (and everything derived from it — `totalOutstanding`,
  `overdueAmount`, the Collection Rate meter) stays accrual, matching the
  Sales Report PDF's own convention — this is a deliberate, permanent
  split, not a bug to unify later: "how much of what was billed this
  period is still owed" is inherently an accrual question, while "how
  much did the business actually profit this period" is inherently a
  cash one, and this app's own pre-existing P&L report had already
  settled on cash for the latter before this filter existed.
  `clientCount` and `quoteCounts` are never scoped by the filter — a live
  headcount and an all-time quote-status breakdown aren't really
  period-scoped concepts. **`bankBalance` is the one figure a period
  filter doesn't narrow — it moves *when* the running balance is measured
  instead**: `bankBalanceAsOf` (also returned) is the filtered range's own
  `to` date, or today for the unfiltered case (identical to what this
  always meant before period filtering existed) — the balance itself is
  the cumulative running total through that one cutoff date, mirroring
  `routes/reports.js`'s own `GET /bank-balance/pdf` closing-balance math
  exactly, just collapsed to one "as of" cutoff instead of that route's
  separate opening/closing split. `Financials.jsx`'s own Bank balance
  `KpiCard` sub text reads "As of {date}" whenever that date isn't today,
  falling back to its original static explanation otherwise. `monthlyTrend`
  (the "Revenue, last 6 months" chart) is deliberately **not** scoped to
  the period filter either — that widget's own title already sets a fixed,
  independent framing (always the 6 months trailing from today), so it
  keeps showing that regardless of which filter tab is selected.
- `routes/reports.js` (mounted at `/api/reports`) — five downloadable PDF
  reports, each `GET /<type>/pdf?from=&to=` (`YYYY-MM-DD`, both required;
  400s if either is missing/malformed or `from` is after `to`). Gated on
  the same `requirePermission('financials', 'view')` as the Financials
  page/summary endpoint rather than a dedicated `reports` module — these
  PDFs surface the same sales/tax/expense data at the same sensitivity
  level, so reusing the existing grant avoids a second permission slot (and
  a `Users` page/`MODULES` update) for data staff can already see once
  granted. Sales and tax reports both read `invoices` by `issue_date`
  (accrual — what was billed in the period, regardless of whether it's
  been paid), excluding `void` the same way `routes/financials.js` does:
  `GET /sales/pdf` lists each invoice with client/date/status/total/paid/
  balance plus totals; `GET /tax/pdf` lists each invoice's taxable amount
  (`subtotal - discount_amount`, the base `tax_amount` was actually
  computed against — see `lib/totals.js`), rate, and tax collected, plus
  grand totals — a filing-style report. `GET /expenses/pdf` lists
  `expenses` by `expense_date` in range, grouped by category with a
  subtotal per category and a grand total. `GET /profit-loss/pdf` is cash-
  basis, mirroring `netProfit`'s own convention: revenue is
  `SUM(payments.amount)` where `paid_at` falls in the range (cash actually
  received, not invoiced), expenses are grouped by category the same way
  the expense report is, and net profit/loss is revenue minus total
  expenses — rendered as a green "NET PROFIT" or red "NET LOSS" bar
  depending on the sign. `GET /bank-balance/pdf` is the PDF counterpart to
  `routes/financials.js`'s `bankBalance` (see below), just split at the
  period boundary instead of computed "as of right now": opening balance
  is `business_settings.starting_balance` plus every
  `payments`/`capital_contributions`/`expenses`/`owner_draws` row dated
  strictly *before* `from` (draws subtract, returns add back), closing
  balance adds every row *through* `to` (same inclusive `BETWEEN`
  convention the other reports use) on top of that. None of these routes call `logActivity()` (same
  as the existing `:id/pdf` routes — a read-only download isn't a
  mutation) or accept `page`/`q` (each report is inherently a from/to
  filtered dump, not a paginated list).
- `lib/reportPdf.js` — renders the five report PDFs above with `pdfkit`.
  These are tabular/statement documents, not the bill-to/line-items/
  signature shape `lib/pdf.js` renders for quote/invoice/receipt — but
  share that module's page geometry, palette, and `money()`/image/buffer
  helpers (re-exported from `lib/pdf.js` for this reason) rather than
  duplicating them. `drawReportHeader` is the equivalent of `lib/pdf.js`'s
  `drawHeader`, but with a report title/date-range/generated-timestamp on
  the right instead of a numbered document's meta rows. `drawReportTable`
  is a generic paginating table (caller supplies `{ key, label, x, width,
  align, format(row) }` columns) backing the sales/tax reports and each
  category's rows on the expense report; `drawSummaryBox` is the generic
  right-aligned label:value totals block those three use in place of
  `lib/pdf.js`'s fixed subtotal/discount/tax shape. The P&L statement uses
  its own `drawStatementSection` (a REVENUE/EXPENSES section: heading, one
  row per line item, a bold total row) twice, then `drawNetProfitBar` for
  the closing figure — net profit is the one amount here that can go
  negative, so it's formatted with `signedMoney()` (mirrors the frontend's
  own `Financials.jsx` `money()` helper's sign handling) rather than the
  shared `money()`, which never special-cases a sign. The bank balance
  statement is the one report that reuses `drawSummaryBox` directly rather
  than `drawStatementSection` — it's a four-line reconciliation (opening
  balance, payments received, expenses, closing balance), not a
  category-by-category breakdown, so a single right-aligned box says
  everything a P&L-style two-section layout would, with less of it.
  Opening/closing balance both go through `signedMoney()` since a
  business's balance can start (and stay) negative; expenses render as a
  negative value too (`signedMoney(-totalExpenses, symbol)`) so the box
  reads as a literal running sum top to bottom.
  **Wrapped cells no longer overlap the row below them**: `drawReportTable`
  used to draw every row at a fixed 18px height, but `pdfkit`'s own
  `.text()` wraps (rather than clips) a value wider than its column — a
  long client/company name, or a money figure under a multi-character
  currency symbol (e.g. `MVR 12,345.67`), would wrap onto a second line
  that rendered *underneath the next row* instead of growing the row to
  fit, reading as cut-off/garbled text rather than simply narrow. Each
  row's height is now measured up front from its own tallest wrapped cell
  (`doc.heightOfString` per column, same font/size the row is actually
  drawn with) and sized to the tallest one, so a long value always grows
  its own row instead of colliding with the one below it — `drawSummaryBox`
  gets the identical treatment on its value column. Column widths on the
  sales/tax report tables were also rebalanced (CLIENT and the money
  columns get more room; DATE/STATUS/RATE never need much) and the expense
  report's DESCRIPTION/AMOUNT columns absorbed a 60pt gap that used to sit
  entirely unused between them — none of this is a substitute for the
  dynamic-height fix above, just less likely to need it in the first
  place. **Every individual money figure in these five reports is now
  symbol-free** — `amountOnly()`/`signedAmountOnly()` (both call
  `money()`/`signedMoney()` with an empty symbol string, so the number
  formatting itself — thousands separators, 2dp, sign placement — can
  never drift from the symbol-carrying version) replace every
  `money(x, symbol)`/`signedMoney(x, symbol)` call in
  `drawReportTable`'s columns, `drawSummaryBox`'s rows, and
  `drawStatementSection`'s rows/`drawNetProfitBar`'s value across all five
  render functions. With a dozen-plus money figures on one report page,
  repeating the symbol beside every single one was pure visual noise (and
  exactly what narrowed the money columns enough to trigger the wrapping
  bug above) — `drawReportHeader` instead states it once, as a small
  `Amounts in {symbol}` line under the title/date-range (right above
  "Generated ..."), trimmed from `settings.currency_symbol` (which itself
  carries a trailing space for spacing before a value, e.g. `'MVR '` — the
  note trims that back to a bare `MVR`). This is deliberately scoped to
  just these five report PDFs — the quote/invoice/receipt PDFs `lib/pdf.js`
  renders are single documents with only a handful of money lines each,
  where the symbol still pulls its weight, so those keep it on every line
  unchanged.
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
  `renderInvoicePdf` targets its "PAID" stamp directly over the Balance Due
  amount (via `drawTotals`'s own `info.balanceX`/`balanceY`/`pageIndex`
  output — see that function's own comment) rather than the plain
  page-center fallback `addPaidStamp`/`addMinimalPaidStamp` use with no
  `target`; `renderReceiptPdf`/`renderReceiptPdfMinimal` follow the same
  approach for their own stamp, targeting the "AMOUNT RECEIVED" box each
  draws (`amountReceivedTarget`, computed right after that box is drawn —
  `{ x: box's horizontal center, y: box's vertical center, pageIndex }`,
  the `pageIndex` captured via `doc.bufferedPageRange()` the same way
  `drawTotals` does, since `addPaidStamp` only runs once the whole document
  is buffered and finished) — a receipt's stamp used to land at a fixed
  page-center spot with no relation to where the amount was actually
  printed, which read as arbitrary on a receipt that had a "REFERENCE"/
  "NOTES" section long enough to push the rest of the page down; both PDF
  templates get the same fix, not just the default one.
- `lib/mailer.js` — `sendMail()` wraps `nodemailer` with SMTP settings from
  env (`SMTP_HOST`/`PORT`/`USER`/`PASS`/`FROM`/`SECURE`). If `SMTP_HOST`
  isn't set, it throws `EMAIL_NOT_CONFIGURED` rather than crashing — routes
  catch this and return `503` with a message telling the caller which env
  vars to set. Everything else (PDF download, payments, financials) works
  with no SMTP configured at all. Also exports `textToHtml()` — see "Email
  preview before sending" above — the plain-text-to-HTML conversion for a
  user-edited email body — and its own internal `escapeHtml()`, reused by
  `lib/licenseRenewalEmail.js` (see "Renewal confirmation email" under
  Licenses above) to safely interpolate client/license names into a real
  HTML template rather than plain text run through `textToHtml()`.
- `lib/emailTemplates.js` — the default `{ subject, message }` for every
  client-facing send action; see "Email preview before sending" above. Now
  admin-editable via the Email Center (`routes/emailCenter.js`/
  `pages/EmailCenter.jsx` below): `DEFAULT_TEMPLATES` holds the built-in
  text for the 5 editable types (`quote_send`, `invoice_send`,
  `invoice_remind`, `receipt_send`, `license_remind`) as `{{placeholder}}`
  strings (e.g. `Quote {{quote_number}} from {{business_name}}`); the
  `email_templates` table (one row per `type`, primary-keyed on it — see
  `db/index.js`) holds an optional admin override. `renderTemplate(str,
  vars)` does the `{{key}}` substitution — an unknown placeholder is left as
  literal text rather than blanked, so an admin typo is visible/debuggable
  instead of silently vanishing. `buildEmail(type, to, vars)` picks the
  stored override if one exists, else the default, renders both subject and
  message, and is what the five exported functions
  (`quoteSendEmail`/`invoiceSendEmail`/`invoiceRemindEmail`/
  `receiptSendEmail`/`licenseRemindEmail`) now call internally — their
  signatures are unchanged, so every existing call site (the preview/send
  routes in `routes/quotes.js`/`routes/invoices.js`/`routes/licenses.js`)
  needed no changes at all when this template system was added; adding
  `licenseRemindEmail` later needed no changes to `getAllTemplates()`/
  `setTemplate()`/`resetTemplate()` below either, since they all iterate
  `DEFAULT_TEMPLATES`' own keys generically — a 5th type just needed an
  entry in `DEFAULT_TEMPLATES`/`PLACEHOLDERS`/`TYPE_LABELS` and it's
  automatically picked up everywhere. `PLACEHOLDERS` documents which
  `{{...}}` keys are valid per type (shown as a hint in the Email Center
  UI); `TYPE_LABELS` is the human-readable name per type.
  `getAllTemplates()`/`setTemplate(type, {subject,
  message})`/`resetTemplate(type)` are the admin-management functions
  `routes/emailCenter.js` calls — `getAllTemplates()` returns all 5 types
  with whichever text is currently effective (stored override or default)
  plus `isCustom` (so the frontend only shows "Reset to default" when
  there's actually an override to clear) and the raw
  `defaultSubject`/`defaultMessage` for reference. This deliberately does
  **not** cover the automated overdue-reminder digest
  (`lib/scheduler.js`'s `runOverdueReminders()`) — that email's content
  stays fully automatic and non-customizable by design (unlike a
  human-triggered send, nobody reviews it before it goes out), so it never
  reads from this file; its sends are still recorded to the Email Center's
  sent log under a distinct `overdue_reminder` type, just not through
  `buildEmail()`. The automated license-expiry alert
  (`lib/scheduler.js`'s `runLicenseExpiryAlerts()`) is the **opposite**
  case, deliberately: it calls `licenseRemindEmail()` — the very same
  admin-editable template the manual "Remind" button uses — rather than
  hardcoding its own text like the overdue-reminder digest does, so an
  admin who customizes the license reminder wording gets that wording
  whether a human clicked "Remind" or the cron job sent it automatically.
  Its sends are still logged under their own distinct type
  (`license_expiry_alert`, see `lib/emailLog.js` below) purely so the sent
  log can tell "a human sent this" apart from "the cron job sent this,"
  the same reason `overdue_reminder` is distinct from `invoice_remind`.
- `lib/emailLog.js` — `logEmail({ type, to, subject, sentByName,
  entityType, entityId, entityLabel })` inserts one row into `email_log`
  (see `db/index.js`), backing the Email Center's sent log
  (`routes/emailCenter.js`'s `GET /log`). Distinct from `lib/activity.js`'s
  `activity_log`: that's a general "who did what" audit trail that already
  logs its own separate "sent"/"sent reminder for" entry per send action,
  but never captures recipient email or subject — this is additive, not a
  replacement, and every call site logs to both. Called after a
  *successful* `sendMail()` only (never on a caught error) from all 5
  manual send routes (`routes/quotes.js`'s `POST /:id/send`;
  `routes/invoices.js`'s `POST /:id/send`, `POST /:id/remind`, and
  `POST /:id/payments/:paymentId/send-receipt`; `routes/licenses.js`'s
  `POST /:id/remind` — logged as types
  `quote_send`/`invoice_send`/`invoice_remind`/`receipt_send`/
  `license_remind` respectively, the same 5 types `emailTemplates.js`
  covers) and from the two automated jobs in `lib/scheduler.js`
  (`runOverdueReminders()`, type `overdue_reminder`, and
  `runLicenseExpiryAlerts()`, type `license_expiry_alert` — both
  `sentByName: 'Automated'`) — the two log entry types with no *distinct*
  editable template of their own (`license_expiry_alert` reuses
  `license_remind`'s template as explained above; `overdue_reminder` has no
  template at all). `notifyStaffOfReminders()`'s internal opt-in
  staff digest (also in `lib/scheduler.js`) is deliberately **not**
  logged here — it's an internal notification about client emails already
  logged, not itself a client-facing send.
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
  backs `routes/import.js`. Its header row is lowercased *and* has
  whitespace runs collapsed to underscores (`h.trim().toLowerCase().replace(/\s+/g,
  '_')`) before becoming each row object's keys — added after "delete
  some expenses, re-export/re-import the same ones, net profit changes"
  turned out to mean exactly what it sounds like: `routes/expenses.js`'s
  own `GET /export.csv` wrote a human-readable `"Expense date"` header
  (well, `"Date"` at the time — see that route's own note), but
  `routes/import.js`'s `validateExpenseRow()` reads `row.expense_date`, a
  plain lowercase-and-underscored key never checking for the export's own
  Title-Case-with-spaces label. Every field whose export label was more
  than one word — `expense_date`, `exchange_rate`,
  `payee_account_number`, `usd_destination` — was silently unreadable on
  reimport, so `expense_date` came back `undefined` for every row,
  `normalizeDate(undefined, …)` returned `null`, and every single row
  failed validation with "expense_date must be a valid date." A business
  that exported its expenses, cleared them (the Danger Zone, or a manual
  bulk delete), and reimported the very file it had just downloaded ended
  up with *zero* expenses re-created instead of the same ones back — read
  from the financials summary as "net profit went up," since
  `totalExpenses` had silently dropped to (or toward) zero while nothing
  else about the business had changed. This normalization is what closes
  that gap: it's a no-op for every hand-authored CSV using this app's own
  underscored template headers (`routes/import.js`'s own `TEMPLATES`, e.g.
  `expense_date` — never contains a space to begin with, so
  `.replace(/\s+/g, '_')` never touches it), and it's what makes an
  exported file's own Title Case headers resolve to the right keys instead
  — `"Expense date"` → `expense_date`, `"Exchange rate"` →
  `exchange_rate`, and so on — without needing every export label to be
  written in raw snake_case (which would make the downloaded file read
  like a technical dump rather than a report). This alone doesn't make
  every entity's export a safe reimport source — it fixes `expenses`
  fully (see `routes/expenses.js`'s own note) and, combined with a
  handful of label renames, `licenses` too (see `routes/licenses.js`'s
  own note on that one — a single-word label with no space for this
  normalization to work with needed a real rename, not just whitespace
  collapsing). `invoices`/`quotes` are the one pair this can't close the
  gap for, structurally rather than by a naming oversight — see
  `routes/invoices.js`'s own note on why.
- `lib/xlsx.js` — `toXlsxBuffer(rows, columns, sheetName)`, the `.xlsx`
  counterpart to `toCsv()` above, built on `exceljs` (the one real npm
  dependency either serializer needs — CSV is simple enough to hand-roll,
  a valid `.xlsx` isn't). Takes the exact same `columns` shape, so every
  `GET /export.xlsx` route reuses the identical `rows`/`columns` its
  `GET /export.csv` sibling already defines (each of the six export-capable
  route files below factors both into a shared `load*Export()` function for
  this reason — one query, one column list, two serializers, no risk of the
  two formats drifting apart). Unlike `toCsv`, which stringifies every
  value (CSV has no cell types), values here keep their real JS type — a
  number is written as a numeric cell, not text — so opening the file in
  Excel/Sheets gives real, sortable/summable numbers for money/quantity
  columns instead of text that merely looks like numbers. No CSV-injection
  guard is needed here the way `toCsv`'s leading-`'` prefix is: that guard
  exists because a CSV field is just re-parsed text a spreadsheet app might
  reinterpret as a formula, but `exceljs` writing a plain string assignment
  produces an explicit string-typed cell, which Excel never reinterprets as
  a formula regardless of its leading character. `writeBuffer()` is async
  (unlike `toCsv`), so every `GET /export.xlsx` handler is an `async` route.
- `routes/import.js` — `POST /api/import/:type` (`type` is `clients`,
  `expenses`, `invoices`, `quotes`, `licenses`, `products`, or
  `currency-exchange`) bulk-imports historical data from CSV text in the
  request body. Always validates every row first; `commit: false`
  (the default) is a dry-run that reports what *would* happen with no DB
  writes, `commit: true` actually inserts the valid rows and skips the
  invalid ones — the frontend always previews before offering to commit.
  Each row gets a `{ row, status: 'ok'|'error', message, preview }` result,
  so partial success is normal, not a failure state. Every date column
  (`issue_date`, `due_date`/`expiry_date`, `paid_date`, `expense_date`,
  `start_date`) goes through `normalizeDate()` rather than a strict
  `YYYY-MM-DD` regex —
  spreadsheet exports routinely produce `D/M/YYYY`-style dates (with `/`,
  `-`, or `.` separators), `YYYY/MM/DD`, 2-digit years, and even raw Excel
  serial-date numbers, and all of them normalize to the canonical form
  before validation. Which of `D/M/YYYY` or `M/D/YYYY` a given value means
  is inherently ambiguous when both parts are ≤12 (`"5/4/2025"` could be
  either), so `normalizeDate()` never guesses per value — it takes a
  `format` argument (`'day-first'` or `'month-first'`) and defers to it for
  exactly that ambiguous case; a value where one part is >12 only has one
  valid reading regardless of `format`. `detectDateFormat()` derives that
  argument once per import batch (`processExpenses`/`processInvoices`/
  `processQuotes`/`processLicenses` each call it before validating any row)
  by scanning every
  date-ish value in the batch for unambiguous evidence — a value like
  `"4/23/2026"` can only be month/day (day=23), which pins down the format
  for every other, genuinely ambiguous value in the *same* batch too (e.g.
  `"5/4/2026"` then reads as May 4, not April 5), since one CSV column is
  always internally consistent even if individual rows are ambiguous in
  isolation. Falls back to day-first (this app's primary market, the
  Maldives, writes day before month like most of the world) only when the
  batch has no unambiguous evidence either way. `parseNumber()` similarly
  strips thousands-separator commas and a leading currency symbol from
  `amount`/`tax_rate`/`amount_paid` so `"2,500"`/`"$2,500.00"` parse the
  same as `"2500"`. Every enum-like column matched against a fixed list
  (invoice/quote `status`, license `billing_cycle`/`status`, expense
  `category`, invoice `payment_method`) is `.trim().toLowerCase()`'d before
  the `includes()` check — expense `category` and invoice `payment_method`
  originally weren't, a real bug (found when a user's spreadsheet used
  Title Case like `"Rent"`/`"Cash"` and every one of those rows silently
  failed validation and got skipped, quietly understating `totalExpenses`
  and inflating `netProfit`) rather than a deliberate strictness choice —
  keep new enum columns consistent with this pattern.
  Invoices and quotes are both matched to an existing client via the shared
  `resolveClient()`/`clientMaps()` helpers: by `client_email` first, falling
  back to an exact `client_name` match if `client_email` is blank (import
  clients first) — the fallback exists so a row can still resolve when a
  legitimate client simply wasn't given an email on that particular row,
  not as a way around requiring a real email up front: the clients importer
  itself still requires a valid, RFC-format email (`EMAIL_RE`). Invoices and
  quotes both require a single `amount` rather than itemized line items —
  it's run through the same `computeTotals()` every invoice/quote uses,
  just with one synthetic line item. An invoice's optional `amount_paid`/
  `paid_date` creates a real `payments` row too (not just a number on the
  invoice), so imported history shows up correctly in `recentPayments`/
  `monthlyTrend` on the financials endpoint, not just in the invoice's own
  totals; `status: 'paid'` with `amount_paid` left blank implies paid in
  full (the total) rather than erroring, since a historical export often
  only records the final status. Quotes have no payment concept — an
  explicit `status` must be one of `draft|sent|accepted|declined|expired`
  (blank defaults to `draft`), and `expiry_date` defaults to issue date +30
  days (matching `QuoteForm.jsx`'s own default) when not given. Invoice/
  quote numbers default to the same `INV-<year>-####`/`Q-<year>-####`
  scheme as live documents — but year-of-issue-date, not year-of-import,
  via `numbering.js`'s `invoiceNumberForYear()`/`quoteNumberForYear()` — or
  you can supply your own `number` column to preserve original historical
  numbers. Within one import batch, auto-generated numbers are handed out
  from an in-memory per-year counter (`makeSequencer()`) seeded from the
  real DB count, rather than re-querying per row — needed because preview
  mode never writes anything, so two same-year rows calling the DB-backed
  numbering function directly would collide on the same "next" number.
  Licenses are matched to a client the same way, via the same
  `resolveClient()`/`clientMaps()` helpers — the one other row type besides
  invoices/quotes that references a client rather than being one. A row's
  `billing_cycle` (`monthly`/`yearly`, blank defaults to `yearly`) and
  `start_date` are required; a blank `expiry_date` defaults to
  `start_date` + one billing cycle via `lib/licenseRenewal.js`'s
  `advanceExpiry()` (the same shared function `routes/licenses.js`'s
  `POST /:id/renew` and `routes/invoices.js`'s auto-renewal both call —
  see "License auto-renewal on invoice payment" above), matching what the
  New License form itself defaults to. `status` (`active`/`cancelled`, blank
  defaults to `active`), `amount` (blank defaults to `0`), and an optional
  `url` (free text, blank defaults to `''` — same field, same precedent, as
  the manual form's "Activation URL," see `pages/business/Licenses.jsx`
  below) are otherwise the only other columns — no line items, no document
  number, no PDF, since a license isn't a document the way an invoice/quote
  is. `created_by_name`
  is left at its `''` default the same way invoice/quote imports leave it
  blank, per `db/index.js`'s own note on that column being blank for
  anything generated with no human directly filling out the form.
  **Repeated rows for the same client + license name are folded into one
  license's renewal history, not imported as separate licenses** — this is
  the shape a business's actual historical export usually takes (one row
  per past renewal period, same client, same license name, different
  dates), and importing each row as its own license would both duplicate
  the license and lose the fact that it was ever renewed. After per-row
  validation, `processLicenses()` groups valid rows by `clientId` +
  `name.toLowerCase()` (same trim+lowercase match `resolveClient()`/
  `clientMaps()` already use for client name) and sorts each group by
  `start_date` — the row with the *latest* `start_date` becomes the
  license's current record (its `status`/`amount`/`billing_cycle`/`url`/
  `notes` win, and the license's `start_date` is the *earliest* row's, not
  the current row's, matching how `POST /:id/renew` itself never touches
  `start_date`), and every earlier row becomes a `license_renewals` entry
  (`previous_expiry_date`/`new_expiry_date` from that pair's consecutive
  `expiry_date`s) exactly like a manual renewal writes — see
  `routes/licenses.js`'s `POST /:id/renew` above. `renewed_at`/
  `last_renewed_at` have no source column in the CSV, so they're
  approximated as the newer row's `start_date` at midnight (`renewed_by_name`
  stays at its `''` default, same as `created_by_name`). A license with no
  duplicate rows behaves exactly as before (single insert, `last_renewed_at`
  stays `NULL`) — grouping is a no-op for the common case. Each row still
  gets its own line in the returned `results` (`"imported"` for the winning
  row, `"imported as renewal history for row N (...)"` for the rest) so the
  preview step shows exactly which rows will merge before anything commits.
  Whole commit runs in one `db.transaction()` since an invoice import
  writes to three tables (`invoices`, `invoice_items`, `payments`) per row
  (two for quotes, no `payments` row; licenses write one or two tables per
  row depending on whether that row merges into an existing group).
  `imported` counts every successfully-processed row (both new-license and
  merged-into-history rows), not distinct license count. Logs one summary
  `activity_log` entry per import ("bulk imported 42 clients from CSV"),
  not one per row.
  **A CSV row matching an already-existing license updates it in place
  instead of inserting a duplicate** — `existingLicenseMap()` looks up
  every current license by the same `clientId::name.toLowerCase()` key the
  batch-grouping above already uses, built once per import call. This is
  what makes an export → edit → re-import round trip (correcting an
  amount, adding a URL, fixing a billing cycle via the Licenses page's own
  "Export CSV"/"Export Excel" buttons, then re-importing the edited file)
  actually safe: before this, every re-import — even of an unmodified
  export — silently created a second license for the same client+name,
  since the importer had no notion of "this already exists." The update
  path (`UPDATE licenses SET status = ?, billing_cycle = ?, amount = ?,
  expiry_date = ?, url = ?, notes = ?, ...`) deliberately never touches
  `start_date` or `client_id` — an update is a correction to an existing
  license, not a new one, so `start_date` keeps reflecting whenever the
  license actually began, the same invariant the insert path and
  `POST /:id/renew` already honor. `last_renewed_at` only changes when
  this import batch actually added renewal history for that license
  (`COALESCE(?, last_renewed_at)` keeps whatever was already stored
  otherwise) — a plain field-correction re-import doesn't fake a renewal
  that never happened. If the matched group itself has multiple rows (the
  renewal-history-merge case above) *and* matches an existing license, the
  earlier rows still become `license_renewals` entries exactly as before,
  now chained onto the existing license's id instead of a freshly inserted
  one. Results say `"updated existing license"` (`"ready to update
  existing license"` in preview) instead of `"imported"` so the preview
  step makes the distinction obvious before anything commits. If more than
  one existing license somehow already shares a client+name (e.g. from
  duplicates created before this matching existed), the highest id wins.
  **Products** (`processProducts()`) is the simplest importer in this file
  — no client to resolve, no dates, no multi-table writes, just `name`
  (required), `description`, `unit_price` (required, non-negative),
  `tax_rate` (optional, 0–100, same validation `routes/products.js`'s own
  `POST`/`PUT` apply), and `visible_in_portal` (optional; `true`/`yes`/`1`/
  `y`, case-insensitive, is truthy — anything else, including a blank
  cell, defaults to `false`/hidden, matching the manual form's own
  opt-in-only default). Products have no client to disambiguate by, so
  `existingProductMap()` matches a row to an existing product purely by
  `name` (trimmed, case-insensitive) — same export → edit → re-import
  safety `existingLicenseMap()` above already established for licenses,
  applied to the one other entity here that benefits from it: a business
  correcting a price or opting a product into the portal via an edited
  re-import doesn't end up with a duplicate catalog entry. A matching row
  updates every field except `name` itself (an update is a correction, not
  a rename); a name repeated *within the same file* is rejected with a
  `duplicate: "..." also appears on row N` error rather than silently
  updating the same product twice from one batch. `imported` counts every
  row that resolved to a write (insert or update).
  **`currency-exchange`** (`processCurrencyExchange()`) isn't a distinct
  entity — every currency-exchange transaction is, underneath, a plain
  `expenses` row with `category = 'currency exchange'` (the general
  `expenses` type above already supports importing these via a `category`
  column set on each row), so this type is a thin wrapper rather than a
  parallel implementation: it maps every row to `{ ...row, category:
  'currency exchange' }` and hands the whole batch straight to
  `processExpenses()`/`validateExpenseRow()` above, unchanged. The only
  real difference is the CSV shape this type expects — no `category`
  column at all (any value present there is silently discarded, not read;
  every row becomes `currency exchange` regardless), so `description`,
  `amount`, `expense_date`, and `exchange_rate` are all required on every
  row (the last one only because `validateExpenseRow()`'s own
  `category === 'currency exchange'` branch is now unconditionally true).
  Exists purely so a batch of currency-exchange records — the one category
  with its own dedicated detail view (`routes/expenses.js`'s "Currency
  exchange details", `ExpenseAnalytics.jsx`'s own transactions table) —
  doesn't require repeating the same literal string on every row of an
  otherwise-uniform CSV. The success-path activity log entry (below) reads
  `entityType: 'expense'`, not the literal `'currency-exchange'` route
  param, and its label says "N currency exchange expenses" rather than the
  generic `${imported} ${type}` every other type gets, since these rows
  are genuinely just expenses and should read that way in the feed, not as
  a fabricated entity type nothing else in `activity_log` ever produces.
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
- `backend/scripts/fix-license-renewal-dates.js` (`npm run fix-license-renewals`,
  `--apply` to write — dry-run by default) — a one-off correction for data
  written by the old, pre-fix `renewLicense()` (see "The core action" above),
  which advanced a renewal from whichever was later, the license's
  `expiry_date` or *today*, instead of always from the license's own
  `expiry_date` — so renewing a lapsed license landed the new expiry on
  today's day-of-month rather than the license's real billing day. Not a
  blind bulk `UPDATE`: for each license it walks `license_renewals`
  chronologically from the first row's `previous_expiry_date` (a trustworthy
  snapshot, never itself computed by the buggy code) and recomputes what
  each `new_expiry_date` — and, for any row after the first, that row's own
  `previous_expiry_date` too, so a corrected chain stays internally
  consistent and a re-run reads it as already-fixed rather than a fresh
  discontinuity — *should* have been using the current (fixed)
  `advanceExpiry()`. The moment a row's recorded `previous_expiry_date`
  doesn't match what the prior step actually produced, that license's chain
  is left untouched from that point on and reported as needing manual
  review instead of guessed at, since the mismatch means something this
  script can't explain happened in between (most plausibly a deliberate
  manual `expiry_date` edit) — overwriting it would risk destroying real
  data instead of fixing a bug. Only updates the license's *current*
  `expiry_date` when it still equals exactly what the chain's last renewal
  actually wrote (i.e. nothing has touched it since); otherwise it fixes the
  history log only and leaves the live `expiry_date` flagged for a human to
  check. Take a fresh backup first (`npm run backup`, or copy `data.sqlite3`
  directly if self-hosted) before running with `--apply` — this writes to
  real `licenses`/`license_renewals` rows.
- `lib/scheduler.js` — `startScheduler()` (called once from `index.js`'s
  `app.listen` callback) registers five `node-cron` jobs, all server-time:
  - `0 3 * * *` — `runBackup()` (see `lib/backup.js` above), scheduled
    ahead of the other jobs so a backup reflects state from before
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
  - `30 7 * * *` — `expireOverdueQuotes()`: flips any quote still
    `status = 'sent'` with a non-null `expiry_date` in the past to
    `status = 'expired'`. This exists because `expired` is a real, stored,
    filterable quote status (`Quotes.jsx`'s `STATUS_OPTIONS`, `PUT /:id`'s
    `validStatuses`) that nothing else in the app ever sets — there's no
    status field anywhere in `QuoteForm.jsx`/`QuoteDetail.jsx` (the only
    other status transitions are `sent` via `POST /:id/send`, and
    `accepted`/`declined` via the client's public-link response or
    `POST /:id/convert-to-invoice`) — so without this job a quote past its
    deadline that nobody responded to just stayed `sent` forever, and the
    "Expired" filter/badge could only ever show quotes brought in with that
    status via CSV import. Only `sent` quotes are eligible: a `draft` quote
    was never actually offered to a client, so there's nothing for it to
    have expired *on*, and `accepted`/`declined`/already-`expired` quotes
    already have a real, final answer that shouldn't be overwritten. No
    `SMTP_HOST` dependency (it's a plain status update, not an email), so
    unlike the two reminder jobs below it always runs. Doesn't call
    `logActivity()`, matching `generateDueRecurringInvoices()` just above —
    neither of these two silent background mutations write to
    `activity_log`, only the two email-sending jobs below do (via
    `logEmail()`, a distinct log).
  - `0 8 * * *` — `runOverdueReminders()`: skips entirely if `SMTP_HOST`
    isn't set. Selects `invoices` where `status='sent'`,
    `amount_paid < total`, `due_date < today`, and
    `last_reminder_sent_at` is either null or over 7 days old (so a human
    sending a manual reminder, or a previous automated one, suppresses
    re-nagging for a week). **Dunning ladder**: the email this job sends
    escalates in tone as an invoice ages, rather than repeating the same
    gentle wording indefinitely. `daysOverdue(dueDate)` computes how many
    whole days past `due_date` today is, and `dunningContent({ invoice,
    client, settings, balanceDue, overdueDays })` picks one of three fixed
    stages from it: `soft` (the default, under `DUNNING_FIRM_DAYS` = 14
    days overdue — a plain "this is due, here it is again" reminder),
    `firm` (14–29 days — "remains unpaid... please arrange payment as soon
    as possible"), and `final` (`DUNNING_FINAL_DAYS` = 30+ days — a
    `FINAL NOTICE:` subject line and "please settle this balance
    immediately to avoid further action"); each stage has its own
    subject/HTML body, still with the invoice PDF attached exactly as
    before. This needed **no new DB state or scheduling change at all** —
    the job already runs daily and already suppresses re-sends for 7 days
    via `last_reminder_sent_at`, so the *same* invoice naturally gets
    re-selected roughly every week as it ages, and each time
    `daysOverdue()` is simply recomputed fresh against today — an invoice
    that was `soft` on its first reminder reads as `firm` a couple of
    re-sends later and eventually `final`, with no separate "which rung of
    the ladder is this invoice on" column to keep in sync. Deliberately
    **not** wired into `lib/emailTemplates.js`'s admin-editable template
    system the way `quote_send`/`invoice_send`/`invoice_remind`/
    `receipt_send`/`license_remind`/`portal_invite` all are — this follows
    that file's own existing precedent for this exact job (see its
    top-of-file note): nobody reviews an automated reminder before it goes
    out the way a human reviews a manual "Send" click via
    `EmailPreviewModal`, so like the rest of this digest's wording, the
    three stages' copy is a fixed, hardcoded escalation rather than
    something an admin can rewrite per stage. `logEmail()`'s
    `entityLabel` for this job is now `` `${invoice.number} (${stage})` ``
    (e.g. `INV-2026-0001 (firm)`) rather than just the bare number, so the
    Email Center's sent log shows which rung of the ladder each historical
    send actually was. Emails the invoice PDF and updates
    `last_reminder_sent_at`. After the loop, if any reminders actually went
    out, calls `notifyStaffOfReminders(reminded, settings)` — queries
    `users` for `active = 1 AND notify_overdue = 1` and emails each an HTML
    digest listing every invoice that was just reminded (number/client/
    balance/due date), now with a fourth column reading the plain-English
    stage label (`STAGE_LABELS`: "reminder" / "firm reminder" / "FINAL
    NOTICE") so a staff member scanning the digest can tell at a glance
    which overdue invoices are still early and which are about to (or
    already did) get the final-notice treatment. This is opt-in per-user
    (see `PUT /api/auth/preferences` above) and best-effort: each
    recipient send is its own try/catch so one bad address never blocks
    the others, and since it only runs after the SMTP-configured check
    above, it's naturally dormant (never even reached) when SMTP isn't set
    — no separate gate needed. Verified by creating three test invoices
    engineered to sit at 3/20/45 days overdue and confirming
    `dunningContent()` resolved each to `soft`/`firm`/`final` respectively
    (via a temporary debug log, removed before commit) — real SMTP
    delivery itself isn't testable in this environment, so the send
    attempt was exercised against an unreachable `SMTP_HOST` to confirm
    the full query/render/recipient pipeline runs correctly up to the
    point of the (expected, harmless) `ECONNREFUSED`.
  - `15 8 * * *` — `runLicenseExpiryAlerts()`: staggered 15 minutes after
    the overdue-reminder job purely so the two jobs' console output doesn't
    interleave, not for any functional reason. Same shape as
    `runOverdueReminders()` — skips entirely if `SMTP_HOST` isn't set,
    same 7-day `last_reminder_sent_at` re-send suppression — but selects
    `licenses` where `status = 'active'` and `expiry_date` is within
    `routes/licenses.js`'s `EXPIRY_WARNING_DAYS` (30, duplicated here as a
    literal — see that file's own comment) of today, which naturally
    includes already-lapsed licenses too (a past `expiry_date` is always
    `<=` today+30). Emails via `licenseRemindEmail()` — the same
    admin-editable template the manual "Remind" button on `Licenses.jsx`
    uses, see `lib/emailTemplates.js` above for why this is the one
    automated job that reuses an editable template instead of hardcoding
    its own text — with no PDF attachment (a license isn't a document).
    Logged to `email_log` as type `license_expiry_alert`. No staff-digest
    equivalent to `notifyStaffOfReminders()` for this job — that's scoped
    to overdue invoices specifically, not extended here.
  - `0 9 1 * *` — `runMonthlyReport()`: the one job on a monthly rather
    than daily schedule (`node-cron`'s 5-field expressions support a
    day-of-month field directly) — fires at 09:00 on the 1st, comfortably
    after the 03:00 backup and the four daily jobs above so a slow backup
    can never delay it. Same `SMTP_HOST` skip as every other email job
    here, plus one more early exit specific to this one: since its entire
    purpose *is* the staff notification (there's no client-facing send to
    fall back to the way `runOverdueReminders()` always runs regardless of
    who's subscribed to the digest), it also skips — before generating
    anything — if `SELECT ... FROM users WHERE active = 1 AND
    notify_monthly_report = 1` comes back empty. Reports on the *previous*
    calendar month (this job runs on the 1st, so the current month has no
    data of its own yet) — `from`/`to` computed via `new Date(y, m, 0)`,
    the same day-0-rollback trick `advanceDate()` above already relies on
    for month-end clamping. Reuses the *exact* revenue/expense queries
    `routes/reports.js`'s own `GET /profit-loss/pdf` uses (duplicated as
    literals rather than imported — same acceptable-duplication call as
    `EXPIRY_WARNING_DAYS` two jobs up) and `lib/reportPdf.js`'s
    `renderProfitLossPdf()` to attach the identical PDF a human clicking
    that same button would get for the same range, so the automated
    email's attachment can never drift from the manual download. The
    email body itself is a short plain-English summary (invoiced/
    collected/expenses/net profit-or-loss) with the PDF attached, sent to
    every opted-in recipient independently (one bad address doesn't block
    the others, same `try/catch`-per-recipient shape as
    `notifyStaffOfReminders()`). Deliberately **not** logged via
    `lib/emailLog.js`'s `logEmail()` — same reasoning
    `notifyStaffOfReminders()` documents: this is an internal staff
    notification, not a client-facing send, so it has no place in the
    Email Center's sent log. `notify_monthly_report` (`users`, `ALTER
    TABLE`-added — same guarded pattern as `notify_overdue`/
    `notify_quote_responses`, `users` already had real accounts) is the
    third preference on `MyAccount.jsx`'s "Notifications" card, wired
    through the exact same `PUT /api/auth/preferences` route as the other
    two (see `routes/auth.js` above — that route's own `?? existing`
    per-field fallback already handled a third optional field with no
    changes needed beyond adding it to the destructure/`UPDATE`).
  All six jobs are also exported directly (`runBackup`,
  `generateDueRecurringInvoices`, `expireOverdueQuotes`,
  `runOverdueReminders`, `runLicenseExpiryAlerts`, `runMonthlyReport`) so
  they can be invoked outside the cron schedule (tests, or a manual "run
  now" action).

Status/derived-field conventions worth knowing before touching this code:
- Quote `status`: `draft | sent | accepted | declined | expired`, set
  explicitly by `PUT`/`/send`/`/convert-to-invoice`, by the client via
  `POST /api/public/quotes/:token/respond` (`accepted`/`declined`, also
  stored in `client_response`/`client_responded_at`), or by
  `lib/scheduler.js`'s `expireOverdueQuotes()` job (`expired` — see that
  file above; this is the only status value nothing in the UI ever sets
  directly, so it's automatic-only, the same way licenses'
  `expired`/`expiring_soon` are computed rather than manually chosen).
- Invoice `status`: only `draft | sent | void | paid` are ever stored —
  `paid` is set automatically the moment `amount_paid >= total` inside the
  `POST /:id/payments` handler. "Overdue" and "partially paid" are **not**
  stored; `invoices.js`'s `withComputed()` (also duplicated in `public.js`
  for the unauthenticated view) derives `is_overdue` and `is_partially_paid`
  from `status`/`due_date`/`amount_paid` on every read, so there's no cron
  job or background process keeping status in sync.
- Deletes are guarded in the route handlers with friendly, checked-first
  409s, not left to surface as a raw FK-constraint error: a client with
  any quotes, invoices, recurring-invoice templates, or licenses can't be
  deleted (`routes/clients.js`'s `DELETE /:id` checks all four —
  `quotes`/`invoices`/`recurring_invoices`/`licenses` all have a
  `NOT NULL REFERENCES clients(id)` with `foreign_keys = ON` actually
  enforced at the DB level too, so this guard exists to turn what would
  otherwise be an uncaught `SQLITE_CONSTRAINT_FOREIGNKEY` 500 into the same
  clean 409 message every other delete guard in this app gives), and an
  invoice with any recorded payments can't be deleted.
- `public_token` (random 16-byte hex, unique) exists on every quote and
  invoice row and is regenerated on duplicate/convert/recurring-generation
  — never reused across documents, and never exposed anywhere except the
  document it belongs to.

### Roles and permissions (`backend/src/`)

- Three roles: `admin` and `super_admin` (together, "admin-tier" — both
  bypass `user_permissions` entirely, see `hasPermission()` in
  `lib/permissions.js` above) and `staff` (subject to granular per-module
  `can_view`/`can_manage` grants, default-deny). New rows default to
  `role: 'staff'`, but the migration that introduced the `role` column
  (see `db/index.js` above) one-time-promoted every pre-existing user to
  `admin` so shipping that feature could never silently strip access from
  someone already using the app; `super_admin` needed no equivalent
  migration since `users.role` is a plain `TEXT` column with no `CHECK`
  constraint — a third value just needed application code to recognize it,
  not a schema change.
- `lib/permissions.js`'s `isAdminRole(role)` (`role === 'admin' || role ===
  'super_admin'`) is the single place that answers "does this role string
  count as admin-tier" — every other admin-role check in the app,
  backend and frontend, reads from here (or its frontend mirror,
  `frontend/src/lib/roles.js`'s own `isAdminRole()`) rather than
  re-deriving the rule with a literal `=== 'admin'`. `super_admin` is a
  **strict superset** of `admin` — `hasPermission()`/`effectivePermissions()`
  treat the two identically (both bypass `user_permissions` and get an
  all-true permissions map), and `middleware/auth.js`'s `requireAdmin`
  passes for either — the *only* place the two tiers diverge is
  `routes/users.js`'s exclusive control over admin-tier **accounts**
  themselves, described below. `super_admin` is never a narrower or
  parallel role to `admin` — there is no capability an `admin` has that a
  `super_admin` doesn't.
- `middleware/auth.js`'s `requireAdmin` is a second, stricter gate than
  `requirePermission` — it checks `isAdminRole(req.user.role)` directly
  rather than consulting `user_permissions`, so no staff grant can ever
  unlock it (unlike every other module in this app, which a staff member
  can be granted access to), and passes for either admin tier since
  `super_admin` is a strict superset of `admin`. Reserved for actions with
  no per-row undo (`routes/dataReset.js`) — a feature that's simply
  admin-tier-only by deliberate scope decision rather than a no-undo
  action can still move off `requireAdmin` later if that turns out to be
  wanted (as `routes/emailCenter.js` eventually did, see "Super admin and
  the Finance permission preset" below), so reaching for it isn't a
  one-way door. `requireSuperAdmin` is a third, still stricter sibling —
  same shape, but checks `role === 'super_admin'` specifically rather than
  `isAdminRole()`, so a plain `admin` fails it too; `routes/modReports.js`
  is its one caller.
- `routes/dataReset.js` (mounted at `/api/data-reset`, `requireAuth` +
  `requireAdmin`, its own `router.use()` chain independent of the
  `requirePermission`/module system entirely) — `POST /` bulk-deletes
  whichever tables the caller picks via a `categories` array (one or more
  of `clients`, `quotes`, `invoices`, `recurring`, `licenses`, `expenses`,
  `capital_contributions`, `owner_draws`, `products`, `activity`), rather
  than an all-or-nothing clear. A
  `CATEGORIES` map translates each picked key into the actual table(s) it
  touches (e.g. `invoices` → `invoice_items`, `payments`, `invoices`);
  `clients` is the one category that always pulls in more than its own
  table — `quotes`/`invoices`/`recurring_invoices`/`licenses` (and their
  items/payments) too, even if the caller only ticked "clients" — because
  `client_id` is a `NOT NULL REFERENCES clients(id)` column on all four
  (see `db/index.js`), so leaving them behind would silently orphan them:
  invisible to every list page's `INNER JOIN` against `clients`, but still
  sitting in the database forever. Every other category is safe to clear on
  its own. The
  request 400s with "Select at least one type of data to delete" if
  `categories` is missing or empty, or if it contains no recognized key.
  The selected categories' tables are deleted in one transaction (foreign
  key checks are briefly turned off for the transaction, then back on —
  see `db/index.js`'s `PRAGMA foreign_keys`) in a fixed `TABLE_ORDER` so
  children are always cleared before the parents they'd otherwise
  reference, and each cleared table's `AUTOINCREMENT` counter is reset so
  a fresh import starts numbering from 1 again. After the deletes, three
  defensive `UPDATE`s NULL out nullable, unenforced cross-references that
  carry no `REFERENCES` constraint at all (`invoices.quote_id`,
  `quotes.converted_invoice_id`, `invoices.recurring_invoice_id` — see
  `db/index.js`) whenever one side of a soft link was cleared without the
  other, so a surviving row never points at an id that no longer exists.
  `users`, `user_permissions`, and `business_settings` are never touched by
  this route at all, not even conditionally: login and branding must
  survive a reset. Requires `confirm: "DELETE"` in the body (checked
  server-side, independent of whatever confirmation UI the frontend adds)
  or the whole request 400s before touching anything. Logs one
  `activity_log` entry summarizing what was cleared — written *after* the
  delete (not before), so it survives even when `activity_log` was itself
  one of the cleared tables, becoming the first fresh entry for anyone
  auditing later. `pages/business/Import.jsx`'s `DangerZone` component
  (rendered only when `isAdmin` — `useAuth()`'s admin-tier check, see
  "Super admin and the Finance permission preset" below — re-checking the
  same condition the backend enforces rather than trusting a hidden
  button) is the only caller — a checkbox per category (`RESET_CATEGORIES`), with
  checking "Clients" auto-checking and disabling its four dependent
  categories client-side (mirroring the backend's forced cascade, with an
  "Included automatically with Clients." hint rather than letting someone
  uncheck a category the backend would clear anyway) — plus a
  type-to-confirm text input matching the literal word `DELETE` and a
  native `confirm()` as a second layer, both gating the button (which also
  requires at least one category checked, and shows the live selection
  count in its label) before `api.dataReset.run(confirm, categories,
  token)` is ever called.
- `routes/emailCenter.js` (mounted at `/api/email-center`, `requireAuth` +
  `requirePermission('email_center', 'view'|'manage')` per route — see
  "Super admin and the Finance permission preset" below for why this
  moved off the `requireAdmin` pattern `routes/dataReset.js` still uses,
  once `email_center` became a real `MODULES` entry) — the Email Center's
  API: `GET /templates` (calls
  `lib/emailTemplates.js`'s `getAllTemplates()`), `PUT /templates/:type`
  (400s if `subject`/`message` is missing/blank, or if `:type` isn't one of
  the 4 known types — `setTemplate()` throws on an unrecognized type, caught
  and turned into a 400 rather than a 500), `POST /templates/:type/reset`
  (calls `resetTemplate()`, same unknown-type handling), and `GET /log` — a
  paginated read of `email_log`, mirroring `routes/activity.js`'s
  `PAGE_SIZE`/`LIMIT ? OFFSET ?` pattern exactly (always paginated, 30/page,
  newest first) rather than the business list routes' opt-in `?page=`
  convention, since this is a chronological audit feed like activity log,
  not a pickable list. Each log entry gets a `type_label` computed from a
  `TYPE_LABELS` map local to this route file (the 4 editable types plus
  `overdue_reminder`, the one type with no template) — kept separate from
  `emailTemplates.js`'s own `TYPE_LABELS` since that one only covers the 4
  editable types and has no reason to know about the automated reminder.
- `routes/users.js` (mounted at `/api/users`, `requireAuth` +
  `requirePermission('users', 'view'|'manage')` per route) — the in-app
  admin user-management API: `GET /` (list), `GET /:id` (user +
  `getPermissions()`), `POST /` (create — name/email/password/role,
  optional `permissions` map applied via `setPermissions()`), `PUT /:id`
  (update name/email/role/active/permissions), `POST /:id/reset-password`
  (admin sets a new password directly, no current-password check), `DELETE
  /:id`, and `GET /meta/modules` (returns `MODULES`, for building the
  permissions checkbox grid client-side). `GET /` supports `?q=` (name or
  email) and `?page=` (see "Pagination convention" above). `ROLES` is
  `['admin', 'staff', 'super_admin']` — see "Super admin and the Finance
  permission preset" below for the admin-tier account controls layered on
  top of this route's plain `requirePermission('users', 'manage')` gate.
  Two families of safety guards prevent a click from locking everyone out:
  `activeAdminCount(excludingUserId)` counts **both** admin-tier roles
  together (`role IN ('admin', 'super_admin')`) — a business with zero
  plain `admin` accounts but at least one active `super_admin` isn't
  actually locked out of full business-data access, since `super_admin`
  already implies everything `admin` does — and blocks demoting/
  deactivating/deleting the last active admin-tier account (409);
  `activeSuperAdminCount(excludingUserId)` is a separate, narrower count
  (`role = 'super_admin'` only) with its own 409 guard in `PUT /:id`/
  `DELETE /:id`, since running out of super admins specifically really
  would be unrecoverable in-app (nobody left who can manage admin-tier
  accounts or promote anyone into either tier — the only way back would be
  the CLI bootstrap path in `scripts/create-user.js`, see below) even with
  plenty of plain admins still active. `DELETE /:id` also independently
  blocks deleting your own account (400, checked before either
  last-active guard). `publicUser()` here (separate from `routes/auth.js`'s)
  is the shape sent for user-management views:
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
  `reports.js` is the reverse case: every route in it is a read (a PDF
  download, never a mutation), so it applies `requirePermission('financials',
  'view')` once via `router.use()` rather than gating individual routes —
  and reuses the `financials` module rather than declaring its own, since
  these reports surface the same data at the same sensitivity level.

### Super admin and the Finance permission preset (`backend/src/`, `frontend/src/`)

Two related additions on top of the two-role system above: a `super_admin`
tier with exclusive control over admin-tier **accounts**, and a "Finance"
quick-select preset on the Users form for staff accounts that only need
money-related modules. Built together after an explicit ask for "a super
admin who can control everything" plus "another category like finance" —
clarified up front into a narrower, deliberately scoped shape rather than
the broadest possible reading of either: `super_admin` adds nothing to
what `admin` can already do with *business data* (both tiers already have
full, unrestricted access to every module, see `isAdminRole()` above) —
it only adds control over who else gets to be `admin`/`super_admin` in the
first place. And "Finance" isn't a fourth stored role at all — it's a
preset button that fills in a `staff` account's existing permission grid,
exactly as adjustable afterward as if an admin had ticked every box by
hand. Both choices trade a broader, more powerful (and more speculative)
feature for a narrower one that's fully reversible and easy to reason
about — see the "None — keep every rule as-is" decision below for the
same reasoning applied to this feature's third question.

- **What `super_admin` actually adds**: exclusive control over admin-tier
  *accounts* — creating one, editing one's name/email/role/active state/
  permissions, resetting one's password, deleting one, and promoting
  anyone (including staff) into either admin-tier role. A plain `admin`
  keeps everything it already had — full, unrestricted access to every
  business-data module, and full CRUD on `staff` accounts via the existing
  `users:manage` permission — but can no longer touch another admin's or
  super_admin's account, or its own admin-tier status. This is
  deliberately the *only* thing that changes: `super_admin` is not a
  bypass for any of this app's existing safety rules (a locked sent/paid
  invoice, a client with recorded quotes/invoices/licenses, a converted
  quote) — every one of those still applies unconditionally to every role,
  `super_admin` included. That was an explicit design question, answered
  "None — keep every rule as-is, even for me": broadening what *any* role
  can override would have been a much bigger, riskier change than the
  account-control feature actually asked for, and every one of those
  guards exists to prevent a specific, already-reasoned-through kind of
  data corruption (an invoice diverging from what was actually sent, an
  orphaned foreign key, a quote's numbers disagreeing with the invoice it
  already produced) that doesn't become safer just because a more trusted
  role clicked the button.
- `routes/users.js`'s `assertSuperAdminForAdminTier(req, res, ...roles)` is
  the enforcement point — called with every role value a request touches
  (the incoming `role` on `POST /`; both `existing.role` and `nextRole` on
  `PUT /:id`, so it catches promoting a `staff` account into an admin tier
  *and* editing an already-admin-tier account; just `existing.role` on
  `POST /:id/reset-password` and `DELETE /:id`) and 403s with "Only a
  super admin can manage admin accounts" the instant any of them is
  admin-tier and the caller isn't `super_admin` — checked via
  `roles.some(isAdminRole)`, so a request naming even one admin-tier role
  among several is blocked. This deliberately sits **on top of** the
  route's existing `requirePermission('users', 'manage')` gate rather than
  replacing it — a plain admin still needs (and, per this app's
  single-business model, already has) full `users` access to manage staff
  accounts; this second check narrows what that access can reach, the same
  layering `requireAdmin` already uses elsewhere (independent of, not a
  replacement for, the per-module grant system). Like `requireAdmin`, no
  staff `user_permissions` grant can ever unlock it — it reads
  `req.user.role` directly.
- **CLI bootstrap**: `scripts/create-user.js` (`npm run create-user`)
  gained a `--role` flag (`admin` | `super_admin`, default `admin` —
  unchanged from before this feature, so every existing invocation with no
  `--role` behaves exactly as it always did) since nobody can promote
  anyone into `super_admin` from inside the app until at least one
  `super_admin` account already exists — the classic bootstrap problem,
  solved the same way this script has always solved "how does the very
  first account get created at all": shell access to run it is already a
  higher trust level than anything the in-app permission system could
  restrict. For a **new** account, `--role` picks what gets created,
  same as it always implicitly did for the (always-admin) default. For an
  **existing** account, passing `--role` with a value that differs from
  the account's current role takes a distinct, separate path — it updates
  *only* `role`, touches no password, and returns immediately, before the
  script's usual "reset this account's password?" prompt ever gets a
  chance to ask anything (email is resolved before name for this reason
  too — a pure role change needs an email to find the account and nothing
  else, so it shouldn't have to prompt for a name it will never use). This
  is how a business owner would promote their own existing account to
  `super_admin` the first time this feature ships: `node
  scripts/create-user.js --email you@yourbusiness.com --role super_admin`
  against the real production database (never done by an AI agent working
  in a sandboxed environment with no production DB access — this is
  explicitly a step for whoever actually operates the server).
- **Frontend**: `frontend/src/context/AuthContext.jsx` exposes `isAdmin`
  (`isAdminRole(user?.role)` — true for either admin tier) and
  `isSuperAdmin` (`user?.role === 'super_admin'`) alongside the existing
  `can()`, so every component that used to write `user.role === 'admin'`
  reads one of these instead rather than re-deriving the rule — swept
  across `pages/business/Import.jsx` (the `DangerZone` gate) after
  `isAdminRole` was introduced, so it didn't regress to "admin-tier-blind"
  once a `super_admin` existed. `Sidebar.jsx`'s own admin-tier-style link
  filter and `EmailCenter.jsx`'s own page guard were both swept the same
  way at the time, but have since moved off `isAdmin` entirely as this
  section's own later notes describe — `Sidebar.jsx`'s filter now checks
  `isSuperAdmin` (MOD Report's `superAdminOnly`, the one remaining
  role-based link gate), and `EmailCenter.jsx` reads `can('email_center',
  ...)` like any other module. `frontend/src/lib/roles.js` holds the
  frontend's own `isAdminRole()` (mirroring the backend's) and
  `roleLabel(role)` — `'Administrator'` | `'Staff'` | `'Super Admin'` —
  used everywhere a role is *displayed* (`DashboardRail.jsx`'s profile
  card, `MyAccount.jsx`'s account-type line, `Users.jsx`'s role column)
  so a raw `super_admin` value never renders as the literal, underscored
  `"Super_admin"` the way a bare `capitalize` CSS class on `u.role` would.
- `pages/Users.jsx`'s Role `<select>` only renders the `Admin`/`Super
  Admin` `<option>`s when the viewer is `isSuperAdmin` — a plain admin
  sees only `Staff`, since selecting either other option would just 403 on
  submit (same "never show a control that would just error" convention
  this app already follows everywhere else — `Licenses.jsx`'s Renew/Remind
  guards, `QuoteDetail.jsx`'s locked-status buttons). The per-row Edit/
  Reset password/Delete `IconActionButton`s are similarly gated —
  `canManage && (isSuperAdmin || !isAdminRole(u.role))` — so a plain
  admin viewing the list sees a staff row's usual three actions but an
  admin-tier row's action cell renders empty rather than a set of buttons
  that would each just 403. The page's own intro copy states the rule
  directly ("only a super admin can create, edit, or remove another admin
  or super admin account") rather than leaving it to be inferred from
  missing buttons.
- **The Finance preset**: a "Finance" button next to the "Module
  permissions" heading, shown only while `form.role === 'staff'` (an
  admin-tier account has no permissions grid to preset — it bypasses
  `user_permissions` entirely). `FINANCE_MODULES` is `['invoices',
  'expenses', 'financials']` — deliberately not a fourth stored role, a
  new `MODULES` entry, or a `users.role` value: it's a one-click way to
  zero every module then grant `{can_view: true, can_manage: true}` on
  just those three, using the exact same `setPermissionsState`/
  `togglePermission` state the checkbox grid already manages, so every box
  it sets is exactly as freely re-toggleable afterward as if an admin had
  clicked each one by hand — there is no separate "Finance mode" the
  account is locked into. Deliberately just these three modules, not
  every module that touches money in some way: `expenses` already covers
  capital contributions and owner draws (`routes/capitalContributions.js`/
  `routes/ownerDraws.js` both reuse the `expenses` permission rather than
  declaring their own, see "Business module" above), and `reports.js`
  reuses `financials` for the same reason — so `invoices` + `expenses` +
  `financials` together already reach every dedicated money-movement
  screen and PDF report in the app, without also handing out `clients`/
  `quotes`/`products`/`licenses`/etc., which a finance-focused hire
  typically has no reason to edit. `quotes` is deliberately excluded even
  though it precedes an invoice — a quote has no money changing hands yet,
  so it reads as sales/CRM territory rather than finance.

**Two follow-up changes, made once `super_admin` existed**: tightening MOD
Report down to super-admin-exclusive (previously any admin-tier account
could reach it, the same as every other `requireAdmin`-gated feature), and
opening Email Center up to the granular permission system for the first
time (previously admin-tier-only with no way to grant it to staff at all —
see that route's own original note, which explicitly left this as "a
deliberate future call, not an oversight"). These land in opposite
directions — one *narrower* than the app's existing admin-tier bypass, one
*added* to the module-grant system that bypass has always sat on top of —
which is worth stating plainly since both touch admin-tier-only features
in the same pass.

- **MOD Report → super-admin-exclusive**: `middleware/auth.js` gained
  `requireSuperAdmin`, a still-stricter sibling of `requireAdmin` — same
  shape (bypasses `user_permissions` entirely, reads `req.user.role`
  directly, no staff grant can ever unlock it), but checks
  `role === 'super_admin'` specifically rather than `isAdminRole()`, so a
  plain `admin` account fails it too. `routes/modReports.js`'s
  `router.use(requireAdmin)` became `router.use(requireSuperAdmin)` — the
  only change the route needed, since every handler in that file already
  just reads `req.user` for attribution (`submitted_by_name`, etc.) and
  never branched on role itself. This makes MOD Report the one feature in
  the app that a plain `admin` cannot reach at all, by design — it was
  never business data the per-module grant system was built to gate (a
  resort operations checklist, unrelated to billing/CRM), so tightening it
  further didn't call for a new `MODULES` entry, just a stricter version of
  the same bypass-based gate it already used. `frontend/src/components/
  Navbar.jsx`'s `BUSINESS_LINKS` entry for `/mod-reports` swapped
  `adminOnly: true` for `superAdminOnly: true` (the last remaining use of
  `adminOnly` was Email Center, below, so the flag itself was renamed
  rather than left as a dead alternative alongside the new one) —
  `components/Sidebar.jsx`'s link filter reads
  `!link.superAdminOnly || isSuperAdmin` now, not `isAdmin`.
  `pages/business/MODReport.jsx`'s three effects and its own
  "You don't have permission" render guard all check `isSuperAdmin` from
  `useAuth()` (previously a literal `user?.role !== 'admin'` comparison —
  worth noting this was actually a pre-existing bug once `super_admin` was
  introduced: a literal `!== 'admin'` check reads `true`, i.e. "blocked,"
  for `role: 'super_admin'` too, so between the two features shipping a
  super admin had briefly and unintentionally lost access to this page
  entirely, the opposite of every other admin-tier check in the app. Fixed
  as part of this same change, not a separate patch, since the fix and the
  new intended behavior are the same line).
- **Email Center → a real, grantable module**: `email_center` joins
  `lib/permissions.js`'s `MODULES` list — `routes/emailCenter.js`'s
  `router.use(requireAdmin)` became per-route `requirePermission
  ('email_center', 'view'|'manage')` (`view` on `GET /templates`/`GET
  /log`, `manage` on `PUT /templates/:type`/`POST /templates/:type/
  reset`), the exact move that route's own original comment already
  flagged as a "one-line change... not a reason to add that plumbing
  speculatively now" — this is that later, deliberate call. **Both admin
  tiers keep exactly the access they already had** — `hasPermission()`'s
  admin-tier bypass applies to every module including this new one, so an
  `admin`/`super_admin` account's own access to Email Center is unchanged
  by this — the actual effect is additive: a `staff` account can now be
  individually granted `email_center` view/manage via the Users page's
  permissions grid, which was previously impossible no matter what. The
  frontend mirrors this exactly: `Navbar.jsx`'s `/email-center` entry
  dropped `adminOnly`/`module: null` for a plain `module: 'email_center'`,
  so it's now filtered by `can('email_center', 'view')` the same as every
  other business link — no special-casing left. `pages/EmailCenter.jsx`
  reads `canView`/`canManage` from `can('email_center', 'view'|'manage')`
  instead of the old blanket `isAdmin` — `canView` gates the page the same
  way every other business page's `if (!can(module, 'view')) return
  <...not authorized...>` guard does, and `canManage` is new: a
  view-only-granted staff member now sees every template's current
  subject/message (read-only inputs, muted `bg-slate-50` styling — same
  convention `EmailPreviewModal.jsx`'s own read-only `To` field already
  uses) and the sent log, but the Save/Reset button row is hidden
  entirely per template card, same "never show a control that would just
  403" convention as everywhere else in this app. The page's own intro
  copy dropped "Admin-only for now" (no longer true) for two variants
  keyed on `canManage`, so a view-only visitor doesn't see instructions
  for actions they can't take.

### Restricted admins, admin-tier audit trail, change alerts, and session visibility (`backend/src/`, `frontend/src/`)

A follow-up batch of four related asks, all extending the super admin/admin
relationship above rather than the staff-facing permission system: letting
a super admin restrict a *specific* admin's business-data access the same
way staff access is already controlled (closing the one part of the
original "supper admin can... limit access to users like admin and staff"
request that the initial super-admin feature deliberately left
out-of-scope, see that section's own "None — keep every rule as-is"
decision — this is a different question from overriding a business-safety
rule, and is now addressed on its own), a more visible record of who
changed what about an admin-tier account, an opt-in email the moment a
new admin-tier account appears, and a self-service "which devices am I
logged in on" list. Built together since the first three all touch
`routes/users.js` in the same handlers.

- **Restricted admins**: `users.restricted` (`ALTER TABLE`-guarded, same
  pattern as every other post-launch `users` column — see `db/index.js`
  above) is only ever meaningful for a plain `admin` account —
  `lib/permissions.js`'s `isUnrestrictedAdmin(user)` is the actual bypass
  check `hasPermission()`/`effectivePermissions()` now use in place of the
  broader `isAdminRole()`: `true` for `super_admin` unconditionally (the
  one tier that can never be locked out of managing admin accounts, so
  `routes/users.js` refuses to store `restricted` as anything but `0` for
  it — same refusal for `staff`, which is already permission-gated with
  nothing to toggle), and for `admin` only when `restricted` is falsy. A
  restricted admin is gated by real `user_permissions` grants exactly like
  `staff` — default-deny until a super admin explicitly checks boxes for
  them on the same Users page grid staff already use — but keeps every
  other admin-tier *account* protection unchanged: still only a super
  admin can edit/delete/reset its password/promote it further (still
  passes `isAdminRole()` for `assertSuperAdminForAdminTier`'s purposes),
  and it still counts toward `activeAdminCount`'s last-active-admin guard
  — restricting business-data access and controlling the account itself
  are deliberately separate questions, matching the original super-admin
  feature's own "keep every rule as-is" framing applied to this new
  capability too. `middleware/auth.js`'s `requireAdmin` was updated to
  the same `isUnrestrictedAdmin()` check (was `isAdminRole()`) — this is
  what makes the restriction actually reach `routes/dataReset.js`'s Danger
  Zone too, not just the per-module grants, since that's the one other
  place in the app an admin-tier account bypasses a whole system rather
  than going through `requirePermission`. `routes/users.js`'s
  `sanitizeRestricted(role, restricted)` is what enforces the "only ever
  `admin`" rule at write time, independent of whatever
  `assertSuperAdminForAdminTier` already blocks a plain admin from
  reaching. Frontend: `AuthContext.jsx`'s `isUnrestrictedAdmin` mirrors the
  backend check (`isSuperAdmin || (isAdmin && !user?.restricted)`) —
  `Import.jsx`'s `DangerZone` gate reads this instead of the plain
  `isAdmin` it used before, so a restricted admin never sees a button that
  would now 403. `pages/Users.jsx`'s edit form gains a "Restrict module
  access" checkbox, shown only when `isSuperAdmin && form.role ===
  'admin'` (the Role select already only offers "Admin" to a super admin
  viewer, so reaching this at all already implies the viewer can act on
  it) — checking it reveals the *same* permissions grid `form.role ===
  'staff'` already shows (the condition became `form.role === 'staff' ||
  (form.role === 'admin' && form.restricted)`), pre-filled from whatever
  `user_permissions` rows already exist for that account (all-false for
  an admin who's never been restricted before, since they never needed
  real rows). A restricted admin's row gets a small amber "Restricted"
  badge next to its role in both the desktop table and mobile accordion
  (`u.restricted`), same "only show the exception case" convention this
  app already follows elsewhere.
- **Admin-tier audit trail**: on top of the generic `'created'`/
  `'updated'`/`'deleted'`/`'reset password for'` entries every account
  mutation already gets, `routes/users.js` now writes a second, distinct
  `activity_log` entry whenever something *admin-tier-specific* happens —
  same "structured change tracking layered on the generic entry"
  convention `routes/licenses.js`'s own cancelled/reactivated/billing-
  cycle transitions already established. Covers: `'created admin-tier
  account'` (`POST /` when the new role is `admin`/`super_admin`),
  `'promoted to admin-tier account'` / `'demoted from admin-tier
  account'` (`PUT /:id` when role crosses the staff/admin-tier boundary
  in either direction), `'promoted to super admin'` / `'demoted to
  admin'` (`PUT /:id` when role moves *between* the two admin tiers —
  logged, but doesn't fire the alert email below, since no new admin-tier
  account appeared), `'restricted admin account'` / `'removed restriction
  from admin account'` (`PUT /:id` when the new capability above is
  toggled), `'reset password for admin-tier account'` (`POST
  /:id/reset-password`), and `'deleted admin-tier account'` (`DELETE
  /:id`) — each carries the role in its `entity_label` so the feed reads
  specifically (e.g. `Future Admin (admin)`) rather than generically.
- **Change alert email**: `lib/adminChangeNotify.js`'s
  `notifyOfAdminTierChange({ user, actorId, actorName, wasNew })` — same
  shape as `lib/quoteAcceptedNotify.js`'s own staff digest (an internal
  notification, not a client-facing send, so it deliberately skips
  `lib/emailTemplates.js`'s editable-template system and `email_log`, same
  reasoning that file's own top-of-file note documents), called — never
  awaited, just fired with a `.catch()` — from `routes/users.js`'s `POST
  /` and `PUT /:id`, only when the account either starts out admin-tier
  (a brand-new admin/super_admin account) or is freshly promoted into the
  tier from `staff`. Recipients are every active `super_admin` with the
  new `notify_admin_changes` preference on, excluding the actor
  themselves (notifying the person who just made the change would be
  noise). `notify_admin_changes` (`ALTER TABLE`-guarded on `users`, same
  pattern as `notify_overdue` etc.) is wired through the existing `PUT
  /api/auth/preferences` route alongside the other four opt-ins — stored
  on every account the same way, though only ever meaningful for a
  `super_admin`, so `MyAccount.jsx`'s Notifications card renders that
  fifth checkbox only when `isSuperAdmin` (a plain admin/staff would just
  be toggling something with no effect).
- **Session/device visibility**: a `sessions` table (brand new, plain
  `CREATE TABLE IF NOT EXISTS` — see `db/index.js` above), one row per
  issued staff JWT, lets an account see "which devices am I logged in on"
  and revoke one without changing its password (which would end *every*
  session at once via the existing `password_changed_at` check, not just
  the one that's lost/stolen). `lib/sessions.js`'s `createSession(userId,
  req)` mints a random `jti`, stores it with the request's `user-agent`/
  IP, and returns it; `routes/auth.js`'s `signToken(user, jti)` embeds
  that `jti` in the JWT payload when given one. `POST /login` always
  creates a fresh session; `POST /change-password` reuses `req.sessionJti`
  (set by `requireAuth` below) instead of minting a new row, since
  refreshing a token after a password change is still the same device/
  session, not a new one — re-signing with the same `jti` keeps it reading
  as one entry rather than a duplicate. `middleware/auth.js`'s
  `requireAuth` checks a token's `jti` against `getActiveSession()` on
  every request (rejecting with "This session has been signed out" if
  revoked) and touches `last_seen_at` — but **only when a `jti` is present
  at all**: a token minted before this feature shipped carries no `jti`
  claim and is deliberately let through unchecked, exactly as it always
  was, so deploying this never mass-logs-out every already-signed-in
  session; only a fresh login (or a `change-password` refresh) after the
  deploy starts a token down the trackable/revocable path. `GET
  /api/auth/sessions` (self-service only — no admin-facing "see someone
  else's devices" view, a meaningfully bigger surveillance feature nobody
  asked for) lists the caller's own non-revoked sessions with an
  `isCurrent` flag; `DELETE /api/auth/sessions/:id` revokes one, blocked
  (400) for the caller's own current session — "log out" is what that's
  for, not this. `pages/MyAccount.jsx` gains an "Active sessions" card
  (user-agent, relative last-active time via a small local `timeAgoShort`
  — session activity is usually minutes/hours old, unlike `lib/date.js`'s
  `timeAgo()`, which is tuned for days/weeks-old dates elsewhere in this
  app) with a "This device" badge on the current row and a "Sign out"
  button on every other row, behind the same `useConfirm()` dialog every
  other destructive action in this app already uses. The user-agent text
  and the "This device" badge sit in their own flex row (`min-w-0
  flex-1` text + `shrink-0` badge) rather than one `truncate`d block —
  a long user-agent string truncating the *whole* line would silently
  swallow the badge along with it, caught visually in testing before this
  shipped.

### MOD Report public submission link (`backend/src/`, `frontend/src/`)

A shareable, no-login URL a super admin can generate so a MOD report can be
*submitted* — e.g. from a shared tablet at reception — without needing a
staff account. Deliberately the mirror image of `routes/public.js`'s own
quote/invoice links: those are read(+respond) links to one already-existing
document; this is a write-only link to *create* a new `mod_reports` row,
with no way to read any report back, past or present — MOD Report is the
one feature in this app locked down tighter than anything else (see
"Restricted admins..." above — not even a plain `admin` can see it), so a
public link exposing that same sensitive operational detail (guest names,
security/CCTV notes, staff housing, issue photos) was never on the table;
only the ability to add to it was.

- **Shared validation, not duplicated**: `SECTIONS`/`VILLA_ITEMS` (the
  checklist's own fixed shape) and the sanitize/validate helpers
  (`sanitizeIssues`/`sanitizeVillas`/`sanitizeGuests`/`validate`/`tally`/
  `reportTally`) used to live only in `routes/modReports.js`; both now live
  in `lib/modReportShared.js`, required by both that file and
  `routes/public.js`. This is deliberate, not just tidying — it's what
  guarantees the unauthenticated public submission path can never validate
  or sanitize a submission more loosely than the authenticated one does,
  since there's only one copy of that logic for either caller to drift
  from.
- **The link identifies the form, not a report**: unlike quotes/invoices
  (a `public_token` column per row), there's no report yet when this link
  is generated, so it's a single `submission_token` on the existing
  single-row `mod_report_settings` table (`ALTER TABLE`-guarded — that
  table already carries its one real row from whenever MOD Report first
  shipped, same lesson `licenses.url` learned the hard way, see
  `db/index.js` above) — one link per business, not one per report. No
  `UNIQUE` constraint the way `public_token` has (SQLite's `ALTER TABLE
  ADD COLUMN` can't add one anyway) — moot on a single-row table, since
  there's nothing else it could collide with.
- `routes/modReports.js`'s `POST /settings/regenerate-token`
  (`crypto.randomBytes(16).toString('hex')`, same scheme quotes/invoices
  use for `public_token`) is simultaneously "generate the first link" and
  "rotate it if it's leaked" — regenerating always works whether a token
  already exists or not, one action either way. `DELETE /settings/token`
  is the other half of the lifecycle — clears it back to `NULL`, turning
  public submission off entirely (the old link 404s) without generating a
  replacement, for a business that wants to pause the feature rather than
  rotate it. Both `requireSuperAdmin`-gated like every other route in this
  file, and both log a structured `activity_log` entry.
- `routes/public.js` gains `GET /mod-reports/:token/meta` (validates the
  token against `mod_report_settings.submission_token`, 404s on a mismatch
  or a `NULL` token — i.e. the feature not yet enabled/since disabled —
  returns `{ sections, villaItems, businessName, logoImage }`, the same
  checklist structure `routes/modReports.js`'s own authenticated `GET
  /meta` serves, plus the branding needed to show *which* business's form
  this is) and `POST /mod-reports/:token` (same token check, then the
  identical validate → sanitize → insert sequence the authenticated `POST
  /` uses, just with `submitted_by_user_id: NULL` — there's no logged-in
  staff user behind a public submission — and `submitted_by_name` set to
  the MOD's own name, `mod_name`, which is exactly what that column
  already means on an authenticated submission too). Response is a bare
  `{ ok: true }` — a public submitter has no further access to the record
  they just created (no `GET` route exists to read it back by token), so
  there's nothing to return beyond confirmation it saved.
  `middleware/rateLimit.js`'s new `modReportSubmitLimiter` (30/hour) guards
  the `POST` only — unlike the read-only quote/invoice links, this one
  writes a new row on every accepted request, so a leaked or guessed link
  could otherwise flood the table with junk submissions; `GET .../meta` is
  unlimited, matching every other public-token `GET` in this app (the
  128-bit token itself is what actually blocks brute-forcing, the same
  trust level quotes/invoices already rely on with zero rate limiting).
- **Frontend reuses the real create form, not a copy of it**:
  `pages/business/MODReport.jsx` exports its own `ChecklistForm` (purely
  presentational — no `api.*` calls or auth dependency, which is exactly
  what makes this safe to reuse) and `newDraft`, both now imported by the
  new `pages/PublicMODReport.jsx`. This means the authenticated "New
  checklist" tab and the public submission page can never drift apart in
  shape — every field, every villa/guest-interaction/issue row, comes from
  the same component either way. `PublicMODReport.jsx` (route
  `/mod/:token`, public — outside `ProtectedRoute`, never touching
  `AuthContext`/`localStorage`, same as `PublicQuote.jsx`/`PublicInvoice.jsx`)
  fetches `GET /public/mod-reports/:token/meta` on mount, renders
  `ChecklistForm` with `editingId` always `null` (a public link only ever
  creates), and on submit calls `POST /public/mod-reports/:token` — success
  swaps the form for a "Checklist submitted" confirmation with a "Submit
  another checklist" button, matching the shared-kiosk use case (several
  submissions across one shift from the same open tab) rather than
  dead-ending after one. `Navbar.jsx`'s `isPublicDocLink` check (hides the
  "Log in" button on `/q/`/`/i/` for the same reason) now also covers
  `/mod/` — whoever's filling this out from a shared link has no staff
  account either.
- **Settings tab, `PublicLinkCard`**: a new card on `MODReport.jsx`'s
  existing "Settings" tab, right below the branding form — shows the
  current link (built from `window.location.origin`, same "trust the
  browser's own origin over the backend's `CLIENT_ORIGIN`" convention
  `QuoteDetail.jsx`'s/`InvoiceDetail.jsx`'s own "Copy public link" buttons
  already establish) with Copy/Regenerate/Remove actions when a token
  exists, or a single "Generate public link" button when one doesn't.
  Regenerate and Remove both go through the page's existing shared
  `useConfirm()` dialog — regenerating immediately invalidates the old
  link, so that's worth a pause the same way any other "this breaks what
  was there before" action in this app already is.

### Client portal (`backend/src/`, `frontend/src/`)

A self-serve login for clients, separate from staff auth entirely — a
client authenticates as their own account rather than through a
per-document `public_token` link (see `routes/public.js` above). Built in
four phases, all now shipped: phase 1 (schema + auth), phase 2 (the
admin-facing invite flow), phase 3 (the portal's own frontend shell —
login/accept-invite/forgot/reset-password pages, a protected-route
wrapper, and a layout distinct from the staff app's), and phase 4
(read-only views of the client's own quotes/invoices/licenses, plus quote
accept/decline).

- `client_portal_accounts` (in `db/index.js`, added fresh — no
  production data existed yet, so this is a plain `CREATE TABLE IF NOT
  EXISTS` edit, not an `ALTER TABLE` migration; see that file's own note
  on when each approach applies) is a **separate table from `clients`**,
  not columns bolted onto it — this is an auth concern, not business data
  (the same reasoning `user_permissions` is split from `users`), and
  `clients.email` is neither required nor unique today, so a login
  identity needs its own constrained column. `client_id INTEGER NOT NULL
  UNIQUE REFERENCES clients(id) ON DELETE CASCADE` — one row per client,
  since a portal account represents the organization's single login, not
  a per-person account, matching how `clients` itself always means the
  organization rather than an individual (see "Business module" above).
  `email` is `NOT NULL UNIQUE` (unlike `clients.email`) since it's the
  actual login identity. `password_hash` stays `NULL` until the client
  accepts their invite and sets a password (see below) — a row can exist
  in an "invited but not yet activated" state. `invite_token`/
  `invite_token_expires` and `reset_token`/`reset_token_expires` mirror
  `users`' own reset-token columns exactly, just doubled up for the two
  separate token purposes this table needs (an initial invite is
  conceptually different from a later self-serve reset, even though both
  are "set a password via a time-limited emailed link"). `active`
  defaults to `1` and gates login the same way `users.active` does.
  `password_changed_at TEXT NOT NULL DEFAULT (datetime('now'))` is the
  same token-invalidation timestamp `users` has (see below).
- `middleware/clientAuth.js`'s `requireClientAuth` is the client-portal
  counterpart to `middleware/auth.js`'s `requireAuth` — same shape
  (re-fetch the live row on every request rather than trusting the JWT,
  reject on `active = 0`, reject a token issued before
  `password_changed_at` so a stolen pre-reset token can't keep working for
  the rest of its 7-day life), but keyed to `client_portal_accounts`
  instead of `users`. **Staff and client-portal tokens are signed with the
  same `JWT_SECRET`**, so a valid signature alone doesn't prove which kind
  of token it is — a client token's `id` is a `client_portal_accounts` row
  id, which could coincidentally match a real staff user's id in `users`.
  Every token carries a `type: 'client'` claim precisely so the two
  systems can tell each other's tokens apart despite the shared secret:
  `requireClientAuth` rejects any token where `payload.type !== 'client'`,
  and `requireAuth` (in `middleware/auth.js`) was updated to reject any
  token where `payload.type === 'client'`, immediately after signature
  verification and before it ever reaches the `users` lookup — this is a
  deliberately symmetric, bidirectional check, not something bolted onto
  one side only. Without it, a client-portal JWT with a numerically
  colliding `id` could otherwise have authenticated as a staff user via
  `requireAuth`'s plain `SELECT ... FROM users WHERE id = ?`. Staff tokens
  themselves carry no explicit `type` claim (unchanged, to avoid touching
  every existing staff token's shape) — `requireAuth`'s check is simply
  "reject if this is a client token," not "require a staff type."
- `routes/clientPortal.js`, mounted at `/api/portal` (in `index.js`, right
  after `/api/public` — both are the app's non-staff-auth route groups).
  `signClientToken()`/`publicAccount()` mirror `routes/auth.js`'s own
  `signToken()`/`publicUser()` pattern — `publicAccount()` is the one
  place that shapes what a portal account is ever sent to the client
  (`id`, `clientId`, `clientName`, `email` — never `password_hash` or any
  token column), same reasoning as `publicUser()`. **There is no signup
  route here either**, same reasoning as `routes/auth.js`'s own "no
  signup" — a portal account is only ever created by an admin inviting an
  existing client, never by someone showing up with an email; that invite
  endpoint is `routes/clients.js`'s `POST /:id/portal-invite` (see "Admin
  invite flow" below). `POST /login`
  (rate-limited via `portalLoginLimiter`) checks `email` case-insensitively
  (lowercased before the query, since `client_portal_accounts.email` is
  stored as given), returns a generic "Invalid email or password" for both
  a nonexistent account and a wrong password (matching `routes/auth.js`'s
  own login), but has one extra state `users` never has: a row with
  `password_hash IS NULL` (invited, never activated) gets its own distinct
  message — "This account has not been activated yet. Check your email for
  an invite link." — checked *before* the password comparison, since
  there's no hash to compare against yet. The `active = 0` check runs
  *after* the password check (matching `routes/auth.js`'s own
  `active`-after-credentials ordering), so a correct password on a
  deactivated account gets the specific "This account has been
  deactivated" message rather than a generic credentials error.
  `POST /accept-invite` (rate-limited via `portalAcceptInviteLimiter`) is
  the "set your password for the first time" endpoint a client's invite
  email links to — validates the token exists and `invite_token_expires`
  hasn't passed, requires an 8+ char password (`MIN_PASSWORD_LENGTH`, same
  threshold `routes/auth.js` uses), hashes it, and clears both invite-token
  columns (single-use, same as `users`' reset flow) while stamping
  `password_changed_at`. `POST /forgot-password`/`POST /reset-password`
  (rate-limited via `portalForgotPasswordLimiter`/
  `portalResetPasswordLimiter`) are a straight mirror of
  `routes/auth.js`'s own pair — same generic
  always-the-same-response-either-way message (prevents account
  enumeration), same 1-hour `RESET_TOKEN_TTL_MS`, same
  clear-token-and-stamp-`password_changed_at` on success. `GET /me`
  (`requireClientAuth`-gated) returns the current account via
  `publicAccount()` — the portal's equivalent of `GET /api/auth/me`. `GET
  /settings` (also `requireClientAuth`-gated) returns the same stripped
  `publicSettings()` shape `routes/public.js` sends alongside a quote/
  invoice — added so the portal frontend can show a currency symbol/
  business name on its dashboard and list pages without a full quote/
  invoice fetch just to reach its embedded `settings` (see
  `PortalAuthContext.jsx` below, which fetches this once and shares it
  across every portal page).
- `middleware/rateLimit.js` gained four portal-specific limiter instances
  — `portalLoginLimiter` (10/15min), `portalForgotPasswordLimiter`
  (5/hour), `portalResetPasswordLimiter` (10/hour), and
  `portalAcceptInviteLimiter` (10/hour) — deliberately separate instances
  from the existing staff `loginLimiter`/`forgotPasswordLimiter`/
  `resetPasswordLimiter` even though the numbers are identical, so a
  burst of staff login attempts and a burst of client portal login
  attempts don't share (and potentially exhaust) the same bucket for an
  unrelated user population.
- **Admin invite flow** (phase 2): `routes/clients.js` gains
  `GET /:id/portal-invite-preview` and `POST /:id/portal-invite` (both
  `manage`-gated, same as every other mutation on this router), plus a
  computed `portal_status` field (`'none' | 'invited' | 'active' |
  'deactivated'`, derived from the client's `client_portal_accounts` row
  the same don't-store-what-you-can-compute way `invoices.js`'s
  `withComputed()` derives `is_overdue`) added to both `GET /` (via a
  `LEFT JOIN client_portal_accounts` — cheap at this app's single-business
  scale, so no second round-trip is needed just to know whether to show
  Invite/Resend/nothing per row) and `GET /:id`. `assertInviteEligible()`
  is the shared guard — 400 if the client has no email on file (a portal
  account's login identity is always the client's own `clients.email`;
  there's no per-invite email override), 409 if a `client_portal_accounts`
  row already exists *and* has a `password_hash` set (an active account
  needs no new invite; reactivating a deactivated one is a later phase) —
  called by both the read-only preview route and `ensurePortalInvite()`
  (the POST route's version, which also re-checks the invite's target
  email isn't already claimed by a *different* client's portal account,
  and actually writes the row) so preview and send can never disagree on
  whether an invite is allowed. Follows the exact "Email preview before
  sending" contract every other client-facing send in this app follows
  (see above) — with one necessary difference: unlike quote/invoice/
  license sends, there's no pre-existing token to preview against on a
  client's very first invite, so the preview route never persists
  anything (matching every other `*-preview` route in the app staying
  read-only) — it shows the client's *real* invite token only when an
  unactivated invite already exists to resend, and a placeholder
  otherwise; the POST route is what actually generates and persists the
  real token that gets emailed. A fresh invite (`ensurePortalInvite()`)
  either creates the `client_portal_accounts` row (email = the client's
  own) or, when a still-unactivated one exists, refreshes its token/
  expiry and re-syncs its email to the client's current one (in case it
  changed since an earlier, never-accepted invite) — either way stamping a
  7-day `invite_token_expires` (`INVITE_TOKEN_TTL_MS`), deliberately more
  generous than `routes/clientPortal.js`'s own 1-hour self-serve reset
  window: a first-time setup link has no "prove you still control this
  inbox right now" urgency a reset link does, so there's no security
  reason to rush the client. `lib/emailTemplates.js` gained a 6th editable
  type, `portal_invite` (`DEFAULT_TEMPLATES`/`PLACEHOLDERS`/`TYPE_LABELS`,
  same as every other type — see "Email preview before sending" above)
  and its own `portalInviteEmail({ client, settings, portalUrl })`
  function, called by both the preview and send routes so the templated
  text can never drift between them; `routes/emailCenter.js`'s own
  separate `TYPE_LABELS` (used for the sent log, not the template editor)
  got the matching entry too. `Clients.jsx`'s row actions gained a
  `SendIcon` "Invite to portal"/"Resend portal invite" button (label
  switches on `portal_status`), shown only when `portal_status` is
  `'none'` or `'invited'` — an `'active'` row has nothing to invite, and
  reactivating a `'deactivated'` one isn't built yet — wired to the same
  `EmailPreviewModal` pattern `Quotes.jsx`/`Invoices.jsx` use for their own
  single-send-type row action. A small `PortalBadge` (amber "Invited",
  emerald "Portal active", slate "Portal deactivated"; nothing rendered
  for `'none'`, the common case) sits next to the client's email in both
  the desktop table cell and the mobile `MobileListAccordion` summary, so
  the state is visible without opening anything.
- **Read views** (phase 4): `routes/clientPortal.js` gains `GET
  /quotes`/`GET /quotes/:id`/`POST /quotes/:id/respond`/`GET
  /quotes/:id/pdf` and the invoice/license equivalents, all
  `requireClientAuth`-gated. **Every query is scoped to
  `req.clientAccount.client_id`** — `getClientQuote()`/`getClientInvoice()`
  both filter `WHERE id = ? AND client_id = ?`, so a client can never read
  (or `respond` to) another client's document by guessing an id; a mismatch
  404s exactly like a nonexistent id would, not a 403, so no information
  about whether the id belongs to *someone* leaks either way. None of these
  lists take `?page=`/`?q=` — unlike the staff-side global lists, a single
  client's own document set is inherently small, so pagination isn't
  needed yet (see routes/reports.js's own "don't build it until needed"
  precedent). `withComputedInvoice()`/`withComputedLicense()` are this
  router's own copies of `routes/invoices.js`'s/`routes/licenses.js`'s
  identically-named functions — kept duplicated rather than imported, same
  reasoning `EXPIRY_WARNING_DAYS` is duplicated between `routes/
  licenses.js` and `lib/scheduler.js` (a different call site, its own
  client-scoped row shape). `POST /quotes/:id/respond` is the portal's
  version of `routes/public.js`'s own `POST /quotes/:token/respond` —
  identical accept/decline contract (only while `draft`/`sent`, stamps
  `client_response`/`client_responded_at`, logs an activity entry with the
  `"(client)"` action suffix) — a client can respond to a quote either way,
  through the portal now or the original emailed public link, and both
  paths converge on the exact same stored state. `GET /invoices/:id`
  additionally returns `payments` (`routes/public.js`'s own invoice view
  doesn't, since a one-off document link has no ongoing account
  relationship to show payment history against) and `GET
  /invoices/:id/payments/:paymentId/pdf` streams that payment's receipt —
  the portal's counterpart to `routes/invoices.js`'s own
  `GET /:id/payments/:paymentId/pdf`. Licenses are list-only for now (`GET
  /licenses`, no detail/renewal-history route) — enough for a client to see
  what's active/expiring/expired at a glance; a per-license detail view
  (mirroring the staff-side `GET /:id/renewals`) can be added the same way
  if that turns out to be wanted.
- **Portal frontend** (phase 3), `frontend/src/`: a fully self-contained
  sub-app under `/portal/*`, deliberately independent of the staff app's
  `AuthContext`/`Navbar`/`ProtectedRoute` — a client account has no
  modules, permissions, or business-management links, so reusing any of
  those would be both wrong (a client isn't a staff user) and broken (they
  all assume a staff `user`/`permissions` shape a portal account doesn't
  have). `context/PortalAuthContext.jsx` mirrors `AuthContext.jsx`'s exact
  shape (persist a bearer token under its own `localStorage` key,
  `edusolution_portal_token` — never `edusolution_token`, so a client
  session can never accidentally read or overwrite a staff session's own
  token, or vice versa — validate it against `GET /portal/me` on load,
  expose `login`/`logout`) but also fetches `GET /portal/settings` alongside the
  account (on both the initial load effect and right after `login()`) and
  exposes it as `settings`, so every portal page can show a currency
  symbol/business name from one shared fetch rather than each page
  re-fetching it. `components/PortalProtectedRoute.jsx` mirrors
  `ProtectedRoute.jsx` exactly, just reading `PortalAuthContext` and
  redirecting to `/portal/login` instead of `/login`.
- **Staff and portal sessions are mutually exclusive in the same
  browser.** Separate `localStorage` keys mean neither auth check can ever
  *read* the other's token (see `middleware/clientAuth.js`'s `type:
  'client'` discriminator above), but that alone still let both tokens sit
  in `localStorage` at once — e.g. an admin who was also testing the
  portal in the same browser, or a shared/kiosk machine nobody logged out
  of. In that state, someone on the portal who simply changed the URL to
  the main app (`/dashboard`, `/clients`, etc.) would land in it —
  `ProtectedRoute` only ever checks whether *a* staff token exists, with
  no awareness that the person got there via a portal login rather than
  a staff one; the access was really coming from the untouched staff
  session sitting alongside it, not anything the portal login itself
  granted, but it read exactly like the portal login had granted it. Both
  `AuthContext.jsx`'s and `PortalAuthContext.jsx`'s `login()` now clear
  the *other* context's token key before storing their own, so logging in
  as one identity always ends any lingering session for the other in that
  browser rather than merely not starting a new one; the same clear also
  happens in each context's bootstrap `/me` effect once that session is
  confirmed genuinely valid (not just at `login()` time), so a dual
  session that already existed before this fix shipped — or one created
  by any other means — gets torn down the next time either app is
  actually used, without needing a fresh login to trigger it. A real
  client only ever holds a portal token to begin with, so this is mostly
  a hardening measure against the coexistence case above rather than
  something a normal single-identity user would ever notice.
  `pages/portal/PortalApp.jsx` is the sub-app's own router+shell — mounted
  once at `App.jsx`'s `<Route path="/portal/*" element={<PortalApp />} />`
  (lazy-loaded like every other routed page, see "Route-level
  code-splitting" above) and wrapping its own nested `<Routes>` in
  `PortalAuthProvider`. `App.jsx` itself computes `isPortalRoute =
  useLocation().pathname.startsWith('/portal')` and skips rendering the
  staff `Navbar`/`IdleTimeoutMonitor`/`CommandPalette`/`Footer`/`BottomNav`
  entirely whenever it's true (each portal page renders its own header via
  `PortalLayout.jsx`, which also renders its own `Footer` instance —
  reusing the shared, staff-context-free `components/Footer.jsx`) — this is
  the one place `App.jsx` branches on path rather than on auth state, since
  the portal isn't just "logged out" or "logged in," it's a different app
  entirely occupying the same domain. `pages/portal/PortalLayout.jsx` is
  that header: brand/eyebrow, four nav links (Dashboard/Quotes/Invoices/
  Licenses — collapsing to a horizontally-scrollable second row below `sm`,
  not a hamburger drawer, since four links never need one), the client's
  name, `ThemeToggle` (reused as-is — it only reads `ThemeContext`, no
  staff-auth dependency), and a Log out button. The four unauthenticated
  auth pages (`PortalLogin`/`PortalAcceptInvite`/`PortalForgotPassword`/
  `PortalResetPassword`) share `pages/portal/PortalAuthCard.jsx`, a plain
  centered-card shell — deliberately not `pages/Login.jsx`'s full
  marketing-hero treatment, since a client landing on one of these came
  from a direct invite/reset link with exactly one task to do, not
  browsing the app's front door. `PortalLogin.jsx` redirects an
  already-authenticated visit straight to `/portal/dashboard`, same pattern
  as `Login.jsx`. `PortalAcceptInvite.jsx`/`PortalResetPassword.jsx` are
  straight mirrors of `ResetPassword.jsx`'s token-from-query-string +
  set-a-new-password shape, wired to `api.portal.acceptInvite`/
  `api.portal.resetPassword` instead. **`PortalAcceptInvite.jsx`'s error
  state adds one thing `ResetPassword.jsx` doesn't need**: the backend
  returns the exact same "This invite link is invalid or has expired"
  message (`routes/clientPortal.js`'s `POST /accept-invite`) whether the
  token was never valid, has genuinely passed its 7-day
  `INVITE_TOKEN_TTL_MS`, or — the most common real-world case, since the
  token is cleared the moment accept-invite succeeds — has already been
  used once to set a password. That last case reads as a contradiction to
  a client re-clicking their original invite email ("but it said 7 days"),
  so matching on that exact string adds a second line pointing at
  `/portal/login` ("already set up? log in") and `/portal/forgot-password`
  ("or reset it") — `reset-password` sets `password_hash` the same
  unconditional way `accept-invite` does, so it's a working recovery path
  regardless of which of the three cases actually happened, with no need
  for the backend to distinguish them or for a support conversation to
  figure out which one it was. `pages/portal/PortalDashboard.jsx`
  fetches all three lists in parallel and shows three `KpiCard`s (quotes
  awaiting response, outstanding invoice balance, active licenses) plus
  three shortcut tiles. `PortalQuotes.jsx`/`PortalInvoices.jsx`/
  `PortalLicenses.jsx` originally rendered a single, simple card list at
  every width (not the staff list pages' desktop-table +
  `MobileListAccordion` split) — a single client's own document set is
  small enough that one responsive card layout could serve both
  breakpoints, so the added complexity of a separate desktop table wasn't
  worth it here the way it is for the staff-side global lists. That
  changed with the desktop-table addition below, once it turned out the
  rest of the app's table-on-desktop convention was expected here too;
  the card list itself is unchanged and still what phone/tablet clients
  see. `PortalInvoices.jsx` gives an overdue invoice a red-tinted border and an
  "overdue" `StatusBadge` (`invoice.is_overdue ? 'overdue' : invoice.status`
  — the exact same ternary `Invoices.jsx` itself uses). `pages/portal/
  PortalQuoteDetail.jsx`/`PortalInvoiceDetail.jsx` are adapted directly
  from `pages/PublicQuote.jsx`/`PublicInvoice.jsx` (same bill-to/items-
  table/totals layout, same Accept/Decline buttons gated on `['draft',
  'sent'].includes(quote.status)`), wired to the portal's own auth token
  and API calls instead of a `public_token` route param —
  `PortalInvoiceDetail.jsx` additionally renders the Payments list `GET
  /invoices/:id` now returns, each row with its own receipt-download
  button. `lib/api.js`'s `portal` object holds every one of these calls
  (`login`/`acceptInvite`/`forgotPassword`/`resetPassword`/`me`/
  `getSettings`, plus `quotes`/`invoices`/`licenses` sub-objects) — the
  unauthenticated ones take no token (same shape as the top-level
  `api.login`/`api.forgotPassword`), everything else takes the portal
  token from `PortalAuthContext`, never `AuthContext`'s own `token`.

### Client portal self-service improvements (`backend/src/`, `frontend/src/`)

A batch of eight portal improvements built together in one pass — a
self-service account page, a per-license detail view, a notification bell,
a recent-activity timeline, a downloadable statement of account, inline
bank details on an unpaid invoice, search on the portal's own list pages,
and a "Need help?" contact popover. Grouped into one change rather than
eight separate ones deliberately: several of them (the notification bell,
the account/help icons, the license detail link) all land in
`PortalLayout.jsx`/`PortalLicenses.jsx`, so building them together avoided
the same file being repeatedly reopened and let the whole batch be
reasoned about, tested, and documented as one coherent portal upgrade
rather than eight overlapping diffs.

- **Self-service account page**: `routes/clientPortal.js` gains `POST
  /change-password` (`requireClientAuth`) — a straight mirror of
  `routes/auth.js`'s own `POST /change-password` (verify `currentPassword`
  via `bcrypt.compare` against `req.clientAccount.password_hash`, require
  `MIN_PASSWORD_LENGTH`, stamp `password_changed_at`, and — since bumping
  that column invalidates every token issued before now, including the one
  the request just authenticated with (see `middleware/clientAuth.js`'s own
  `iat` check) — return a fresh token so the caller's own session doesn't
  immediately log itself out). `pages/portal/PortalMyAccount.jsx` (route
  `/portal/account`) is the frontend: a read-only "Account" card (company
  name, login email) plus a change-password form, styled after
  `MyAccount.jsx`'s own change-password card. Deliberately **not** a full
  mirror of `MyAccount.jsx` — there's no profile-edit form (a portal
  account's `email` is its login identity; letting a client freely change
  it would need its own verification/conflict-check flow, out of scope for
  what this page actually needed to solve) and no notification-preference
  toggles (the portal has nothing equivalent to `notify_overdue`/
  `notify_quote_responses` — those are staff-side digest opt-ins with no
  portal-side counterpart). `PortalAuthContext.jsx` gained its own
  `updateToken()` (mirroring `AuthContext.jsx`'s), so a successful password
  change can adopt the fresh token without a full re-login.
- **Per-license detail view**: `routes/clientPortal.js` gains `GET
  /licenses/:id` (`requireClientAuth`, scoped to `client_id` same as every
  other per-record portal route — a mismatch 404s, never leaking whether
  the id belongs to *some* other client) — the portal's counterpart to
  `routes/licenses.js`'s own `GET /:id/renewals`, just returning the
  license itself (computed via the router's existing `withComputedLicense`)
  and its full `license_renewals` history in one call rather than two,
  since this is a whole page here, not a modal opened on demand from a
  list the way `Licenses.jsx`'s own "History" action works.
  `pages/portal/PortalLicenseDetail.jsx` (route `/portal/licenses/:id`,
  styled after `PortalInvoiceDetail.jsx`'s own card layout) shows the
  license's billing cycle/amount/dates/notes plus a renewal-history list
  (date + previous→new expiry per entry, "No renewals recorded yet." empty
  state — same convention `Licenses.jsx`'s own History modal already uses).
  `PortalLicenses.jsx`'s cards are now `Link`s to this page instead of
  plain `div`s.
- **Notification bell**: `components/portal/PortalNotificationCenter.jsx`
  is the portal's own counterpart to `components/NotificationCenter.jsx` —
  same shape (a live, computed view refetched on open, no persistence or
  read/unread state, outside-click-to-close), kept as its own component
  rather than generalizing the shared one (different auth context,
  different data source, different nav targets — the same "acceptable
  duplication" precedent `withComputedInvoice`/`publicSettings`/
  `markViewed` already set between `routes/public.js` and
  `routes/clientPortal.js`). No new backend route — it reuses the same
  three already-scoped list endpoints (`GET /quotes`, `GET /invoices`, `GET
  /licenses`) the dashboard's own KPI strip already calls, filtered
  client-side into four categories (a 5th, **payment proof rejected**, was
  added later once payment proof upload/rejection shipped — see "Rejection
  notification" under "Payment proof upload" below, since that one hits
  its own dedicated endpoint rather than one of these three): **overdue
  invoices** (`is_overdue`),
  **due soon** (not yet overdue, `balance_due > 0`, `due_date` within
  `DUE_SOON_DAYS` = 7 — a shorter window than licenses' own 30-day
  `EXPIRY_WARNING_DAYS`, since a bill due in two weeks isn't urgent the way
  one due in a few days is), **expiring licenses**
  (`display_status === 'expiring_soon'`), and **awaiting your response**
  (quotes with `status === 'sent'`). Mounted in `PortalLayout.jsx`'s header
  control cluster, right-anchored (the header always has room, same
  reasoning `NotificationCenter.jsx`'s own default `align="right"` already
  documents for `Navbar.jsx`'s header).
- **Recent activity timeline**: `routes/clientPortal.js` gains `GET
  /activity` (`requireClientAuth`) — deliberately **not** a read of
  `activity_log` (that's a staff-wide audit trail with no `client_id`
  column at all; exposing it directly would risk leaking another client's
  rows alongside this one), but a small set of purpose-built queries
  against the same `quotes`/`invoices`/`payments`/`licenses` tables every
  other route in this router already scopes to `client_id`, merged into
  one chronological list of `{ type, label, date, link, amount }` entries
  (`amount` only set for a `payment` entry, so the frontend can format it
  with the currency symbol it already has rather than this route needing
  to know it) and capped at `ACTIVITY_LIMIT` (10, most recent first) — a
  list this small doesn't need pagination, same "don't build it until
  needed" call this app already makes elsewhere. Four entry types: quote
  sent (`issue_date`, gated through the same `CLIENT_VISIBLE_QUOTE` filter
  every other quote read in this router uses), quote responded
  (`client_responded_at`), invoice issued (`issue_date`), payment received
  (`payments.paid_at`, joined to its invoice), and license renewed
  (`last_renewed_at`). `pages/portal/PortalDashboard.jsx` renders this as a
  "Recent activity" panel below the existing shortcut tiles — an
  independent, best-effort fetch (failure just leaves the panel absent,
  same reasoning `Dashboard.jsx`'s own "Needs attention" panel fetches are
  kept separate from its main summary call) that renders nothing at all
  once loaded-and-empty, same "only show the exception case" convention
  this app already follows (a brand-new client with no history yet doesn't
  need an empty panel telling them so).
- **Statement of account PDF — built, then removed.** This originally
  shipped as `GET /statement/pdf?from=&to=` on `routes/clientPortal.js`
  plus `lib/reportPdf.js`'s `renderClientStatementPdf()` and a "Download
  statement" button on `pages/portal/PortalInvoices.jsx`, but was taken
  back out shortly after on explicit request — the portal is meant to stay
  a simple read/upload surface for a client, not a bookkeeping-report tool.
  All three pieces were deleted outright rather than left dead/unreachable
  in the codebase.
- **Inline bank details on an unpaid invoice**: `PortalInvoiceDetail.jsx`
  renders a small "How to pay" block (`settings.bank_details` — the same
  field every quote/invoice PDF already prints, not a new one) directly on
  the page whenever `invoice.balance_due > 0` and the business has actually
  filled that field in, so a client doesn't have to download the PDF just
  to find out how to pay. Hidden once the balance reaches 0 (nothing left
  to pay) and when `bank_details` is blank, same "only show the exception
  case" convention every other optional block on this app's detail pages
  already follows.
- **Search on portal document lists**: `PortalQuotes.jsx`/
  `PortalInvoices.jsx`/`PortalLicenses.jsx` each gained a `components/
  SearchInput.jsx` box filtering the already-fetched, already-unpaginated
  list in memory (number/name, case-insensitive `includes()`) — no new
  backend `?q=` param, since these lists are already fetched whole (a
  single client's own document set is inherently small, see this router's
  own top-of-file note on why none of these lists paginate) and a
  client-side filter is all a growing history actually needs. Each page
  shows a `No X match "..."` message when the filter matches nothing,
  distinct from the list's own empty state (no documents at all).
- **"Need help?" contact popover**: a small component local to
  `PortalLayout.jsx` (not split into its own file — it's a single, simple
  popover with no reuse case elsewhere), same outside-click-to-close
  pattern as `PortalNotificationCenter.jsx`, showing the business's own
  `phone`/`email` (from `business_settings`, already fetched once by
  `PortalAuthContext` for every portal page — no new backend call needed).
  Renders nothing at all — not even the trigger button — when the business
  has filled in neither field, so an unconfigured business doesn't show a
  pointless empty popover.
- Two new icons in `components/icons.jsx`, following its existing
  20×20/1.5px-stroke/`currentColor` convention: `UserIcon` (a single
  person — "my account," deliberately distinct from `UsersIcon`'s plural
  meaning elsewhere in the app) and `HelpCircleIcon` (a question mark in a
  circle — "need help").
- `lib/api.js`'s `portal` object gained `changePassword`, `activity`, and
  `licenses.get` alongside the existing calls (`openStatementPdf` was
  removed along with the statement PDF feature itself, see above).
- **Header rebrand**: `PortalLayout.jsx`'s wordmark link changed from
  "EduSolution`.com`" (with a lagoon-colored `.com`) plus an adjacent
  "Client portal" pill badge to a single plain "EDU SOLUTIONS" — the pill
  was dropped outright rather than just hidden, on the reasoning that a
  client logged into their own dedicated portal domain-space doesn't need
  reminding they're "in the client portal" every time they look at the
  header. `components/Footer.jsx` (shared with the staff app, rendered
  by `PortalLayout.jsx` too) keeps its own "EduSolution.com" wordmark
  unchanged — this rebrand was scoped to the header specifically, not a
  full rename of every mention of the product name across the app.
- **Full width**: every portal content page (`PortalDashboard.jsx`,
  `PortalQuotes.jsx`, `PortalInvoices.jsx`, `PortalLicenses.jsx`,
  `PortalMyAccount.jsx`, and the three detail pages' loading/error/loaded
  states) dropped its `mx-auto max-w-*` cap — same bare `px-4 py-10
  sm:px-6` shape every staff business list page already uses (see
  Dashboard.jsx's own note on this same pattern). `PortalLayout.jsx`'s
  header row lost its own `mx-auto max-w-5xl` wrapper too, so the header
  and the content below it read as one consistent full-width surface
  rather than a full-width body under a narrower header bar. Deliberately
  **not** applied to the four unauthenticated auth pages
  (`PortalLogin`/`PortalAcceptInvite`/`PortalForgotPassword`/
  `PortalResetPassword`, all sharing `PortalAuthCard.jsx`'s centered-card
  shell) — a login form stretched edge-to-edge across a wide monitor
  would be a readability regression, not an improvement, and this was a
  request about the portal's actual content pages, not its auth screens.
- **Desktop table view for the three portal list pages**: `PortalQuotes.jsx`/
  `PortalInvoices.jsx`/`PortalLicenses.jsx` each gained a proper
  `hidden overflow-x-auto sm:block` `<table>` for `sm` and up, mirroring the
  staff-side list pages' own table columns/structure exactly (same
  `min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700`
  shell, same uppercase `<th>` treatment, a `Link` on the primary column,
  `StatusBadge` in its own column, money right-aligned) — bringing these
  three in line with the rest of the app's "table on desktop" convention
  after all, which the original card-only design (see above) had
  deliberately opted out of. The existing card list is untouched and now
  wrapped in a matching `sm:hidden` block below the new table, so phone/
  tablet clients see exactly what they always did; only the desktop
  presentation changed. `PortalQuotes.jsx`'s table omits the client-only
  "Your requests" section above it (unaffected either way — that's its own
  card list, not one of the three tabled document lists) and carries
  Number/Issued/Status/Total columns; `PortalInvoices.jsx`'s carries
  Number/Due (with the same inline "· Overdue" red suffix the card uses)/
  Status/Balance due (with a small "of {symbol}{total}" note when a
  partial payment has been made, mirroring the card's own two-line
  balance-then-total treatment in one row instead); `PortalLicenses.jsx`'s
  carries Name/Billing cycle/Expires/Status/Amount. None of these gained
  row actions or a mobile-accordion split the way a staff list page would
  — there's nothing to act on from the list itself (every row already just
  links to its own detail page, same as the card version), and a single
  client's document set is still too small to need collapsing extra detail
  behind a tap, which is exactly why the mobile card view didn't change.

### Payment proof upload (`backend/src/`, `frontend/src/`)

A client can attach evidence that they paid — a bank transfer slip, a
payment advice, a receipt photo — to one of their own unpaid invoices from
the portal. This is deliberately **not** an online-payment feature: this
app has no payment-gateway integration (no merchant account, no sandbox
credentials, nothing to build against), so a "Pay now" button was never on
the table here. A proof is just that — evidence a staff member reviews
against the real bank statement before recording the actual payment
through the existing `POST /invoices/:id/payments` flow, same as always.
Nothing here auto-records a payment, auto-matches an amount, or changes
`invoices.status`/`amount_paid` — the only state a proof mutation ever
touches is its own row.

- `payment_proofs` (`db/index.js`, brand new table — see that file's own
  note on why this is a plain `CREATE TABLE IF NOT EXISTS` rather than an
  `ALTER TABLE`) holds one row per upload: `invoice_id`, `file_data` (a
  base64 data URI — same storage approach `business_settings`'s logo/
  signature/stamp images already use, since this app has no separate file
  storage service and a payment slip is small enough to store inline the
  same way), `file_name`, `file_type` (the MIME type, kept as its own
  column rather than re-parsed from the data URI on every read), `note`
  (optional, client-supplied), `status` (`pending` | `reviewed`), and
  `reviewed_by_name`/`reviewed_at` (set once a staff member marks it
  handled). `ON DELETE CASCADE` on `invoice_id` — deleting an invoice
  takes its proofs with it, same as it already does for `invoice_items`/
  `payments`.
- **Body size limit**: `index.js`'s `express.json()` limit was raised from
  `2mb` to `8mb` — the old ceiling was sized for `PUT /api/settings`'s
  base64-encoded logo/signature images (a few hundred KB each), but a
  phone photo of a bank slip routinely runs 2-5MB before base64 inflates
  it by another third, well past the old limit.
- **Upload** (`routes/clientPortal.js`'s `POST /invoices/:id/payment-
  proof`, `requireClientAuth`, scoped to `client_id` same as every other
  per-record portal route): 400s if the file is missing, if `file_type`
  isn't one of `PAYMENT_PROOF_TYPES` (`image/jpeg`, `image/png`,
  `image/webp`, `application/pdf`), or if the decoded byte length exceeds
  `PAYMENT_PROOF_MAX_BYTES` (6MB, leaving headroom under the 8mb JSON body
  limit once the rest of the request envelope is counted) — all checked
  against the actual decoded bytes, not trusted from the client, so a
  spoofed `file_type` or an oversized payload can't sneak past validation.
  409s if the invoice is `void` or already has nothing left to pay
  (`balance_due <= 0`) — there's nothing to prove payment of at that
  point. Logs an activity entry (`action: 'uploaded a payment proof for
  (client)'`, same `"(client)"` suffix convention every other client-
  initiated action in this app uses) and fires (never awaited)
  `lib/paymentProofNotify.js`'s `notifyStaffOfPaymentProof()` — an opt-in
  staff digest (`users.notify_payment_proofs`, the fourth checkbox on
  `MyAccount.jsx`'s Notifications card, wired through the same `PUT
  /api/auth/preferences` route as `notify_overdue`/
  `notify_quote_responses`/`notify_monthly_report`), same internal-
  notification shape as `lib/quoteAcceptedNotify.js`'s own
  `notifyStaffOfQuoteAccepted()` — not a client-facing send, so it
  deliberately doesn't go through `lib/emailTemplates.js`'s editable-
  template system and isn't recorded to `email_log`.
- **Client view**: `routes/clientPortal.js`'s `getClientInvoice()` now
  also returns `paymentProofs` — metadata only (`id`, `file_name`,
  `file_type`, `note`, `status`, `uploaded_at`), no `file_data`, since the
  client already has their own copy of whatever they uploaded and doesn't
  need to re-download it through the app. `PortalInvoiceDetail.jsx` renders
  these as a "Payment proofs you've sent" list (file name, upload date,
  note, a `StatusBadge` for `pending`/`reviewed` — `pending` already had an
  amber color in `StatusBadge.jsx`'s map from the quote-requests feature,
  `reviewed` falls back to that component's default slate, which reads
  correctly as "settled/neutral" with no new color needed) above an
  "Uploaded a bank slip? Send it here" upload form — a file input
  (`accept="image/jpeg,image/png,image/webp,application/pdf"`) plus an
  optional note textarea, converting the chosen file to a base64 data URI
  client-side via `FileReader.readAsDataURL()` (wrapped in a `fileToDataUri()`
  Promise helper, local to this file) before posting. The form itself is
  gated the same way the backend is (`invoice.balance_due > 0 &&
  invoice.status !== 'void'`), so it never shows for a case the backend
  would just 409 on, same "don't show a button that would just error"
  convention this app already follows everywhere else. A client-side size
  check (`file.size > PROOF_MAX_BYTES`) gives an immediate, friendly error
  before ever attempting the upload, rather than relying solely on the
  backend's own rejection.
- **Staff view**: `routes/invoices.js`'s `getInvoiceWithItems()` gains the
  same `paymentProofs` metadata-only array (same reasoning — `file_data`
  can be a few MB and this response is fetched on every invoice page
  load). The actual file is served by a dedicated `GET
  /:id/payment-proofs/:proofId/file` route (`view`-gated) that decodes the
  stored data URI and streams the real bytes with the right
  `Content-Type`/`Content-Disposition`, the same way `GET /:id/pdf`
  already streams a PDF — this is deliberately *not* JSON-wrapped, so the
  browser can render an image inline or open a PDF exactly like every
  other document download in this app. `lib/api.js`'s
  `openPaymentProofFile()` reuses the existing `openPdf()` helper for
  this (fetch → blob → `window.open()`) despite the name — that helper was
  always generic, it just fetches whatever `Content-Type` the response
  actually carries. `InvoiceDetail.jsx` renders a "Payment proofs"
  `Accordion` (only shown when at least one exists) right after
  "Payments", with a pending-count badge on the accordion's own title
  (`{pendingProofCount} pending`) so "something needs a look" is visible
  even while the section is collapsed on mobile — the standard desktop-
  table + `MobileListAccordion` split (see "Mobile design system" above)
  applies here too. Each row gets up to four `IconActionButton`s: "View
  file" (`DownloadIcon`, tone `lagoon`, ungated — a view-only user can
  still look, same convention `Download PDF`'s own ungated button already
  follows), "Mark reviewed" (`CheckCircleIcon`, tone `emerald`,
  `canManage`-gated, shown only while `status === 'pending'`), "Reject"
  (`XIcon`, tone `red`, same `pending`-only gate), and "Delete"
  (`TrashIcon`, tone `red`, `canManage`-gated, behind the same
  `useConfirm()` dialog every other destructive action in this app uses).
  `POST /:id/payment-proofs/:proofId/review` (`manage`) only ever flips
  `status`/`reviewed_by_name`/`reviewed_at` — it never touches the
  invoice's own `amount_paid`/`status`, reinforcing that "reviewed" means
  "a human looked at this," not "this payment was recorded" (recording the
  real payment is still the separate, existing "Record payment" action).
  `DELETE /:id/payment-proofs/:proofId` (`manage`) logs an activity entry
  (`action: 'deleted a payment proof for'`) the same way every other
  delete in this app does.
- **Reject with a note**: the other terminal outcome for a proof, alongside
  "reviewed" — `POST /:id/payment-proofs/:proofId/reject` (`manage`) 400s
  on a blank `note` (unlike review, a rejection has to explain itself),
  otherwise sets `status = 'rejected'`, stores the note in
  `payment_proofs.review_note` (`db/index.js`, guarded `ALTER TABLE` — this
  table had already shipped a real deploy by the time this was added, same
  `licenses.url` lesson every other post-launch column addition in this
  file follows), and stamps `reviewed_by_name`/`reviewed_at` same as
  review does. Like review, it only ever touches the proof's own row — an
  invoice's `amount_paid`/`status` are never affected either way. Clicking
  "Reject" (`InvoiceDetail.jsx`, `pending`-only, same row as "Mark
  reviewed") opens a small `Modal` with a required textarea rather than a
  bare `confirm()` — a rejection reason is real text input, not a yes/no,
  same reasoning `QuoteRequests.jsx`'s own decline flow already uses a
  `Modal` instead of `window.confirm()` for its note. `StatusBadge.jsx`
  gained a `rejected` entry (red, same as `declined`/`void`) alongside the
  existing `pending` (amber)/`reviewed` (falls back to the default slate).
  The whole point of a reject-with-a-note action over just deleting the
  upload is that the client sees *why* — `routes/clientPortal.js`'s
  `getClientInvoice()` now selects `review_note` alongside `status`, and
  `PortalInvoiceDetail.jsx` renders "Rejected: {review_note}" under the
  client's own copy of that proof, in red, right next to their own upload
  note. The upload form stays visible regardless (still gated only on
  `balance_due > 0 && status !== 'void'`), so a rejected proof doesn't
  block the client from uploading a corrected one.
- **Rejection notification**: "Rejected: {review_note}" on
  `PortalInvoiceDetail.jsx` only surfaces once a client thinks to open that
  specific invoice — nothing told them a rejection had happened at all, so
  this closes that gap the same way every other "something needs your
  attention" signal in this app already gets surfaced proactively rather
  than left to be discovered. `routes/clientPortal.js` gains `GET
  /payment-proofs/rejected` (`requireClientAuth`, scoped to
  `req.clientAccount.client_id` same as every other per-client portal
  route) — every one of the client's own rejected proofs across their
  whole invoice set, newest review first, joined to `invoices` for the
  invoice number: `{ id, file_name, review_note, reviewed_at, invoice_id,
  invoice_number }`. Deliberately its own dedicated route rather than
  folded into `GET /invoices/:id` (which already returns `paymentProofs`
  for one invoice) — `PortalNotificationCenter.jsx`'s bell needs this
  across the client's *whole* invoice set in one call, same reasoning the
  bell's other categories each already hit their own already-scoped list
  endpoint rather than a per-invoice one. `GET /activity` (see "Recent
  activity timeline" above) gains a matching `payment_proof_rejected`
  entry type — one more purpose-built query against `payment_proofs`
  joined to `invoices` (still scoped to `client_id`, same as every other
  query in that route), `label: `Payment proof rejected for invoice
  ${number}``, `date: reviewed_at`, `link` straight to
  `/portal/invoices/:id`. `PortalDashboard.jsx`'s `ACTIVITY_ICONS` map
  gained a `payment_proof_rejected: AlertTriangleIcon` entry so this reads
  correctly in the "Recent activity" panel rather than falling back to the
  map's generic `QuoteIcon` default.
  `PortalNotificationCenter.jsx` gained a 5th category, "Payment proof
  rejected" — same live-computed-on-open pattern as the other four
  (`rejectedProofs` state, fetched via the new endpoint above alongside
  the existing three list calls in `load()`, folded into the bell's
  `total` count), rendered with the same red `AlertTriangleIcon` treatment
  `overdueInvoices` already uses (a rejection is exactly that kind of
  "needs your attention now" item, not an amber "coming up" one like Due
  soon/Expiring licenses) — bold invoice number, `review_note` as the red
  subtext line (falling back to a generic "Rejected — please re-upload
  proof of payment." in the unlikely case a row has no note, though the
  backend's own `reject` route already requires one on every write going
  forward). Clicking an entry navigates straight to that invoice's own
  `/portal/invoices/:id` page — the same page `review_note`'s own inline
  rendering already lives on — so the notification and the detail it's
  pointing at are never two different views of the same fact.

### Easier payment recording + payment slip scan (`frontend/src/`)

Two related staff-side improvements to recording an invoice payment, built
together since both touch the same form: reaching "Record payment" no
longer requires opening a specific invoice's own detail page first, and
the form itself can optionally read a photographed/uploaded bank slip and
pre-fill the Reference field from whatever transaction number it prints.
Purely a frontend change — `POST /api/invoices/:id/payments` itself
(`routes/invoices.js`) is completely unchanged; this is all about how
staff *reach* and *fill in* that same existing endpoint.

- **`components/RecordPaymentModal.jsx`** is the one "Record payment" form
  now, pulled out of `InvoiceDetail.jsx`'s own previously-inline
  `<form>` (which lived inside its "Payments" `Accordion`, collapsed by
  default on mobile — one more tap before the button was even visible)
  into a standalone `Modal`-based component with no change to the fields
  themselves (Amount/Method/Date/Reference — `notes` stays in the
  submitted payload but, as before this change, has no input of its own).
  Takes `{ open, onClose, invoice, token, onRecorded }` — owns its own
  submit/busy/error state and calls `api.invoices.recordPayment` itself,
  so both callers below just need to react to `onRecorded(result)`
  (refresh their own data) rather than re-implementing the submit flow.
  Opening it re-syncs Amount to the invoice's current `balance_due` every
  time (mirrors the old inline form's own `togglePaymentForm()` behavior
  exactly — paying off the full remaining balance is the common case, the
  field stays freely editable for a partial payment).
- **List-row quick action**: `Invoices.jsx` gained a `BanknoteIcon`
  (`icons.jsx` — a rounded banknote, distinct from `BankIcon`'s
  running-balance meaning) "Record payment" `IconActionButton` (tone
  `emerald`) in `rowActions()`, opening `RecordPaymentModal` for that row
  directly from the list — no navigation to the invoice's own detail page
  needed at all, closing the actual gap in "make it easier to access":
  before this, recording *any* payment meant finding the right invoice in
  the list, clicking into its detail page, then finding and expanding the
  Payments section. `InvoiceDetail.jsx`'s own existing "Record payment"
  button (in the Payments `Accordion`'s header action) now opens the same
  modal instead of the old inline form — same trigger, same place, just a
  popup instead of an in-page expansion.
- **A real pre-existing gating bug, caught and fixed by this change**:
  both the list-row action and the detail page's button used to be gated
  on `invoice.status !== 'void' && invoice.balance_due > 0` — which is
  *not* actually the full set of invoices `POST /:id/payments` accepts.
  That route also 400s with `"cannot record a payment against a draft
  invoice"` for a `draft` invoice (only `sent` invoices with a balance are
  ever actually payable), so a draft invoice — which always has
  `balance_due > 0` the moment it's created — showed a "Record payment"
  button that would just error on click, the exact "never show a button
  that would just error" violation this app otherwise guards against
  everywhere. Both gates are now `invoice.status === 'sent' &&
  invoice.balance_due > 0`, matching the backend's own guard exactly;
  caught during this feature's own Playwright verification (a draft test
  invoice's payment attempt 400'd, which is what led to checking the
  gate itself rather than assuming the pre-existing condition was
  already correct).
- **Payment slip scan**: `components/ScanPaymentSlip.jsx`, mounted at the
  top of `RecordPaymentModal.jsx`'s form, is an optional "Scan payment
  slip (optional)" file input (`accept="image/*" capture="environment"`,
  so a phone offers its camera directly) that runs client-side OCR via
  `tesseract.js` (a new frontend dependency) on the chosen image and, if
  it finds something that looks like a reference/transaction number,
  pre-fills the Reference field with it. `tesseract.js` itself is loaded
  via a dynamic `import()`, not a static one — this is a rarely-clicked,
  optional action, not something every page load (or even every payment
  recorded) should pay the ~19KB for, the same "route-level
  code-splitting" reasoning this app already applies to whole pages (see
  "Route-level code-splitting" below). `lib/extractReference.js`'s
  `extractReference(rawText)` is the actual pick-a-heuristic, deliberately
  factored out as a small, pure, dependency-free function (no OCR, no DOM,
  no network) so it's the one part of this feature that's unit-testable
  in isolation, returning `{ value, source }` (`source` is `'reference'` |
  `'description'` | `'fallback'`) or `null` when nothing usable was found
  at all. Three tiers, tried in order:
  1. A line containing a common bank-slip *reference* label (`ref`/
     `reference`/`txn`/`transaction`/`trans`/`confirmation`/`receipt`,
     each optionally followed by `no`/`no.`/`number`/`#` — e.g. "Reference
     No:", "Transaction No.", "Receipt No.", "Confirmation#" are all real
     slip label shapes this needs to recognize as *one* label, not a
     keyword plus a mangled value) — the token right after the label is
     taken as the reference.
  2. No reference label at all — real staff feedback on this feature
     (some slips scanned fine but the field stayed blank) turned out to
     mean exactly what it sounds like: plenty of real slips genuinely
     don't print a reference number, only a *description* of what the
     payment was for. Falls back to a description-style label instead
     (`description`/`particulars`/`remarks`/`narration`/`purpose`/
     `details`/`memo`/`note`/`for`) and takes the rest of that line — a
     short phrase, not a single code, capped at 60 characters so a long
     narration doesn't blow out the Reference field.
  3. Neither label found — falls back to the longest alphanumeric token
     in the whole text that's at least 6 characters *and* contains a
     digit (so a stray letterhead word like "TRANSFER" can never win over
     a real reference just for being long).
  **Fixing tier 1 to recognize a `no`/`number`/`#` suffix as part of the
  label (not the value) was itself a real bug fix, not just cleanup** —
  the original regex only special-cased this for two of its six keywords
  (`trans(?:\s*no)?`, `receipt\s*no`), so a slip labeling its reference
  "Reference No: 123456" (an extremely common real-world format) silently
  failed to match: "No" got swallowed into the *value* capture attempt,
  which then broke on the colon right after it and failed the capture's
  own minimum-length check, so the match failed entirely and this fell
  through to the much less reliable tier-3 fallback instead — explaining
  the original bug report ("reference number is picking from some slips"
  but not others, with no obvious pattern from a user's perspective).
  Sharing one optional suffix across every keyword (rather than special-
  casing it per keyword) closes this gap for all of them at once. Either
  way this is always a guess, never authoritative —
  `components/ScanPaymentSlip.jsx`'s own `SCAN_NOTICES` map picks a
  distinctly-worded success notice per tier (`` Detected "{value}" —
  please double-check it against the slip before saving. `` for a real
  labeled reference, down to `` Couldn't find a labeled reference or
  description on this slip — filled in "{value}" as a best guess. Please
  check it carefully before saving. `` for the tier-3 guess) so staff
  know how much to trust what just got filled in, rather than one generic
  "detected X" line regardless of which tier actually produced it. The
  Reference field stays a normal, freely-editable text input regardless
  of whether a scan was ever attempted, which tier produced a value, or
  whether one was found at all.
  **This deliberately does not self-host tesseract.js's worker/WASM
  core/language-data files** (unlike this app's own fonts — see "Mobile
  design system"'s note on why those *are* self-hosted) — those files run
  well into single-digit megabytes, multiple orders of magnitude past
  what a font pair costs, and bundling them would mean every visitor's
  PWA install precache grows by that much for a feature most staff will
  use rarely if ever; `tesseract.js` instead fetches them from its own
  default CDN (`cdn.jsdelivr.net`) the first time OCR actually runs, and
  caches them in the browser afterward. The real, known trade-off: this
  makes the *scan* step (not the rest of the form, not the rest of the
  app) depend on that CDN being reachable from wherever staff are — on a
  heavily locked-down network (a corporate firewall blocking unrecognized
  domains outright, the same class of problem this business has already
  hit once with `api.edusolutionsmaldives.com` itself) the scan can fail
  outright. That failure is always caught and shown as a plain "Couldn't
  scan this image — please enter the reference manually." notice
  (`ScanPaymentSlip.jsx`'s own try/catch around the whole recognize call)
  — verified directly in this sandboxed dev environment, whose own
  outbound network policy blocks arbitrary CDN domains the exact same
  way: attempting a scan here reliably fails at the `importScripts()`
  step and surfaces that exact message, with the rest of the form (Amount/
  Method/Date/Reference, and a normal submit) staying fully usable
  afterward — real, if accidental, end-to-end proof the degradation path
  works, even though the successful-recognition path itself could only be
  verified against `extractReference()`'s own unit-style checks (real
  bank-slip-shaped sample text, not a real photographed slip) rather than
  a live OCR run, since this sandbox's own network couldn't reach the CDN
  either. If this ever becomes a real recurring problem for actual staff
  (not just this dev sandbox), self-hosting a smaller subset (just the
  LSTM-only WASM core, skipping the SIMD variant) is the next thing to
  try before giving up on the feature entirely.

### Quote requests (`backend/src/`, `frontend/src/`)

A client's ask for a quote, submitted from the portal, reviewed by staff,
and turned into a real quote — the loop being: client requests (by picking
from the product catalog, describing something not in it, or both) →
staff approves (by building an actual priced quote — the client can see
it in their portal the instant it's linked, whether or not staff has
separately clicked "Send" on it yet, see `CLIENT_VISIBLE_QUOTE` below) or
declines → client sees the outcome in their portal and can accept it the
normal way → staff gets notified. This is deliberately a
separate `quote_requests`/`quote_request_items` pair of tables, not a
`quotes` row with a new status — a request has no pricing, tax, or
discount, and **a client is never trusted with a price, not even a
read-only one they merely selected** — the server only ever stores which
product and how many, and looks up the real price itself wherever one is
shown or used; a request only ever becomes a quote via the existing
quote-creation flow, pre-filled with the request's own client/items
(priced fresh from the live catalog)/description.

- `quote_requests` (`db/index.js`, added fresh — a brand-new table, plain
  `CREATE TABLE IF NOT EXISTS`) has `client_id`, `description` (now
  optional — a request can be carried entirely by its catalog items
  instead), `status` (`pending | approved | declined`), `quote_id`
  (nullable, set once a staff member actually creates the resulting quote
  — `ON DELETE SET NULL` rather than `CASCADE`, so deleting that quote
  later doesn't erase the record that a request was ever made, just its
  link to that specific quote), `decision_note` (shown to the client when
  declined), `decided_by_name`/`decided_at`. `quote_request_items` (also
  fresh) holds the catalog picks — `quote_request_id`, `product_id` (no
  `REFERENCES` constraint, same reason `quote_items`/`invoice_items`'s own
  `product_id` column doesn't — see that note above), `description` (a
  denormalized snapshot of the product's name at request time, same
  reasoning `quote_items`/`invoice_items` snapshot theirs), `quantity` —
  **deliberately no price/amount column at all**. `users` also gains
  `notify_quote_responses INTEGER NOT NULL DEFAULT 0` (`ALTER TABLE`, same
  guarded pattern as `notify_overdue` — see that column's own note above
  — since `users` already had real accounts) for the opt-in staff
  notification below.
- `routes/clientPortal.js` gains `GET /products` — **not** the full
  product catalog `GET /api/products` serves staff; scoped to
  `WHERE visible_in_portal = 1` (see `products.visible_in_portal` above),
  so a client only ever sees the subset an admin has explicitly opted in,
  deliberately including `unit_price` unlike every other stripped-down
  portal response: a client picking items needs to see what things cost
  to make an informed pick, they just can never set or change that number
  (see below). `POST /quote-requests`
  (`requireClientAuth`) accepts an optional `description` and an optional
  `items` array of `{ product_id, quantity }` — **`unit_price`/`amount`
  fields in the request body, if present, are silently ignored**; the
  route re-validates each `product_id` against the live `products` table,
  scoped to `visible_in_portal = 1` too (400 if it no longer exists or was
  never opted in — a client can't reference a hidden product by guessing
  its id even though the picker never shows it) and writes only the
  product's *current* name/id + the client's quantity into
  `quote_request_items`, inside a
  `db.transaction()` alongside the `quote_requests` insert. 400s if
  neither `description` nor at least one valid item is given. Logs an
  activity entry with the same `"(client)"` action suffix the portal's
  quote-respond route uses. `GET /quote-requests` (the client's own
  requests, newest first, `LEFT JOIN`ed against `quotes` for
  `quote_number`/`quote_status`) batches in each request's items via one
  `IN (...)` query rather than one query per row. **This is also where
  `GET /quotes`/`GET /quotes/:id` (and by extension the PDF/respond
  routes, which both call the same `getClientQuote()`) gained a
  `CLIENT_VISIBLE_QUOTE` filter they didn't need before quote requests
  existed** — every quote used to reach `quotes` through a human
  reviewing it first, so a client could never have seen a draft; now that
  `POST /quote-requests/:id/link-quote` below can create a fresh
  **draft** quote directly from a client's own request, that same
  `status != 'draft'` rule would otherwise hide it from the very client
  who asked for it. `CLIENT_VISIBLE_QUOTE` is `status != 'draft' OR
  EXISTS (SELECT 1 FROM quote_requests WHERE quote_requests.quote_id =
  quotes.id)`: a quote with no linked request still needs the original
  `status != 'draft'` rule (an ordinary quote staff is drafting up on
  their own initiative is still "not ready for the client to see"), but a
  quote that *is* linked to a request is visible the instant that link
  happens, draft or not — linking only ever happens once a staff member
  has decided to fulfill the request (see `POST /:id/link-quote` below),
  so that decision itself is the "yes, here's your quote" moment as far
  as the client's concerned, not the separate, possibly-much-later click
  on "Send." A request's own `status` flips to `approved` the same
  instant it's linked, so `PortalQuotes.jsx` below never has an
  "approved but not yet visible" state to render a placeholder for — it
  can link straight to the quote the moment `status === 'approved'`.
- `routes/quoteRequests.js` (mounted at `/api/quote-requests`) is the
  staff-side review API — gated on the existing `quotes` permission rather
  than a new `MODULES` entry (same "reuse when sensitivity matches" call
  `routes/reports.js`/`routes/capitalContributions.js` already make
  elsewhere: a request is a precursor to a real quote at the identical
  sensitivity level). `GET /` (`view`) supports `?status=` and `?page=`
  (opt-in pagination, same convention as every other list route — see
  "Pagination convention" above), joins in `client_name` plus the linked
  quote's `number`/`status` when present, and — same batched `IN (...)`
  approach as the portal's own list route — attaches each request's
  `items`. `POST /:id/decline` (`manage`) takes an optional `note` (shown
  to the client), 409s if the request isn't still `pending`. **`POST
  /:id/link-quote`** (`manage`) is the "approve" action — but it doesn't
  create a quote itself; it's called by the frontend right after a staff
  member saves a real, priced quote they built from the request (see
  `QuoteForm.jsx` below), taking that quote's id in the body. Validates
  the quote actually exists and belongs to the same client as the request
  (400 otherwise — a request can't be satisfied by a quote for someone
  else), 409s if the request isn't still `pending`, then stamps `status:
  'approved'`, `quote_id`, `decided_by_name`/`decided_at`. Every mutation
  calls `logActivity()` with the client's name in the label, same as the
  rest of this app's quote/invoice actions.
- `lib/quoteAcceptedNotify.js`'s `notifyStaffOfQuoteAccepted({ quote,
  client })` — an opt-in staff digest (`notify_quote_responses`, mirrored
  in `MyAccount.jsx` right next to the existing `notify_overdue` toggle),
  same shape as `lib/scheduler.js`'s own `notifyStaffOfReminders()`: an
  internal notification, not a client-facing send, so it deliberately
  doesn't go through `lib/emailTemplates.js`'s editable-template system
  and isn't recorded to `email_log` (same reasoning
  `notifyStaffOfReminders()` itself documents). Skips entirely if
  `SMTP_HOST` isn't set or nobody's opted in; best-effort per recipient
  otherwise. Called — **never awaited**, just fired with a `.catch()` so a
  slow or failed staff email can never delay or break the client's own
  accept response — from both `routes/public.js`'s and
  `routes/clientPortal.js`'s `POST .../respond` handlers, only when
  `response === 'accepted'`. The email links straight to the quote's
  staff-side detail page, where the existing "Convert to invoice" button
  (`routes/quotes.js`'s `POST /:id/convert-to-invoice`, unchanged by this
  feature) is what actually carries it into the invoicing flow — there
  was already no status guard on that route, so nothing new was needed
  there for "accepted → invoice" to just work. Quote numbering itself
  (`lib/numbering.js`'s `nextQuoteNumber()`) is also completely unchanged
  by any of this — a quote created from a request goes through the exact
  same `POST /api/quotes` handler as any other quote, so it continues the
  real per-year sequence rather than restarting.
- `components/LineItemsEditor.jsx` gained two optional props, both
  defaulting to their original behavior so every existing caller
  (`QuoteForm.jsx`, `InvoiceForm.jsx`, `RecurringInvoices.jsx`) is
  unaffected: `priceEditable` (default `true`) — when `false`, the unit
  price renders as a plain read-only value instead of an `<input>` — and
  `subtotalLabel` (default `'Subtotal'`). `PortalQuotes.jsx` below is the
  one caller that sets both.
- `pages/business/QuoteRequests.jsx` (route `/quote-requests`, `Navbar.jsx`
  link right after "Quotes", same `quotes` module gate) is the staff
  review list — `StatusFilterChips` (All/Pending/Approved/Declined), the
  standard desktop-table + `MobileListAccordion` split, a `rowActions()`
  helper shared between both breakpoints (same convention as
  `Quotes.jsx`/`Invoices.jsx`'s own row actions). Its description column
  is actually a `requestSummary()` helper — item quantities/names
  (`"2× Laptop (Standard), 1× 3-Year Warranty Plan"`) when the request has
  catalog items, falling back to the free-text `description` when it
  doesn't; the mobile accordion body shows both (the summary, plus the
  optional `description` as an "anything else" note) when a request has
  both. A `pending` row gets two `IconActionButton`s: "Create quote from
  this request" (tone `emerald`, `CheckCircleIcon`, navigates to
  `/quotes/new?requestId=<id>` — there's no direct in-page approve action,
  since a request has no pricing to approve *into*) and "Decline" (tone
  `red`, `XIcon`, opens a small `Modal` with an optional note textarea
  rather than a bare `confirm()`, since a decline note is real input, not
  just a yes/no). A decided row instead shows a "View quote" link (when
  linked) or nothing. `StatusBadge` gained `pending`/`approved` entries
  for this (`declined` already existed, reused as-is).
- `QuoteForm.jsx` reads an extra `?requestId=` query param on the routed
  (non-`embedded`) `/quotes/new` path only — the "New quote" modal opened
  from `Quotes.jsx` has no request context, so this is ignored entirely
  when `embedded`. When present, an effect fetches that `quote_requests`
  row *and* the full product catalog (independently of the effect above
  that feeds `LineItemsEditor`'s own picker — a small, deliberate extra
  fetch to keep this self-contained) to pre-fill `clientId`/`notes` and,
  for each requested item, look up its *current* name/price by
  `product_id` — never anything from the request itself, which never had
  a price to begin with. A requested item whose product has since been
  deleted falls back to its own denormalized `description` snapshot with
  a `$0` price for staff to fill in manually — same as any other
  pre-existing line item; `catalogOnly` only restricts how *new* items get
  added, not editing ones already in state. Staff still reviews/adjusts
  quantities and can add more from the catalog same as always
  (`catalogOnly`). On a successful create, if `requestId` was set, the
  form calls `api.quoteRequests.linkQuote(requestId, quote.id, token)`
  before navigating away — best-effort: if that call fails (e.g. someone
  else already declined the request in the meantime), the quote itself
  was still created successfully, so the failure surfaces as a toast
  rather than stranding the user on the form. A successful link instead
  toasts "Quote created — the client can already see it in their
  portal." — a distinct confirmation from the plain navigate-to-the-new-
  quote that happens either way, since linking (not the later "Send"
  click) is what actually makes the quote visible to the client (see
  `CLIENT_VISIBLE_QUOTE` above), and that's easy for staff to miss
  otherwise.
- `pages/portal/PortalQuotes.jsx` gained a "Request a quote" button
  (header, `PlusIcon`) opening a `Modal` built around the same
  `LineItemsEditor` every quote/invoice form uses — `catalogOnly
  priceEditable={false} subtotalLabel="Estimated subtotal"` — so a client
  picks from the identical product catalog staff sees, with quantities
  freely editable but price shown read-only (a plain value, not an
  input), plus a caption clarifying the shown prices are current list
  prices and the final quote may differ. An optional "Anything else?"
  textarea below it covers what the catalog doesn't ("additional notes"
  now, not the primary input it used to be before the catalog existed).
  Submitting sends only `{ description, items: [{ product_id, quantity
  }] }` — `LineItemsEditor`'s own `unit_price` in local state is display
  data only, never part of the payload. A "Your requests" section above
  the existing "Sent to you" quotes list shows each request via the same
  `requestSummary()` helper `QuoteRequests.jsx` uses (item quantities/
  names, falling back to `description`), plus a `StatusBadge` and,
  depending on state: nothing more for `pending`; a `Link` straight to
  `/portal/quotes/:quote_id` ("Your quote (Q-2026-0001) is ready — view
  it") for `approved` (which, per `CLIENT_VISIBLE_QUOTE` above, always
  means the linked quote is already viewable — there's no separate
  "still being prepared" placeholder state to render once `approved`,
  since linking and portal-visibility happen in the same instant); the
  staff `decision_note` for `declined`. All three lists (`quotes`,
  `requests`, the product catalog for the picker)
  load independently on mount, so a freshly-submitted request or a
  newly-visible quote both refresh via the shared `load()` function after
  any action.

### Campaigns (bulk/promotional emails)

A newsletter/announcement send — the "send a customized email to clients,
single or bulk, for promotions/newsletters" ask. Deliberately its own
module rather than reusing `clients` or `email_center`'s admin-only gate:
every other client-facing email in this app is transactional, tied to one
recipient and one document (a quote, invoice, reminder, receipt, portal
invite) — a campaign has no document behind it, is inherently one-to-many,
and carries a different risk profile (one click can email the entire
client base), so it gets its own `MODULES` entry (`campaigns`,
`lib/permissions.js`) rather than folding into an existing grant the way
`routes/reports.js`/`routes/capitalContributions.js`/`routes/
quoteRequests.js` reuse `financials`/`expenses`/`quotes` — those all
reuse an existing slot because the *sensitivity level* already matched;
this one doesn't match anything else in the app closely enough to justify
that shortcut.

- `campaigns` (`db/index.js`, added fresh — a brand-new table, plain
  `CREATE TABLE IF NOT EXISTS`) is a **summary record per send**, not a
  per-recipient log — `id`, `subject`, `message`, `recipient_type`
  (`all` | `selected`), `recipient_count` (how many were targeted),
  `sent_count`/`failed_count` (a bulk send can partially fail — one
  client's address bounces — without the whole campaign failing, so this
  splits the outcome rather than a single pass/fail flag),
  `sent_by_name`, `created_at`. Each individual **successful** send is
  additionally logged to the existing `email_log` table (`type:
  'campaign'`, `entity_type: 'client'`, `entity_id`/`entity_label` the
  recipient) — the same double-logging (a summary to one table, each real
  send to `email_log`) every other client-facing send in this app already
  does, and the same "only log a send that actually succeeded" rule
  `lib/emailLog.js` documents for every other caller. `routes/
  emailCenter.js`'s `TYPE_LABELS` (the sent-log's human labels, not
  `lib/emailTemplates.js`'s — a campaign has no editable global template,
  see below) gained a `campaign: 'Promotional campaign'` entry so these
  sends show correctly in the Email Center's own sent log too, even though
  they also get their own dedicated history view on the Campaigns page.
- `routes/campaigns.js` (mounted at `/api/campaigns`) — `GET /`
  (`view`-gated) is always-paginated (`PAGE_SIZE = 20`, newest first),
  matching `routes/emailCenter.js`'s own sent-log convention rather than
  the business list routes' opt-in `?page=` (this is a chronological
  history feed, not a pickable list — nothing needs the full unpaginated
  array the way `SearchableSelect`-backed pickers do). `POST /`
  (`manage`-gated) is the one send action, and is deliberately the *same*
  route for both a bulk send and the Clients page's per-client single
  send — see `resolveRecipients()`: `recipientType: 'all'` targets every
  client with a non-blank email; `recipientType: 'selected'` (with a
  `clientIds` array) targets exactly those clients, and the single-client
  "Send email" shortcut on `Clients.jsx` is nothing more than `selected`
  with one id — there's no separate single-send code path or endpoint.
  Recipients are always resolved **server-side** from the `clients` table
  by id, never trusted from a client-submitted email address — the
  frontend only ever says *which* clients it means. 400s if `subject`/
  `message` is blank, if `selected` was chosen with no `clientIds`, or if
  the resolved recipient list is empty (nobody has an email on file).
  Sends are **sequential**, not `Promise.all` — a bulk send shouldn't open
  dozens of simultaneous SMTP connections, and at this app's
  single-business scale (a handful to low hundreds of clients) the extra
  wall-clock time is negligible; one recipient's rejected/invalid address
  is caught per-iteration and doesn't abort the rest of the run. If the
  very first `sendMail()` call fails with `EMAIL_NOT_CONFIGURED` (see
  `lib/mailer.js`), the route 503s immediately with no `campaigns` row
  written at all — same "abort cleanly, don't record a phantom send"
  behavior every other email-sending route in this app already has for a
  missing SMTP config. Every other per-recipient failure (a real send
  attempt that errors) is instead counted in `failed_count` and returned
  in the response's `failures` array (`{ client_id, name, error }`) so the
  frontend can report *which* recipients didn't get it, and the campaign
  row is still written — a partial failure is a normal outcome here, not
  an error state. One `logActivity()` summary entry per send
  (`action: 'sent campaign'`, `entity_label: '"<subject>" to N of M
  recipients'`) — one row per campaign, not one per recipient, same
  "summarize, don't spam the feed" precedent `routes/import.js`'s bulk
  imports already set for `activity_log`.
- **Unlike every other client-facing email in this app, a campaign has no
  admin-editable default template** in `lib/emailTemplates.js` — there's
  nothing to template: subject and message are original, one-off copy
  written fresh for each send (a newsletter, a promotion), not a
  recurring transactional message with a few `{{placeholder}}` values.
  `components/CampaignComposeModal.jsx` is the shared compose UI (used by
  both the Campaigns page's "New campaign" button and Clients.jsx's
  per-row action below) and, unlike `EmailPreviewModal.jsx`, opens to a
  **blank** subject/message rather than fetching a pre-filled default —
  there is no `GET .../preview` route to call. A plain-text `<textarea>`
  goes through the same `lib/mailer.js` `textToHtml()` every other
  send in this app already uses (paragraph/line-break conversion,
  URL auto-linkification, HTML-entity escaping) — no rich-text editor, no
  attachments (a campaign has no PDF to attach, unlike a quote/invoice/
  receipt send).
- **Recipient picker**: when opened from the Campaigns page (no
  `singleClient` prop), `CampaignComposeModal` fetches the full,
  unpaginated `clients` list on open (`api.clients.list(token)` with no
  `q`/`page` — the same "no page param means the whole array" convention
  `LineItemsEditor`'s own product picker already relies on) and offers two
  modes via a small pill toggle: **All clients** (every client with an
  email — the common case, no picker needed) or **Select clients** (a
  search-filterable checkbox list, `Select all`/`Clear` acting on whatever
  the search currently matches rather than the full list, so narrowing
  first then bulk-selecting is one motion instead of hand-ticking each
  box). A live "This will be sent to N client(s)." line and the Send
  button's own label (`Send` vs. `Send to N`) both track the resolved
  count before the request is ever made. When opened from `Clients.jsx`'s
  per-row action instead, `singleClient` is set and the whole picker is
  skipped entirely — just a read-only "To: {name} ({email})" line — since
  there's nothing to choose from a set of one.
- `pages/business/Campaigns.jsx` (route `/campaigns`, `Navbar.jsx` link
  right after Clients, gated on the new `campaigns` module) — a "New
  campaign" header button opening the compose modal in bulk mode, and a
  history feed below styled after `EmailCenter.jsx`'s own sent-log `<ul>`
  (not a table — same reasoning, this is a chronological feed, not a
  sortable/filterable record set), each entry showing the subject, a
  2-line-clamped message preview, `recipient_type` in plain English ("All
  clients" / "Selected clients"), the `sent_count`/`recipient_count`
  split (with `failed_count` called out in red when non-zero), who sent
  it, and when.
- **Per-client single send**: `Clients.jsx` gained a "Send email" row
  action (new `MegaphoneIcon` — deliberately distinct from the existing
  `SendIcon` paper-plane already used on this exact page for the portal-
  invite action a few pixels away, so the two don't read as the same
  action twice in one row; see `components/icons.jsx`'s own comment on
  why a campaign send is a broadcast, not a transactional document
  delivery, and gets its own glyph app-wide) opening
  `CampaignComposeModal` with `singleClient` set to that row, gated on
  `can('campaigns', 'manage')` — a **separate** permission from
  `can('clients', 'manage')`, since sending a promotional email and
  editing a client's contact record are different capabilities a staff
  member could hold independently. This is the one row action on this
  page not gated by the page's own `clients` permission, so the desktop
  table's trailing `<th>`/`<td>` and the mobile accordion's actions block
  are both gated on `(canManage || canSendCampaigns)` rather than
  `canManage` alone — otherwise a staff member granted `campaigns:manage`
  but not `clients:manage` would never see the actions column at all,
  even though `rowActions()` itself already checks each button's own
  permission correctly. Hidden entirely for a client with no email on
  file (nothing to send to), same as the portal-invite action's own
  `client.email`-independent guards elsewhere on this page.
- **License-related campaign shortcuts, on `Campaigns.jsx` itself**: two
  more header buttons, "Email cancelled clients" and "Notify price
  increase" — both open the same shared `CampaignComposeModal` as "New
  campaign," just pre-populated with a computed recipient list and a
  starting subject/message, via the identical `compose` state object
  `resendToFailed()` already builds (`presetClientIds`/`title`/
  `presetNote`/`defaultSubject`/`defaultMessage`, plus `mergeFields`/
  `recipientData` for the cancelled-clients case — see below). These two
  buttons originally lived on `pages/business/Licenses.jsx` (a business
  reason to reach for a license-specific campaign from the page already
  showing licenses) but were moved here on explicit request, since a
  bulk client email is squarely this page's own job regardless of which
  page's data seeded the recipient list; `Licenses.jsx` itself no longer
  imports `CampaignComposeModal` or the `campaigns` permission at all.
  "Email cancelled clients" (`openCancelledLicensesCampaign`) fetches
  every currently-`cancelled` license (`api.licenses.list(token, {status:
  'cancelled'})`), pre-selects the distinct set of clients that own one,
  and passes a `{{license_url}}` merge tag (`mergeFields`) with each
  client's own license `url` as `recipientData` — the one campaign on
  this page that isn't identical copy to everyone, since a client's own
  license link is specific to them; a client with more than one cancelled
  license just gets the first one found, since a single merge tag can
  only carry one value. `mergeFields` is the *hint* shown in the compose
  form (a `{{key}}` button next to the message box that inserts the tag
  at the cursor — see `CampaignComposeModal.jsx`'s own `insertMergeTag`);
  `recipientData` is the real `{ [clientId]: { key: value } }` map sent to
  `routes/campaigns.js`, which substitutes it per-recipient server-side
  through the same `renderTemplate()` every other transactional email in
  this app already uses. "Notify price increase"
  (`openPriceIncreaseCampaign`) instead fetches the full client list
  (`api.clients.list`) and the cancelled-license list together, then
  targets every client with an email on file *except* those with a
  currently-cancelled license (nothing to raise the price on if the
  license itself isn't active) — no merge fields, since this one really
  is identical copy to everyone. Both set a `campaignLoading` busy state
  (shared with nothing else on the page) while resolving recipients, and
  both write a default subject/message tuned for this specific ask
  (`CANCELLED_LICENSE_EMAIL_SUBJECT`/`_MESSAGE`,
  `PRICE_INCREASE_EMAIL_SUBJECT`/`_MESSAGE`, both top-of-file constants in
  `Campaigns.jsx`) — still just a starting draft the admin can freely
  edit before sending, same as `resendToFailed()`'s own preset. A
  successful send from either button goes through the exact same
  `handleSent()` the "New campaign"/"Resend to failed" flows already use
  (a toast, then reloading the campaign history feed), so these two don't
  need their own success-notice plumbing.

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

### Theme (light/dark mode)

- `context/ThemeContext.jsx` holds a 3-way stored preference, `theme` —
  `'light' | 'dark' | 'system'`, persisted to `localStorage`
  (`edusolution_theme`) — and resolves it to `resolvedTheme` (always
  `'light'` or `'dark'`, following the OS preference live via a
  `matchMedia` listener when `theme === 'system'`) which toggles the
  `dark` class on `<html>`. Components that just need to know which
  palette is active read `resolvedTheme`; `ThemeToggle.jsx` is the only
  place that offers the 3-way picker itself (`MODES = ['light', 'dark',
  'system']`, cycled by one click). **A visitor with nothing stored yet
  defaults to `'light'`**, not `'system'` — a first-time visitor on a
  device set to OS dark mode would otherwise land on a dark app with no
  indication that was ever a choice, since "system" was never something
  they actually chose. `index.html`'s pre-mount inline script (applies the
  `dark` class before React mounts, avoiding a flash of the wrong theme —
  `ThemeContext.jsx` re-derives and keeps it in sync afterward) mirrors
  this exactly: `isDark` is only ever true for `stored === 'dark'`, or
  `stored === 'system'` *and* the OS prefers dark — nothing-stored falls
  through to light, matching `ThemeContext.jsx`'s own default so the very
  first paint and React's first render never disagree. The three-way
  toggle itself is unaffected by this — anyone who explicitly picks Dark
  or System still gets exactly that, stored and honored on every future
  visit; only the unset, brand-new-visitor case changed.
- **Every form input needs its own explicit `dark:` classes** — there is
  no global rule making an `<input>`/`<textarea>`/`<select>` legible in
  dark mode; each one is themed individually
  (`dark:border-slate-600 dark:bg-slate-900 dark:text-white` is the
  standard trio, `dark:bg-slate-800` on a couple of pages that nest one
  level deeper). Tailwind's Preflight resets a form control's `color` to
  `inherit`, and without a per-field `dark:text-white` that resolves to
  whatever color the page happens to inherit — normally close enough to
  readable, but combined with Safari/WebKit's own independent tendency to
  paint native form-control chrome dark when the OS (not just this app's
  own `.dark` toggle) prefers dark, an unstyled field can end up
  dark-on-dark: a real dark background from the browser's own native
  styling, with black-ish inherited text sitting on top of it — invisible
  while typing, not just off-brand. `pages/business/Clients.jsx`'s and
  `pages/business/Expenses.jsx`'s modal forms shipped exactly this way
  (spotted from a phone screenshot in dark mode) — both are typical of
  every other resource's form (`Products.jsx`, `Settings.jsx`,
  `CapitalContributions.jsx`, etc.) in every other respect, just missing
  the `dark:` classes entirely on every field, label, and the Cancel
  button, apparently from whenever each form was last rewritten. Fixed by
  bringing both in line with the same pattern every other page already
  uses; a handful of other one-off misses turned up in the same sweep
  (`Users.jsx`'s reset-password modal input, the Notes `<textarea>` on
  `QuoteForm.jsx`/`InvoiceForm.jsx`/`RecurringInvoices.jsx`, and several
  `text-red-600` error messages across the app missing their
  `dark:text-red-400` pair) — same bug, same fix, different pages. There's
  no shared `<Field>`/`<Input>` component this could be centralized into
  today (each page defines its own local `Field` — see individual page
  notes below), so this is a check-every-form-by-hand problem: any new
  form field needs the same trio from the start, and an audit like this
  one (`grep` every page/component for `text-slate-`/`border-slate-`/
  `bg-slate-`/`bg-white` class usage with no `dark:` counterpart on the
  same line) is the fastest way to catch a page that was missed.

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
  `downloadFile()` is the equivalent for CSV/Excel/other exports that
  should force a real download rather than open in a tab (throwaway
  `<a download>` click) — it's format-agnostic (just fetches a URL as a
  blob and force-downloads it under a given filename), so it needed no
  changes when Excel exports were added, only new `exportXlsx()` entries
  alongside each resource's existing `exportCsv()`. Every list page that
  has an "Export CSV" button (`Clients.jsx`, `Quotes.jsx`, `Invoices.jsx`,
  `Expenses.jsx`, `CapitalContributions.jsx`, `Licenses.jsx`,
  `OwnerDraws.jsx` — see each resource's own `GET /export.csv`/
  `GET /export.xlsx` pair above) has a
  matching "Export Excel" button right next to it, wired to a
  `handleExportXlsx()` sibling of that page's existing `handleExportCsv()`
  (renamed from the original unqualified `handleExport()` once there were
  two formats to disambiguate between). The "Export Excel" button on each
  of those pages is `hidden sm:flex` — visible from `sm` up, hidden below
  it — while its "Export CSV"/"Analytics"/"New X" siblings in the same
  header row stay visible at every width; CSV is the one export format a
  phone can actually do anything with (a `.csv` opens in whatever the OS
  hands it to), while a `.xlsx` on a phone mostly just downloads a file
  with no obvious next step, and a header row that already carries up to 4
  buttons was tightest exactly on the narrow screens where the least-useful
  one added the least value. Desktop is unaffected — same 4 buttons, same
  order, same styling as before. `Products.jsx` and
  `RecurringInvoices.jsx` don't have either button — neither ever had a
  CSV export, and adding Excel-only export to just those two would be an
  inconsistent, half-applied pattern; add both formats together if export
  is ever wanted there. The `public` object (`getQuote`, `respondQuote`,
  `getInvoice`, `openQuotePdf`, `openInvoicePdf`) hits `/api/public/...`
  and is the one set of calls that never passes a token.
- `pages/Login.jsx` (routes `/` **and** `/login`, both public, both render
  this same component — see `App.jsx`) is the app's front door — there is
  no separate Landing page. This app has no public signup (see
  `routes/auth.js` above), so realistically every real visitor here is
  either signing in or already signed in; a standalone marketing page
  that isn't where you actually log in was friction, not value. The login
  form is the hero's primary element rather than a "Log in" button
  pointing at a separate page, and an already-authenticated visit (the
  Navbar brand link, a stale bookmark) redirects straight to `/dashboard`
  instead of showing a login form/marketing page with nothing left to do
  there — `Login` checks `token`/`loading` from `useAuth()` and renders
  `<Navigate to="/dashboard" replace />` once resolved, the same
  loading/token pattern `ProtectedRoute.jsx` uses (mirrored rather than
  shared, since the redirect target and the "what to show while deciding"
  differ). The actual form (email/password/forgot-password link/submit,
  plus the idle-logout and post-reset-password notice banner) is
  `LoginForm`, a local sub-component rendered inside `HeroLoginCard`
  (a soft blurred-gradient-circle backdrop) — kept separate from the
  exported `Login` component so the redirect-when-authenticated check
  above doesn't have to sit inside (and re-render with) the form's own
  state.

  The page below the hero is intentionally light: a hero (eyebrow pill,
  "Welcome to Edu Solutions" headline, business-description paragraph,
  "Visit edusolutionsmaldives.com" link), then a single EduPage panel, then an
  "Our mission" section, then the closing wordmark/link section. The
  hero's two-column grid (stacked on mobile, `lg:grid-cols-2` side by side
  on desktop) puts the login form *first* in source order — so it's what a
  phone visitor sees before any marketing copy — and only reorders to
  copy-left/form-right via `lg:order-1`/`lg:order-2` once there's room for
  both side by side, on the reasoning that most visitors here just want
  to sign in, not read about the product first. A `font-display`
  sub-headline ("From your first quote to the final payment — all handled
  in one place.") and a row of `CheckCircleIcon` trust bullets (PDF
  invoicing, client self-serve links, automated reminders, recurring
  billing, role-based access) both sat under the headline at one point but
  were cut for a tighter hero — along with the 6-card feature grid
  (Clients/Quotes/Invoices/Payments & financials/Recurring & reminders/
  License tracking) and a "How it works" 3-step section that existed here
  too. All were removed outright rather than kept around unused —
  `components/icons.jsx`'s `SendIcon` (only ever used by "How it works")
  was deleted with it.

  The EduPage panel is its own section (`bg-slate-50`, bordered
  `rounded-2xl` card, centered `max-w-3xl`) rather than folded into
  anything else: a mention of EduPage (aSc EduPage, `edupage.org`) — a
  real, separate school-management platform (timetabling, attendance,
  digital class registers, homework, e-learning), unrelated to the
  billing tools this app itself provides. Its copy states the actual
  business relationship directly — **"Edu Solutions Pvt Ltd is an
  authorized distributor of EduPage products in the Maldives"** — a
  specific, verified business fact that any future copy pass on this page
  must keep verbatim rather than softening into vaguer phrasing. Icon is
  `GraduationCapIcon` (`components/icons.jsx` — added because none of the
  CRM/billing icons fit "a school platform," and reusing `UsersIcon`/
  `LicenseIcon` here would borrow an icon that carries a different
  meaning elsewhere in the app), under a "Technology partner" eyebrow,
  with a "Learn more about EduPage" link out to `edupage.org`
  (`target="_blank"`) — the genuine, verifiable product this refers to.

  "Our mission" (eyebrow "About EduSolutions Maldives") sits on a plain
  (non-`bg-slate-50`) background with its own `border-b`, so it doesn't
  read as visually identical to the EduPage panel's `bg-slate-50` section
  right above it. The old Landing page's CTA band ("Ready to get started?
  Log in") was dropped rather than carried over — it would just be a
  second, redundant "Log in" pointing at a form already visible at the
  top of the same page.
- `pages/` — one component per route (`Login`, `ForgotPassword`,
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
  feature existed. `pages/EmailCenter.jsx` (route `/email-center`) uses the
  same `can(module, 'view')` guard pattern as everything else — it used to
  check `user?.role === 'admin'` directly instead, back when this page was
  admin-only with no gatable module of its own, but see "Super admin and
  the Finance permission preset" above for why that changed once
  `email_center` became a real `MODULES` entry. `canManage` (`can
  ('email_center', 'manage')`) additionally gates every template's Save/
  Reset controls — a view-only grant shows the current subject/message
  read-only. It has two sections: **Templates**, a `TemplateCard` per editable type (the 4 from
  `api.emailCenter.templates()`) with editable Subject/Message fields,
  a `{{placeholder}}` reference line built from each template's
  `placeholders` array, a "Customized" badge and "Reset to default" button
  shown only when `template.isCustom`, and a "Save" button disabled until
  the local draft actually differs from the loaded template (`dirty`) —
  both actions re-fetch the full template list afterward so `isCustom`
  never drifts from the server; and **Sent log**, styled after
  `ActivityLog.jsx`'s plain `<ul>`/`<li>` list (not a table, so it sidesteps
  the mobile-accordion-table convention entirely) reading
  `api.emailCenter.log()` and paged with the shared `<Pagination>`
  component rather than `ActivityLog.jsx`'s own older hand-rolled
  Previous/Next buttons. `ForgotPassword`/`ResetPassword` are public routes;
  `ResetPassword` reads its token from `useSearchParams()` and, on success,
  navigates to `/login` passing a message via router state (shown as a
  banner on the login page). `PublicQuote`/`PublicInvoice` (routes `/q/:token`
  and `/i/:token`) are also public — they render a read-only view of a
  quote/invoice by its `public_token` via `api.public.*`, with a "Download
  PDF" button and, on quotes still `draft`/`sent`, Accept/Decline buttons.
  These pages exist *outside* `ProtectedRoute` and never touch
  `AuthContext`/`localStorage`. Both render no header of their own — they
  rely entirely on the shared global `Navbar` (mounted unconditionally at
  the app root, on every route). Navbar's own logged-out branch normally
  shows a "Log in" button, but hides it specifically on these two routes
  (`isPublicDocLink`, checked via `location.pathname.startsWith('/q/')` or
  `'/i/'`) — a client opening one of these links has no account and no
  reason to see an invitation into staff-only auth; every other public
  route (`/`, `/login`, `/forgot-password`, `/reset-password`) is
  unaffected and still shows it. `ThemeToggle` stays visible either way —
  hiding it too would leave a client stuck on whichever theme happened to
  resolve, with no way to switch.
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
  backend's "has recorded payments" guard). A separate `canVoid` check
  (`status` is `draft` or `sent`, and `amount_paid === 0`) mirrors the
  backend's `POST /:id/void` guard exactly, so the "Void" button never
  shows for a click that would just 409 — it's deliberately independent of
  `isLocked`/`canManage && !isLocked`, since voiding a `sent` invoice is
  the one action allowed precisely where editing is locked. Voiding
  `confirm()`s, then calls `api.invoices.void` and reloads; a
  `status === 'void'` notice ("excluded from financial totals and
  reports") renders next to the existing locked-status one. "Email to
  client", "Send reminder", and the Payments card's "Record payment"
  action are all additionally gated on `invoice.status !== 'void'` (the
  first two on top of their own existing conditions) — voiding a client's
  invoice shouldn't leave buttons around that would just error against the
  backend guards described above. `InvoiceDetail.jsx`'s "Record
  payment" button (`togglePaymentForm`) pre-fills the form's Amount field
  with `invoice.balance_due` each time the form is *opened* (not on
  close) — paying off the full remaining balance is the common case, and
  the field is still freely editable for a partial payment; the `max`
  attribute already capped it at `balance_due` before this. Re-opening
  after closing always re-syncs to the current balance rather than
  leaving behind whatever was last typed. Any page that calls
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
  **Compact two-column layout**: the metadata fields above the line-items
  editor sit in a `grid grid-cols-2 gap-3`, Client on its own full-width
  row (`col-span-2` — a `SearchableSelect` combobox reads awkwardly
  squeezed into a narrow column) with the short fields below it paired by
  what they're actually about rather than left in whatever order the state
  variables happen to be declared: Issue date next to Expiry date/Due date,
  Tax rate next to Discount type, Discount value next to (for invoices)
  PO number — an even number of fields on `InvoiceForm.jsx` fills every row
  exactly, `QuoteForm.jsx`'s one field fewer leaves Discount value alone in
  a trailing row, which reads fine. This mirrors `Licenses.jsx`'s own
  create/edit form, already built this way (Client/License name/Activation
  URL each full-width, Billing cycle+Renewal amount and Start date+Expiry
  date paired) — these two forms were brought in line with that existing
  precedent rather than the reverse. The grid is unconditionally two
  columns, not `sm:grid-cols-2` — asked for directly, so the pairing holds
  even on a phone rather than collapsing to one column below `sm:`; checked
  down to a 320px viewport (the narrowest realistic phone width) where the
  date inputs/"Percentage" dropdown text clip slightly but nothing overflows
  the page or becomes unreadable, and 375px and up (the large majority of
  real phones) has full room to spare.
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
  why). An optional `onProductTaxRate(rate)` callback fires every time the
  item list changes (add, remove, or a qty/price edit), passed a *weighted
  average* of every current line item's originating product tax rate
  (weighted by that item's amount, via `weightedTaxRate()`/
  `taxRateForItem()` in the same file) — `QuoteForm.jsx`/`InvoiceForm.jsx`
  wire this straight to their own `setTaxRate`, so the document's single
  tax-rate field (see `routes/products.js` above for why this is
  document-level, not per-line-item) always reflects the current cart
  rather than a snapshot of whichever product was picked last. Since a
  catalog-sourced item's `description` is always exactly its product's
  `name` (readOnly in `catalogOnly` mode — see below), `taxRateForItem()`
  recovers each item's rate by matching on that name against the current
  `products` list rather than needing a separate field on the item — this
  also makes an *existing* quote/invoice being edited fully dynamic again
  the moment any item is added/removed/edited, with no extra state to load.
  Manually editing the Tax rate field directly still works, but the next
  item add/remove/edit recomputes and overwrites it — that's the intended
  trade-off of making the field derived from the cart. A `catalogOnly`
  boolean prop (set by
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
  `Licenses.jsx` (route `/licenses`) is the same list+inline-modal-form+FAB
  pattern once more, with two additions on top: a KPI summary strip
  (`KpiCard`s for Active/Expiring soon/Expired/Cancelled counts, from
  `api.licenses.summary()` — independent of the list's own pagination/
  search/`?status=` filter, called on load and refreshed after every
  mutation via a local `loadSummary()`) and a `rowActions()` helper shared
  between the desktop table's action cell and each mobile
  `MobileListAccordion` card's expanded body, since both need the exact
  same conditional Renew/Cancel/Reactivate/Remind/History/Edit/Delete
  buttons and duplicating them would drift. Renew and Remind buttons are
  conditioned on the row's raw `status` (`active`/`cancelled`), not the
  computed `display_status` — a lapsed-but-not-cancelled license
  (`display_status: 'expired'`) still shows both, mirroring
  `routes/licenses.js`'s own guards exactly (Renew is blocked only by
  `cancelled`, not by having already expired — that's the whole point of a
  renew button). **Cancel**/**Reactivate** (`status === 'active'` /
  `status === 'cancelled'` respectively) are one-click, confirm-then-act
  actions — the same `useConfirm()` pattern every other lifecycle action in
  the app uses — that PUT the full record back with only `status` flipped;
  `l` (the list row) already carries every field `PUT /:id` requires, so no
  extra `GET /:id` round-trip is needed first. These were added because
  `cancelled` is a real, stored license status (`Licenses.jsx`'s own
  `STATUS_OPTIONS` filter chip, `KpiCard`, `ACCENT` map) that, before this,
  had no dedicated action anywhere — the *only* way to reach it was to open
  Edit and change the Status dropdown buried at the end of the form, which
  most people never discover is there. The Edit form's Status field
  (`active`/`cancelled`, only rendered while editing an existing license —
  `editingId` truthy, since a brand-new license is always created `active`)
  still exists as a secondary path and is left unchanged; Cancel/Reactivate
  don't replace it, they just make the same transition discoverable as a
  real button instead of a hidden form field, matching how every other
  status-changing action in the app (Void, Renew, Delete) already gets a
  dedicated button rather than living only inside a generic edit form. A
  shared `busy` state (`{ id, action }` rather than a bare id) tracks which
  row *and which specific action* is in flight, so Renew/Cancel/Reactivate
  on the same row each show their own correct busy label instead of all
  three reacting to any one of them being clicked. Mobile cards get the
  same accent-stripe treatment as `Invoices.jsx`/`Quotes.jsx`, keyed off
  `display_status` via a local `ACCENT` map (emerald/amber/red/slate for
  active/expiring_soon/expired/cancelled). Amounts use plain
  `.toFixed(2)`, not `lib/money.js`'s compact formatter — per that file's
  own scoping note, compacting is for Dashboard/Financials summary views,
  not a list page reviewing individual records. A "History" action (in the
  same `rowActions()` set as Renew/Remind/Edit/Delete, so it appears in
  both the desktop table's action cell and each mobile card's expanded
  body) opens a `Modal` listing that license's renewal log from `GET
  /:id/renewals` — fetched fresh on open (no caching across opens, mirroring
  `EmailPreviewModal`'s own "fetch on open" pattern rather than prefetching
  history for every row up front), each entry showing just the renewal date
  and the previous→new expiry it produced (`renewed_at.slice(0, 10)` for
  the date, since `renewed_at` is a full datetime but every other date
  shown in this app's UI is date-only), newest first, with a "No renewals
  recorded yet." empty state for a license that's never been renewed.
  The form's "Activation URL"
  field (a plain `type="url"` input, spanning both grid columns like
  "License name" above it) is captured on create/edit and round-tripped
  through `startEdit()` the same as every other field — unlike "Notes"
  below it, though, it **is** rendered outside the form: its own "URL"
  column in the desktop table and its own conditional mobile-accordion
  row (see `routes/licenses.js` above for the exact shape and why it's
  worth showing — a link staff need to actually click, not free-text
  worth hiding behind a tap the way `notes` is).
  **Row actions as icon buttons**: `rowActions()`'s Renew/Cancel/Reactivate/
  Remind/History/Edit/Delete buttons render as compact icon-only buttons
  (`components/IconActionButton.jsx` — see "Icon action buttons" below)
  rather than bare colored text — this page in particular can show up to 6
  actions per row, so a row of plain text links read as clutter rather than
  distinct actions; this was in fact where the whole app-wide icon-button
  convention started, before being extracted into that shared component and
  rolled out everywhere else. Each button keeps a `title` (doubling as the
  busy-state label, e.g. "Renewing…") and an `aria-label`/`label`, since the
  icon alone carries the action's meaning for a sighted mouse user but not
  for anyone else; Renew additionally spins its `RefreshIcon` while busy
  (`IconActionButton`'s `spinning` prop) as a literal loading indicator,
  which a static icon like Cancel's `XIcon` or Reactivate's
  `CheckCircleIcon` wouldn't read as meaningfully mid-action. The header's
  own Analytics/Export CSV/Export Excel/New license buttons gained a
  leading icon each too (`ReportIcon`, `DownloadIcon` ×2, `PlusIcon`)
  rather than staying bare text. `components/icons.jsx` gained several new
  icons for this pass — `RefreshIcon`, `BellIcon`, `HistoryIcon` (a clock
  with a back-arrow tail, deliberately distinct from the plain `ClockIcon`
  already meaning "expiring soon" on this same page's KPI strip),
  `PencilIcon`, `TrashIcon`, `DownloadIcon`, `PlusIcon` (kept separate from
  `FloatingActionButton.jsx`'s own private inline `PlusIcon` rather than
  consolidating the two, since that refactor wasn't otherwise in scope),
  `SendIcon`, and `DuplicateIcon` — see "Icon action buttons" below for the
  full list and where each is used.
  `ActivityLog.jsx` is a simple paginated read-only list. `Import.jsx` (linked from `Settings.jsx`, not a top-level
  Navbar item — it's a rare-use admin tool) reads a chosen CSV file
  client-side via `FileReader`, calls `api.import.run(type, csv, commit,
  token)` first with `commit: false` to preview, then again with `commit:
  true` after the user reviews the row-by-row results and confirms —
  mirrors the two-phase `POST /api/import/:type` contract exactly, the
  frontend does no CSV parsing of its own. Per-type CSV templates are
  generated client-side as static strings and downloaded via a blob URL,
  the same throwaway-`<a>` pattern as `downloadFile()` in `lib/api.js`.
  The same page also renders `DangerZone` (see `routes/dataReset.js`
  above) at the bottom, but only when `isAdmin` — checked
  directly against the role (either admin tier, see `useAuth()`'s
  `isAdminRole`-backed check), not `can('import', 'manage')` like the rest
  of this page, since a staff member could be granted that permission
  without being trusted with a bulk, unrecoverable delete. Its per-type
  `ResultsTable` (row/status/item/message) was pulled out into
  `components/ImportResultsTable.jsx` once a second caller needed the
  identical table — see `pages/business/Products.jsx`'s own embedded
  import flow below — rather than staying a private component only
  `Import.jsx` could reach.
  **Products import, embedded on the Products page itself**: unlike most
  importable entities, which only have the generic `Import.jsx` flow,
  `pages/business/Products.jsx` also gets its own "Import CSV" header
  button (next to "New product", `UploadIcon` — the reversed-arrow
  counterpart to `DownloadIcon`, see `components/icons.jsx`) opening a
  local `ImportModal` sub-component — asked for directly on this page
  rather than sending someone to the standalone Import page just to bring
  in a product catalog. It's a genuinely separate, page-scoped React
  component (not a shared one), but talks to the exact same
  `POST /api/import/products` endpoint via `api.import.run('products', ...)`
  and reuses the shared `ImportResultsTable` above, so the preview-then-
  confirm contract, validation, and result rendering can never drift from
  the standalone Import page's own `products` type — only the surrounding
  chrome (no type selector, a fixed products-only column hint, a `Modal`
  instead of a full page) differs. `PRODUCTS_CSV_TEMPLATE` is a duplicated
  copy of `Import.jsx`'s own `products` entry in its `TEMPLATES` map
  (same acceptable-duplication precedent `EXPENSE_CATEGORIES` sets between
  `routes/expenses.js` and `routes/import.js` — keep both in sync if the
  columns ever change) rather than importing across two page files for one
  string. On a successful commit with `imported > 0`, the modal calls the
  page's own `load()` (passed in as `onImported`) so the product list
  behind it refreshes without the user having to close the modal and
  reload manually.
  **Expense import, embedded on the Expenses page**: the same pattern
  again, this time for `routes/import.js`'s general `expenses` type —
  `pages/business/Expenses.jsx` gets an "Import CSV" header button
  (between "Export Excel" and "New expense", same `UploadIcon`) opening
  its own local `ImportModal`, a near-identical copy of `Products.jsx`'s
  (fixed column hint instead of a type selector, same preview-then-confirm/
  `ImportResultsTable` contract calling `api.import.run('expenses', ...)`).
  This one file handles every category at once, currency exchange
  included — a row's own `category` column decides what it becomes, and
  only a `currency exchange` row needs `exchange_rate` filled in, exactly
  matching the manual form's own validation. This modal originally called
  the dedicated `currency-exchange` type instead (forcing every row to
  that one category, with no `category` column in the CSV at all) — asked
  for first, and genuinely simpler for a file that really was 100%
  currency exchange rows, but it meant a business with a mixed batch of
  real expenses had to split it into two separate files and two separate
  imports just to bring everything in. Switched to the general `expenses`
  type once that gap was pointed out, so this one button now covers
  everything a business would actually want to bulk-import here in a
  single pass. `EXPENSES_CSV_TEMPLATE` duplicates `Import.jsx`'s own
  `expenses` template entry (deliberately showing a mix of categories,
  including one currency-exchange row, since demonstrating that mix is
  the whole point of this template now), same reasoning
  `PRODUCTS_CSV_TEMPLATE` above already documents. `onImported` is wired to
  the page's own `load()` the same way, so a successful import refreshes
  the expense list (and, since currency-exchange rows are visible there
  too, the page's own currency-exchange summary once it's re-fetched)
  without a manual reload. The standalone Import page's own dedicated
  `currency-exchange` type (see `routes/import.js` above) is untouched and
  still available there — it's still a real convenience for a file that's
  genuinely 100% currency exchange rows and would rather skip repeating
  that column value on every line, it just was never the right default
  for the page where most expenses actually get created.
- `components/GlobalSearch.jsx` — a debounced (250ms) search box that calls
  `api.search.query()` and renders a grouped dropdown (clients/quotes/
  invoices/expenses); clicking a result navigates there. Mounted three times
  in `Navbar.jsx` — once in the desktop nav (`hidden ... xl:flex`, narrower
  via a `className` override since the nav row also has to fit up to 15
  links plus the account/theme/logout controls), once in the tablet
  hamburger drawer, and once in the phone-only search toggle row (both of
  the latter two keep the component's own default `max-w-xs`, uncapped by
  the nav row's space pressure) — all three exist in the DOM simultaneously
  regardless of which is currently visible, so anything that queries this
  input in tests must scope to the visible one. Has its own inline `×` clear
  button (same `aria-label="Clear search"` pattern as `SearchInput.jsx`, but
  hand-rolled since this component doesn't use `SearchInput` — it needs the
  dropdown-open behavior `SearchInput` doesn't have) that appears whenever
  `query` is non-empty and resets it to `''`. **The desktop instance's
  `className` was originally `max-w-[110px] shrink-0 2xl:max-w-[220px]`** —
  narrow enough that the "Search everything…" placeholder rendered as an
  illegible "Searc" fragment below the `2xl` breakpoint (1536px), the one
  width band (`xl` to `2xl`, 1280–1535px) most desktop users actually sit
  in. Bumped to `max-w-[200px] shrink-0 2xl:max-w-[280px]` — wide enough to
  read the placeholder (and most typed queries) at every desktop width, not
  just `2xl`+. The extra width comes out of `.nav-links-scroll`'s own
  budget, not by breaking the row — that container already carries
  `min-w-0 overflow-x-auto` specifically as the pressure-release valve for
  "the nav has more links than fit" (see its own comment in `Navbar.jsx`),
  so a wider search box just means the link strip's own internal horizontal
  scroll kicks in a little sooner, never the reverse (the search box or the
  "Log out" button getting squeezed out).
- `components/SearchInput.jsx` — the search box used by every business list
  page (Clients/Products/Expenses/CapitalContributions/Quotes/Invoices/
  RecurringInvoices/Users/Licenses). Renders a leading search icon and,
  whenever `value` is non-empty, a trailing `×` clear button
  (`aria-label="Clear search"`) that calls `onChange('')` — the one place
  this behavior is implemented, so every page using `SearchInput` gets it
  for free rather than each page wiring up its own clear button. Its
  wrapping `<div>` on every one of those pages is `sm:max-w-sm` (or
  `flex-1 sm:max-w-sm` on `Expenses.jsx`/`CapitalContributions.jsx`, which
  place it in a flex row next to a payee/contributor filter) — **not** a
  bare `max-w-sm`. Below `sm` (640px) the box is full width, matching every
  other element on the page (header buttons, list cards); at `sm` and up it
  settles to the fixed 384px look. A bare `max-w-sm` looked fine on a
  narrow phone (its content width already sits under 384px, so the cap
  never actually bound) but visibly clipped the box short of the page's own
  right margin on any phone wider than ~416px in portrait (large phones —
  iPhone Pro Max and similar, and most phones in landscape) — the search
  box stopped 384px from the left while the header buttons and list cards
  around it still reached the true edge, a 14px-ish gap that read as a
  layout bug rather than a deliberate size. Gating the cap behind `sm:`
  fixes this the same way `Expenses.jsx`'s/`CapitalContributions.jsx`'s own
  payee/contributor filter (`w-full max-w-xs sm:w-56`) already avoided it.
- `lib/useDebouncedValue.js` — `useDebouncedValue(value, delayMs = 300)`
  returns a copy of `value` that only updates once `value` stops changing
  for `delayMs`. Every business list page's `search` state feeds this
  (`const debouncedSearch = useDebouncedValue(search)`) and it's
  `debouncedSearch`, not the raw `search`, that actually drives the fetch
  (see `Pagination.jsx` below) — the `<SearchInput>` itself is still bound
  to the raw, undebounced `search`/`setSearch`, so the input's own text
  updates instantly on every keystroke with no typing lag. Before this
  existed, every page's fetch ran directly off `search`, so each keystroke
  fired its own request and flipped the list between its loading skeleton
  (a fixed row count/height, see `Skeleton.jsx`) and the real, differently-
  sized results — the page's content visibly jumped up and down while
  someone was still typing. Debouncing means that swap happens once, after
  the person pauses, instead of once per character. **Debouncing alone
  didn't fully fix it, though** — every list page's `load()` still called
  `setLoading(true)` unconditionally on every refetch, including the one
  debounced fetch that does fire, so the list still flashed real-content →
  skeleton → real-content once per search (skeleton's `TableSkeleton`
  always renders a fixed 5 rows, matching neither the old nor the new
  result count). On a page whose content already exceeded one screen
  (`Licenses.jsx` most visibly, with its KPI summary strip on top pushing
  total height past the fold even with few rows) that extra skeleton-shaped
  height swing was still a real, visible jump; pages with shorter content
  just didn't visibly move since the whole page stayed under one viewport
  regardless. Fixed by gating the `setLoading(true)` call on there being no
  data yet — `if (licenses.length === 0) setLoading(true)` (and the
  equivalent per page's own list variable) — so only the true first-ever
  load shows the skeleton; every later refetch (search, filter, status,
  page change) keeps the current rows on screen until the new ones arrive
  and swaps directly, one clean transition instead of two. The
  `useEffect(load, [...])` on every one of these pages needs a
  `// eslint-disable-next-line react-hooks/exhaustive-deps` immediately
  above it now, since `load` reads `licenses.length` (etc.) without it
  being a declared dependency — deliberately: adding it would re-run the
  effect (and refetch) every time the list itself changes, i.e. after every
  successful fetch, an infinite-ish loop. `GlobalSearch.jsx`
  already had its own hand-rolled 250ms `setTimeout` debounce before this
  and wasn't changed to use this hook — its debounce only delays the
  dropdown's own fetch, nothing about its layout reflows while typing (the
  results render into an `absolute`-positioned dropdown, not page flow), so
  it never had this bug and didn't need the fix.
- `components/Pagination.jsx` — the shared Previous/Next pager for every
  server-paginated list page, extracted from the pattern
  `pages/business/ActivityLog.jsx` established first. Takes
  `{ page, totalPages, onChange }` — the same `{ page, totalPages }` shape
  every paginated list endpoint's response carries (see "Pagination
  convention" above) — and renders nothing when `totalPages <= 1`. Every
  list page that fetches with a `page` state variable follows the same
  shape: `useEffect` re-fetches on `[token, debouncedSearch, page]` change,
  a separate `useEffect` resets `page` back to `1` whenever `debouncedSearch`
  changes (so a new search always starts from page 1 instead of potentially
  landing past the end of the filtered result set), and the response's
  pagination fields are stored separately from the list itself (e.g.
  `pageInfo`) so `<Pagination>` only renders once a paginated response has
  actually come back (i.e. `pageInfo` stays `null` until a `page` param was
  sent and `totalPages` was present in the response).
- `components/MobileListAccordion.jsx` — every list page's table
  (`Invoices.jsx`, `Quotes.jsx`, `Clients.jsx`, `Products.jsx`,
  `Expenses.jsx`, `RecurringInvoices.jsx`, `pages/Users.jsx`) renders
  twice below the `sm` breakpoint's split: the existing `<table>`
  unchanged, now wrapped in `hidden overflow-x-auto sm:block`, and a
  second `sm:hidden` block that maps the same row data through
  `MobileListAccordion` instead — one per row, each a native
  `<details>/<summary>` (same convention as `components/Accordion.jsx`,
  no JS breakpoint detection) collapsed to just the columns a user scans
  the list by (e.g. invoice number + client name + status badge for
  Invoices), expanding on tap to the row's remaining fields as `dt`/`dd`
  pairs — the same visual pattern `InvoiceDetail.jsx`/`QuoteDetail.jsx`
  already use for their own detail sections. This replaces relying on
  horizontal scroll to read a wide table on a narrow screen. Every row in
  one rendered list shares a single `name` prop (e.g. `"invoices-list"`),
  which the native `<details name>` behavior (Chrome/Edge 120+, Safari
  17.2+, Firefox 125+) uses to keep at most one row open at a time within
  that list — opening a row auto-closes whichever other row in the same
  group was open, no JS state needed; each rendered list on a page (e.g.
  `InvoiceDetail.jsx`'s Payments sub-table alongside its own Items list)
  uses a distinct `name` so they don't cross-close each other. Any
  interactive element placed inside a row's `summary` (the number/name
  `Link`) needs its own `onClick={(e) => e.stopPropagation()}`, same
  reasoning as `Accordion`'s own `action` prop — otherwise tapping it also
  toggles the row open/closed. There's deliberately no bulk-select
  checkbox in any row's summary, desktop or mobile — `Invoices.jsx`,
  `Quotes.jsx`, `Clients.jsx`, and `Expenses.jsx` used to have one (a
  header "select all" checkbox, a per-row checkbox, and a `BulkActionBar`
  with a bulk-delete button, backed by `lib/useUndoableDelete.js`), but
  multi-select delete was removed outright — deleting is single-row only
  now, via the existing per-row `Delete` button (`Clients.jsx`/
  `Expenses.jsx`/`Quotes.jsx`/`Invoices.jsx` — see "Quote/invoice row
  actions" below for the latter two, added after this bulk-select removal)
  or from the record's own detail page. `components/BulkActionBar.jsx` was deleted along with its
  last caller. `lib/useUndoableDelete.js` itself is unrelated to bulk
  specifically — it's the delete-with-a-few-seconds-to-undo pattern
  `Clients.jsx`/`Expenses.jsx` still use for their single-row `Delete`
  button, `deleteWithUndo(ids, label)` just happens to take an array
  (originally shared with the now-removed bulk flow) that every remaining
  caller passes as a single-element array.
  `Expenses.jsx`'s Total row (the desktop table's `<tfoot>`) has a
  matching flex row rendered once below the mobile accordion list, not
  per-row. Loading (`TableSkeleton`) and empty (`EmptyState`) states are
  unchanged and shown at both breakpoints — only the *populated* list
  gets the responsive split, wrapped in its own `overflow-x-auto` so a
  brief loading flash can't cause a mobile horizontal scrollbar now that
  the outer card container itself no longer carries `overflow-x-auto`
  unconditionally. The same split extends to every other wide table in
  the app, not just the top-level list pages: `Financials.jsx`'s Recent
  Payments table uses `MobileListAccordion` the same way (receipt/invoice/
  client/date collapse under invoice number + client + amount). Two
  tables get a *plain* mobile stacked-card list instead of an accordion —
  `InvoiceDetail.jsx`/`QuoteDetail.jsx`'s Items table (also reused,
  unauthenticated, on `PublicInvoice.jsx`/`PublicQuote.jsx`) — because a
  line item's four fields (description, qty, unit price, amount) are all
  already essential and shown at once; there's nothing left to hide behind
  a tap, so wrapping it in a collapsed `<details>` would just add a
  pointless extra tap with no payoff. `InvoiceDetail.jsx`'s Payments
  sub-table *does* still get the full `MobileListAccordion` treatment
  (receipt/date/amount summary, Method + Download/Email actions in the
  expanded body) since it has real detail worth collapsing behind a tap,
  same as the top-level list pages. **This split is the standing
  convention for every table in the app, not a one-time cleanup** — any
  new `<table>` (a new list page, a new sub-table on a detail page) needs
  the same `hidden overflow-x-auto sm:block` desktop wrapper plus a
  `sm:hidden` mobile counterpart rendered from the same row data, not a
  bare table left to horizontal-scroll on narrow screens. Pick
  `MobileListAccordion` when a row has real detail worth collapsing behind
  a tap (the common case — most rows have more fields than fit in a
  one-line summary); use a plain stacked-card list only when every column
  is already essential and short enough to show at once with nothing left
  to hide (the Items-table case above is the only current example).
  Each row is its own floating card (`rounded-2xl border shadow-sm`), not
  a flat divided list — callers wrap their set of rows in `flex flex-col
  gap-2.5` rather than `divide-y` (the mobile visual redesign pass, see
  "Mobile design system" below). An optional `accent` prop (a Tailwind
  `bg-*` class, e.g. `bg-red-500` for an overdue invoice) renders as a 4px
  left stripe — `Invoices.jsx`/`Quotes.jsx`/`Licenses.jsx` are the callers
  that pass it (via a local `ACCENT` map keyed by status, mirroring
  `StatusBadge`'s own color semantics), everything else omits it since
  Clients/Products/Users/etc. have no comparable per-row status dimension.
  That stripe is
  rendered on a plain wrapping `<div>` around `<details>`, not inside
  `<details>` itself — Chrome 120+ wraps a `<details>`'s post-summary
  content in an internal `::details-content` box that collapses to zero
  height while closed, which silently breaks `inset-y-0`-style stretching
  (or any percentage-height child) placed directly inside `<details>`; the
  wrapping div sidesteps that native quirk while `<details>`/`<summary>`
  still own the open/close behavior and the `name`-grouped exclusive-open
  behavior described above unchanged.
- `components/Modal.jsx` — the shared popup styling for every "New X" (and
  reused "Edit X") entry form, the Licenses "History" log, and every other
  small popup in the app: the same dimmed backdrop + centered white card
  treatment as `IdleTimeoutMonitor`'s "Still there?" warning, just
  wider/scrollable (`maxWidthClass`, default `max-w-lg`) to hold a form
  instead of a couple lines of text. Takes `{ open, onClose, title,
  children, maxWidthClass }`; closes on Escape or a click on the dimmed
  backdrop (via `document.body.style.overflow = 'hidden'` while open, so the
  page behind can't scroll), in addition to whatever the caller wires up
  inside (a Cancel button, a successful save). The backdrop is
  `items-center` at every breakpoint, not just `sm:` and up — it used to be
  `items-start` (pinned to the top of the viewport) below `sm`, but a
  vertically centered popup is the expected default on mobile just as much
  as desktop, so this app keeps that consistent everywhere rather than
  special-casing small screens. When content is taller than the viewport,
  `overflow-y-auto` on the backdrop still makes it scrollable — a form long
  enough to overflow (e.g. `QuoteForm.jsx`/`InvoiceForm.jsx` with several
  line items) simply loads scrolled to its own top rather than the backdrop
  clipping it, so nothing above the fold becomes unreachable. Any new modal
  treatment added later should keep this centered-by-default behavior
  rather than reintroducing a top-aligned mobile layout. `Clients.jsx`, `Products.jsx`,
  `Expenses.jsx`, `RecurringInvoices.jsx`, and `Users.jsx` (both its
  create/edit form and its separate reset-password form) each wrap their
  existing inline `{showForm && (<form>...)}` block in `<Modal>` instead of
  a plain `<div>` — the toggle state (`showForm`/`editingId`) is unchanged,
  only the presentation moved off the page flow and into the popup, and the
  submit-error `<p>` moved inside the modal (with a lighter one still at
  page level for load/delete/export errors, since those can happen while no
  modal is open). `QuoteForm.jsx`/`InvoiceForm.jsx` are the more involved
  case, since `/quotes/new`/`/quotes/:id/edit` (and the invoice equivalents)
  are routed pages, not inline toggles: both components now accept optional
  `{ embedded, idOverride, onSuccess, onCancel }` props. Rendered with no
  props (the default, from `App.jsx`'s routes) they behave exactly as
  before — full page chrome (outer container + `<h1>`), `id` from
  `useParams()`, and `navigate()` on save. Rendered with `embedded` (from
  `Quotes.jsx`/`Invoices.jsx`'s own "New quote"/"New invoice" buttons, which
  now open a `<Modal>` instead of linking to `/quotes/new`) they skip that
  page chrome and render just the `<form>`, take `id` from `idOverride`
  instead of the route, and call `onSuccess(quote)`/`onSuccess(invoice)`
  instead of navigating internally — the list page's `onSuccess` closes the
  modal and navigates to the new document's detail page itself. The routed
  `/quotes/:id/edit`/`/invoices/:id/edit` pages are deliberately **not**
  converted to open in a modal from the list — only the "New X" flow is —
  so editing still gets the full page (with its own URL, refresh-safe,
  bookmarkable) and `InvoiceForm.jsx`'s locked-status guard (see below)
  keeps working unmodified. **The Cancel button next to Save is unconditional
  now** — originally it only rendered `{embedded && (...)}`, so the routed
  page had no way back except the browser's own Back button; a user who
  opened `/quotes/:id/edit` (e.g. via the row-level Edit action on
  `Quotes.jsx`/`Invoices.jsx`, see "Quote/invoice row actions" above) had no
  in-page way to abandon the edit. Cancel's `onClick` now branches on
  `embedded` itself: `if (!confirmDiscard()) return;` first either way (same
  guard, unchanged), then `embedded ? onCancel() : navigate(isEditing ?
  '/quotes/:id' : '/quotes')` (and the invoice equivalent) — editing
  navigates back to the document's own detail page, creating navigates back
  to the list, matching where Save itself would have sent you had the
  routed form's own `onSuccess` fallback (`navigate(...)` in `handleSubmit`)
  fired instead.
- `components/ConfirmDialog.jsx` + `lib/useConfirm.js` — the one confirmation
  prompt every destructive action in the app renders, replacing both the
  browser's native `window.confirm()` (unstyled, ignores dark mode,
  inconsistent across browsers) and, on `Clients.jsx`/`Expenses.jsx`, the
  "delete immediately, offer a few seconds to undo via a toast" pattern
  those two pages used to rely on as their *only* safety net (see
  `lib/useUndoableDelete.js` below) — a mis-click there deleted the row
  before anyone saw a prompt. Every Delete/Void/"clear selected data"
  button in the app (`Clients.jsx`, `Products.jsx`, `Expenses.jsx`,
  `RecurringInvoices.jsx`, `Licenses.jsx`, `Users.jsx`,
  `QuoteDetail.jsx`, `InvoiceDetail.jsx`'s delete *and* void actions, and
  `Import.jsx`'s `DangerZone`) — plus every other one-click action across
  the app that fires a mutation immediately with no intervening form/modal
  step of its own (`Licenses.jsx`'s Cancel/Reactivate/Renew, and the
  Duplicate button on both `QuoteDetail.jsx` and `InvoiceDetail.jsx`) —
  now goes through the same
  `const { confirm, confirmDialog } = useConfirm()` — `confirm({ title,
  message, confirmLabel, cancelLabel, danger })` returns a Promise the same
  way `window.confirm()` returns a boolean (`if (!(await confirm({...})))
  return;`), resolving only once the person clicks Confirm/Cancel (Escape
  and a backdrop click both count as Cancel) — and each caller renders
  `{confirmDialog}` once in its JSX to mount the actual popup.
  `ConfirmDialog.jsx` itself is presentational only (nothing calls it
  directly) and reuses `Modal.jsx`/`IdleTimeoutMonitor`'s exact backdrop +
  centered-card language, just with a two-button Confirm/Cancel footer
  instead of form content — `danger` (default `true`) picks red vs.
  `lagoon` for the Confirm button, matching the red styling every Delete
  button/`DangerZone` already used; a caller whose action isn't actually
  destructive passes `danger: false` for the `lagoon` treatment instead
  (`Licenses.jsx`'s Reactivate/Renew, both Duplicate buttons — undoing a
  reactivation, a renewal, or a duplicate is trivial, unlike Delete/Void/
  Cancel, so these don't need the red "this is dangerous" framing even
  though they still deserve the same are-you-sure pause against a
  mis-click). Deliberately **not** wrapped in an extra `confirm()`, despite
  also being one-click buttons: any action that already requires its own
  multi-step interaction before it fires — filling in and submitting an
  inline form (`QuoteDetail.jsx`'s "Convert to invoice",
  `InvoiceDetail.jsx`'s "Record payment") or clicking "Send email" inside
  `EmailPreviewModal` (every quote/invoice/license send-or-remind action) —
  already has its own confirmation gate; stacking a native `confirm()` in
  front of that would just be a second prompt for the same pause. `Clients.jsx`/
  `Expenses.jsx` now confirm *and* still call `deleteWithUndo` afterward —
  belt and suspenders, not an either/or: the confirm step stops a mis-click
  from doing anything at all, and the undo toast still covers "I confirmed
  but changed my mind" a few seconds later. `Import.jsx`'s `DangerZone` is
  unique in keeping *two* layers on top of each other — the existing
  type-`DELETE`-to-confirm text input (`canConfirm`) still gates the button
  itself, and clicking it now opens this same themed dialog as the second
  layer, replacing what used to be a second, native `confirm()` call.
- `components/Navbar.jsx` — `BUSINESS_LINKS` entries each carry a `module`
  (`null` for Dashboard, which is always visible); the rendered link list
  is filtered through `can(link.module, 'view')` so a restricted user never
  sees a nav link leading to a page that would just reject them — same
  UX-only caveat as the business-page button gating above, not a security
  boundary on its own. This filtering itself now lives in
  `components/Sidebar.jsx`, not `Navbar.jsx` (see "Sidebar navigation
  (desktop)" below — `Navbar.jsx` still *defines and exports*
  `BUSINESS_LINKS`, but no longer filters it itself). MOD Report's entry
  additionally carries `superAdminOnly: true` (`module: null`, since it
  isn't gated by the permission system at all) — the filter checks
  `(!link.superAdminOnly || isSuperAdmin)` alongside the existing module
  check, mirroring `routes/modReports.js`'s `requireSuperAdmin` rather
  than a `can()` check, same UX-only caveat (see "Super admin and the
  Finance permission preset" above). "My account" is appended after
  the filtered links, unconditionally visible to any logged-in user (admin
  or staff) since it's never permission-gated.
- `pages/Dashboard.jsx` — the page's outer container is a bare `px-4 py-10
  sm:px-6 lg:px-8`, same as every other business page in this app
  (`Clients.jsx`, `Financials.jsx`, `Invoices.jsx`, etc.), stretching to
  fill whatever width is available next to the sidebar rather than capping
  and centering. This page briefly carried a `mx-auto max-w-5xl` cap
  (matching `pages/portal/PortalDashboard.jsx`'s own centered-column
  layout) when the "Invoices by status"/"Needs attention" panels below
  still sat side by side in a `lg:grid-cols-2` row — two half-width cards
  sandwiched between full-width hero/strip/chart cards read as
  inconsistent panel widths, and capping+centering the whole page was one
  way to make that less visually jarring. The cap was removed again
  shortly after (full browser width was explicitly asked for back) — the
  fix that actually mattered for panel-width consistency was stacking
  "Invoices by status"/"Needs attention" full-width instead of side by
  side (still true, see below), not the container cap; removing the cap
  just lets every one of those now-uniform-width panels stretch to fill
  the full available width on a wide screen instead of stopping at
  1024px, the same as every other list/table business page already does.
  `SHORTCUTS`
  (the quick-link tiles) each carry a `module` and are filtered through
  `can(s.module, 'view')` the same way as `Navbar.jsx`'s/`Sidebar.jsx`'s own
  links. The whole hero/chart view
  additionally requires `can('financials', 'view')`; a staff user without
  it sees just the filtered shortcut tiles instead (with a "nothing to show
  yet" message if even those are empty), never a loading spinner that never
  resolves — the financials API call itself is skipped entirely rather than
  made and 403ing. Below the existing greeting (see below), the page opens
  with a hero band — `bankBalance` in `font-display` at 4xl/5xl (the one
  number this app can most vouch for, see `routes/financials.js`'s own
  note), a plain-language summary sentence built only from fields the
  `/financials/summary` response actually returns
  (`{clientCount} active clients, {money(totalPaid)} collected, and
  {money(netProfit)} in net profit so far` — deliberately no invented
  month-over-month delta, since that response has no prior-period figure to
  diff against), plus `netProfit`/`totalOutstanding` as smaller secondary
  figures beside it — followed by a de-emphasized secondary strip
  (`clientCount`/`totalInvoiced`/`totalPaid`/`overdueAmount`, plus
  `totalCapitalContributions` only when it's non-zero) as plain
  divider-separated metrics, not individual bordered cards, so it reads as
  supporting detail rather than competing with the hero. This replaced the
  page's previous `KpiCard` grid outright — the hero/strip pairing carries
  the same figures with a clearer at-a-glance hierarchy (one headline
  number, everything else secondary) rather than seven same-sized cards.
  Below that, `Accordion`-wrapped panels for the revenue chart / invoices-
  by-status / "Needs attention" / recent payments are unchanged in
  mechanism from before (same mobile-collapsible convention, see "Mobile
  design system" below) — only "Needs attention" is new. That panel merges
  overdue invoices (`api.invoices.list(token, { status: 'sent' })`,
  filtered client-side to `is_overdue` rows since there's no server-side
  overdue filter, sorted oldest-due-first) and expiring-soon licenses
  (`api.licenses.list(token, { status: 'expiring_soon' })`, sorted
  soonest-first) into one list, each capped to `NEEDS_ATTENTION_LIMIT` (4)
  — deliberately two extra, independent fetches gated on their own
  `invoices`/`licenses` view permissions (not `financials`, since a user
  could hold one grant without the other), both best-effort (a failed
  fetch is swallowed, not surfaced as a page error, since this is a
  supplementary widget). The panel only renders at all when the user holds
  *either* permission. It originally sat side by side with "Invoices by
  status" in a `lg:grid-cols-2` row — two half-width cards sandwiched
  between the full-width hero/KPI-strip/revenue-chart cards above and the
  full-width recent-payments card below, which read as inconsistent panel
  widths regardless of whether the outer container was capped or full-width
  — so that row now stacks instead ("Invoices by status" full width,
  "Needs attention" full width right below it, `flex flex-col gap-6`
  instead of a two-column `grid`) — every panel on the page reads as the
  same width now, whatever width the container itself happens to be.
- **Dashboard redesign — ring KPIs + widget rail**: the hero/strip pairing
  described just above was itself later superseded on `pages/Dashboard.jsx`
  (only there — `Financials.jsx` keeps its own plain `KpiCard` grid
  unchanged) by a combination of two directions explored on a design
  canvas and picked by the business owner: circular progress-ring KPI
  cards in place of the hero/strip, and a right-hand "widget rail" (a
  desktop-only companion column, not a new persistent app-wide layout
  element the way `components/Sidebar.jsx` is) holding a profile card,
  shortcuts, and a compact "needs attention" feed. `components/
  RingKpiCard.jsx` replaces the old hero card + secondary strip with a
  `grid grid-cols-1 gap-4 sm:grid-cols-2` of four cards — Bank balance
  (the one `filled` card, solid `bg-lagoon-600` with a white ring,
  reserving that treatment for the single figure this app can most vouch
  for), Paid (`tone="positive"`), Outstanding (`tone="warning"`), and
  Overdue (`tone="negative"`). Each ring's `percent` is deliberately the
  same denominator across all four — `value / summary.totalInvoiced * 100`
  (clamped 0–100, `ringPct()` in `Dashboard.jsx`) — so the four cards are
  directly comparable ("this much of what's been invoiced") rather than
  four unrelated, harder-to-read percentages; Bank balance's own ring uses
  `Math.max(0, bankBalance)` as the numerator since a ring can't represent
  a negative share. The ring math itself is the two-value
  `stroke-dasharray="<arc-length> <full-circumference>"` technique (a
  single-value dasharray equal to the full circumference renders as a
  solid circle regardless of `stroke-dashoffset` — a real bug caught and
  fixed on the design canvas this was drawn from before it ever reached
  real code), rotated via a single Tailwind `-rotate-90` class on the
  `<svg>` itself rather than a competing SVG `transform` attribute (a CSS
  transform silently overrides an SVG transform attribute on the same
  element — the design canvas's other caught bug). "Invoices by status"
  swapped from `StatusBreakdownChart`'s horizontal bars to
  `components/StatusDonutChart.jsx` — same `STATUS_META` colors/keys, same
  "status is state, not series identity" reasoning, just a donut instead
  of bars, built once for this page only (`Financials.jsx`/
  `InvoiceAnalytics.jsx` keep the original bar version, so this is its own
  component rather than a mode flag on the shared one) — each segment's
  position is a cascading *negative* `stroke-dashoffset` (segment N's
  offset is the negative sum of every prior segment's arc length) instead
  of a per-segment `rotate()` attribute, for the identical
  transform-attribute-gets-overridden reason above. `components/
  DashboardRail.jsx` is the right rail itself — a profile card (avatar or
  initials, name, "Administrator"/"Staff", linking to `/account`), a
  "Shortcuts" list (`permittedShortcuts.slice(0, RAIL_SHORTCUT_LIMIT)`,
  6, each `SHORTCUTS` entry now also carries an `icon` component), and a
  "Needs attention" list reusing the exact same `attentionItems` array
  (overdue invoices + expiring licenses, unified into one shape with a
  colored icon chip per tone: red for overdue, amber for expiring) that
  also backs the plain-Accordion rendering below `xl:`. The rail is
  `hidden shrink-0 xl:block xl:w-[300px]` — desktop-only, matching this
  app's other `xl:`-gated persistent-layout elements (`Sidebar.jsx`) —
  and the page's own "Needs attention" `Accordion` and the shortcut pill
  row are the mirror image, `xl:hidden`, so the two never render at once:
  below `xl:` (most of this app's phone/tablet-first user base) the data
  stays exactly where it already was, in the Accordion/pill-row shapes
  documented above; at `xl:` and up the rail takes over and those two
  collapse away. `RingKpiCard`/`DashboardRail`/`StatusDonutChart` are used
  only on `Dashboard.jsx` — no other page needed this treatment yet, so
  none of the three were generalized further than that one caller needs.
- **Dashboard scoped to the current year, plus a "This year at a glance"
  overview**: the ring KPI cards (Bank balance/Paid/Outstanding/Overdue)
  used to read `api.financials.summary(token)` with no range — an
  all-time total that only ever grows, the same figure whether it's
  January or December and never resetting a business's sense of "how's
  this year going." `Dashboard.jsx` now calls
  `api.financials.summary(token, { from: YEAR_FROM, to: YEAR_TO })`,
  `YEAR_FROM`/`YEAR_TO` being `startOfYearStr()` (a new `lib/date.js`
  helper, the January-1st sibling of that file's own `startOfMonthStr()`)
  through `todayStr()` — the exact same range shape
  `pages/business/Financials.jsx`'s own "This year" `StatusFilterChips`
  tab already sends to this identical endpoint, so Dashboard now shows
  the same year-scoped figures Financials' own default tab does, not a
  separate all-time view of the same numbers. `bankBalance`/`clientCount`/
  `monthlyTrend` are unaffected either way — see `routes/financials.js`'s
  own note on which fields a period filter does and doesn't scope; the
  practical effect here is `totalPaid`/`totalOutstanding`/`overdueAmount`/
  `overdueCount`/`invoiceCounts` all becoming "this year" figures instead
  of all-time ones (verified with a quote/invoice deliberately dated the
  prior year: its amounts never leak into any of the Dashboard's own
  figures). The "Needs attention" panel is deliberately **not** scoped by
  this — it still queries every currently-overdue invoice regardless of
  which year it was issued (unchanged), since an old overdue invoice is
  exactly the kind of thing that still needs to surface even if it drops
  out of "this year's" headline Overdue figure — the same accrual-vs-
  operational split `Financials.jsx`'s own period filter already commits
  to for its identical `overdueAmount` field.
  **"This year at a glance"**, a new `Accordion` between "Invoices by
  status" and "Needs attention," is the "full analytics of everything"
  half of this change — six `KpiCard`s (Quotes issued/Quotes accepted/
  Invoices issued/Collected/New licenses/Expenses), each linking straight
  to that module's own full analytics page. Deliberately **not** a fifth
  backend endpoint — every figure comes from the *current year's own row*
  in the `byYear` array each of `GET /quotes/analytics`,
  `GET /invoices/analytics`, `GET /licenses/analytics`, and
  `GET /expenses/analytics` already returns (`currentYearRow()`, a small
  helper that finds the row matching `CURRENT_YEAR` or falls back to an
  all-zero stand-in for a business with no data yet this year) — that
  data already existed for each module's own analytics page, this just
  reads the one row that matters here instead of standing up a new
  aggregation route. Four independent, permission-gated, best-effort
  fetches (`can('quotes'|'invoices'|'licenses'|'expenses', 'view')`,
  mirroring the "Needs attention" fetches' own reasoning just above —
  a user could hold any subset of these four grants, and one failing
  shouldn't block the rest of the dashboard or the financials-gated
  content above it). The whole section (and each individual card within
  it) is gated independently of `financials:view` — a staff member with,
  say, only `quotes:view` still sees a Quotes card even without financials
  access, though in practice this section currently only renders at all
  when the surrounding `canViewFinancials` branch does too, since the
  entire main-column layout (ring KPIs, charts, this section, Needs
  attention, Recent payments) is nested inside that same top-level gate —
  a staff member with none of the four `view` grants used here, and no
  `financials:view` either, still falls back to the bare shortcuts-only
  view the page has always shown in that case.
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
  dependency) used inside `KpiCard`'s tinted circle. Both pages' `money()`
  calls (KPI values, `MeterBar`'s sub text, the recent-payments list) come
  from the shared `lib/money.js` rather than a local per-page helper —
  full two-decimal precision below one million, a compact `1.3m`/`2b`-
  style suffix at or above it (trailing `.0` dropped, so a round number
  reads `$2m` not `$2.0m`), sign kept in front of the currency symbol for
  a negative value (e.g. a net loss). `RevenueTrendChart.jsx`'s own
  `formatCompact()` (its y-axis tick labels) mirrors the same `k`/`m`
  thresholds independently, since it formats a bare number the caller
  prefixes with the currency symbol separately rather than taking one
  through `lib/money.js`. This compacting is deliberately scoped to
  Dashboard/Financials' own summary views (many large numbers shown
  together, where 7-digit figures get hard to scan at a glance) — invoice/
  quote/expense detail and list pages, PDFs, and CSV exports all keep full
  precision, since those are reviewing one specific figure rather than
  scanning several. `Financials.jsx`'s recent-payments table makes the
  Receipt column a button (styled like the adjacent Invoice link) that
  calls `api.invoices.openReceiptPdf(invoice_id, id, token)` — the same
  download used on `InvoiceDetail.jsx`'s own payments list — rather than
  plain text, so a receipt is one click away without navigating to the
  invoice first. A failed download sets `error` without blanking the
  already-loaded page (`if (error && !summary) return …` only short-
  circuits before the initial load succeeds, matching the `error && !data`
  pattern `QuoteDetail.jsx`/`InvoiceDetail.jsx` already use) — it renders
  as an inline `<p>` near the top instead.
- `pages/business/Reports.jsx` (route `/reports`, `Navbar.jsx` link gated
  on the same `financials` module as `/financials`) — a single from/to date
  range (`<input type="date">` pair, defaulting to `startOfMonthStr()`
  through `todayStr()` from `lib/date.js`) plus three quick-pick preset
  buttons (This month/Last month/This year), shared by five report cards
  (Sales, Tax, Profit & Loss, Expense, Bank Balance Statement) laid out
  with the same icon-circle + label + description shape as `KpiCard`. Each
  card's "Download PDF" button
  calls its matching `api.reports.*Pdf(from, to, token)` — which, like
  `api.invoices.openPdf`/`api.quotes.openPdf`, goes through `lib/api.js`'s
  `openPdf()` rather than `request()` (binary response, opened as a blob
  URL in a new tab, not JSON) — with a per-button `busyKey` disabling only
  the clicked card's button while its PDF generates, and a page-level
  `error` if the request fails or the range is invalid (`from` after `to`,
  checked client-side before the request as well as server-side).
- Styling is Tailwind CSS v4 via the `@tailwindcss/vite` plugin (see
  `vite.config.js` and `src/index.css`) — no `tailwind.config.js`/PostCSS
  setup exists or is needed for v4's Vite integration. Utility classes are
  used directly in JSX; there's no separate component-style layer.

### Mobile design system

A ground-up visual pass (palette, type, navigation, and card language),
aimed primarily at the phone breakpoint since that's where the app is
weakest as a plain responsive layout rather than a considered mobile
experience — desktop inherits the same tokens/colors for consistency but
keeps its existing layout.

- `src/index.css`'s `@theme` block defines a `lagoon` color scale
  (`--color-lagoon-50` … `--color-lagoon-950`, a deep turquoise teal fitting
  a Maldives-based business) that replaced every `indigo-*` Tailwind class
  app-wide at the same shade numbers (`indigo-600` → `lagoon-600`, etc.) —
  a mechanical, 1:1 rename across every component and page, so `lagoon` is
  now the single accent color used for buttons, links, active nav/tab
  states, focus rings, the FAB, chart lines (`RevenueTrendChart.jsx`'s
  `INVOICED_COLOR`, `StatusBreakdownChart.jsx`'s `sent` entry — both were
  hardcoded hex, not Tailwind classes, so those were hand-updated to the
  same `#0e7c86`), and `StatusBadge`'s `sent` pill (previously blue). The
  same block also defines `--font-display: 'Sora', ui-sans-serif, system-ui,
  sans-serif` (Tailwind v4 auto-generates the `font-display` utility from
  any `--font-*` theme key) plus two `@font-face` rules pointing at
  `/fonts/sora-700.woff2`/`sora-800.woff2` — self-hosted rather than a
  Google Fonts CDN link (consistent with the PWA's no-CDN-dependency goal
  below), subset to Latin, and listed in `vite.config.js`'s
  `VitePWA({ includeAssets })` so the service worker precaches them for
  offline use like every other static asset. `font-display` is used
  sparingly — page titles/greetings and KPI figures — never body text.
  `MeterBar.jsx`'s `color` prop was renamed from `indigo` to `lagoon` to
  match (no external caller passed it explicitly, so this was a same-file
  rename, not a breaking prop change).
- `components/BottomNav.jsx` — a fixed, phone-only (`sm:hidden`) tab bar
  that replaces `Navbar.jsx`'s hamburger drawer below the `sm` breakpoint
  (tablets and up still get the hamburger — see `Navbar.jsx` below). Six
  permanent tabs (`PRIMARY_TABS`: Home/Invoices/Quotes/Clients/Licenses/
  Settings, each filtered through `can(module, 'view')` the same way
  `Navbar.jsx`'s `visibleLinks` is — Licenses was added as a primary tab
  rather than folded into a catch-all "more" destination since a license's
  expiry is time-sensitive enough to check as often as an invoice/quote;
  Settings was added later on its own explicit request, for the same
  "worth a permanent tab, not just the hamburger drawer" reasoning). This
  bar briefly carried a seventh "Menu" tab too (first opening a
  `components/BottomSheet.jsx` flat link list, later `Sidebar.jsx` itself as
  a slide-in drawer) so phones could reach the app's full navigation — that
  tab was then removed outright once the *same* full-navigation trigger
  moved into `Navbar.jsx`'s own header instead (top-left corner, every
  width below `xl:` — see "Top-left hamburger, top-right avatar" below), so
  there's exactly one way to reach it rather than two. `App.jsx` renders `<BottomNav />` only when `user` is
  truthy (mirroring `Navbar.jsx`'s own `{user ? ... }` split) and wraps the
  routed `<Routes>` in a `pb-16 sm:pb-0` div so the fixed bar never covers
  a page's last content or action buttons; `FloatingActionButton.jsx`'s
  `bottom` offset was raised to `calc(5.5rem + env(safe-area-inset-bottom))`
  for the same reason, and got the mockup's gradient (`from-lagoon-600
  to-lagoon-700`) + `rounded-2xl` squircle treatment instead of a flat
  circle.
- `components/FloatingActionButton.jsx` is draggable, not just fixed
  bottom-right — a user can drag it anywhere on screen and it stays there
  across visits. It renders at its usual `right`/`bottom` CSS position
  (`DEFAULT_STYLE`) until a `useLayoutEffect` measures where that actually
  landed (`getBoundingClientRect()`, which already resolves the
  `env(safe-area-inset-bottom)` in the CSS) and adopts that as an explicit
  `{ x, y }` in state — converting to pixel-positioned `left`/`top` with no
  visual jump, so dragging math never has to parse `calc()`/`env()` itself.
  Pointer events (`onPointerDown`/`onPointerMove`/`onPointerUp`, with
  `setPointerCapture` so a drag tracks correctly even off the button's own
  bounds) update that position live and `clamp()` it to stay within
  `EDGE_MARGIN` (8px) of the screen edges and `BOTTOM_RESERVE` (76px, a
  fixed estimate of `BottomNav.jsx`'s own height + margin — this component
  has no ref into that one) above the bottom nav, re-clamping on window
  resize/orientation change too. A press only counts as a drag once
  movement exceeds `DRAG_THRESHOLD` (6px); `justDraggedRef` is what makes
  that distinction stick through to the `click` event that always follows
  a `pointerup` — `handleClick` checks it first and, if a drag just
  happened, calls `e.preventDefault()` (aborts the `<Link>`'s navigation)
  and returns without ever calling the `onClick` prop (for pages like
  `Clients.jsx` that open an inline form instead of routing) — so a real
  drag repositions the button without also activating whatever it's a
  shortcut for, while an actual tap (no meaningful movement) still fires
  exactly as before. The landed position is written to `localStorage`
  (`edusolution_fab_position`) only once a drag actually happened, read
  back (and re-clamped, in case the viewport changed since) on mount —
  so a user who never drags it never even touches that key, and the
  button stays at its designed default forever.
- `components/BottomSheet.jsx` — the mobile counterpart to `Modal.jsx`:
  same open/backdrop-click/Escape/body-scroll-lock contract, but slides up
  from the bottom with rounded top corners and a drag-handle bar instead of
  a centered card, matching the native-mobile-app convention for a menu
  triggered from a bottom tab. Originally backed `BottomNav.jsx`'s "More"
  tab (see just above for that tab's own history — it briefly opened
  `Sidebar.jsx`'s drawer instead before being removed entirely), so this
  component currently has no caller — kept anyway as a generic
  `{ open, onClose, title, children }` popup primitive like `Modal.jsx`,
  ready for the next small mobile-only action list that needs one, rather
  than deleted along with its one-time caller (unlike
  `components/BulkActionBar.jsx`, which really was built for, and removed
  with, a single specific feature — see "Mobile design system" above).
- **Top-left hamburger, top-right avatar**: `components/Navbar.jsx`'s
  header is a left cluster (hamburger, then the wordmark) and a right
  cluster (phone-only search toggle, notifications, theme toggle, then the
  account avatar last so it sits in the literal corner) — asked for
  directly as a standard mobile-app layout, replacing an earlier
  arrangement where the hamburger sat tablet-only on the right (next to the
  wordmark on the left) and there was no avatar in this header at all. The
  hamburger button itself lost its `hidden sm:flex` gating — it's now
  `flex` unconditionally, visible at every width this header renders at
  (phones included, not just tablets), and is this app's one route into
  `Sidebar.jsx`'s full-navigation drawer below `xl:`; `BottomNav.jsx`'s own
  tab bar (see above) carries only its six primary shortcuts, not a second
  copy of this trigger. `menuOpen`'s `aria-label` swaps between "Open menu"/
  "Close menu" and the icon between `MenuIcon`/`XIcon` the same way it
  already did. The avatar is the same image-or-initials pattern
  `Sidebar.jsx`'s own account row and `DashboardRail.jsx`'s profile card
  use (`user.avatarImage` if set, else a `bg-lagoon-600` initials circle),
  linking to `/account` — the header's one piece of account-specific UI, so
  a phone/tablet user has a one-tap route there without opening the drawer
  first. The phone-only search icon toggle (`sm:hidden`, reveals an inline
  `GlobalSearch` row below the header, `GlobalSearch` gained an `autoFocus`
  prop for this) is unchanged — it's still the faster one-tap route to
  search from the header itself, alongside the drawer's own `GlobalSearch`
  instance. `xl:flex` desktop `Sidebar` nav is unaffected either way.
- **Left-edge swipe opens the drawer instead of triggering the phone's own
  "swipe back" gesture**: `lib/useEdgeSwipeOpen.js`, a small hook attached
  in `Navbar.jsx` right alongside the hamburger button above (`enabled:
  Boolean(user) && !menuOpen`, `onOpen: () => setMenuOpen(true)` — the
  exact same state the hamburger itself toggles, so a swipe and a tap open
  the identical drawer). Phones ship a system/browser gesture for "swipe
  in from the left edge to go back," which has nothing to do with this
  app's own navigation — someone meaning to open the nav drawer instead
  got bounced to whatever page they were on before, reading as the app
  misbehaving rather than "the browser went back." The hook attaches
  `document`-level `touchstart`/`touchmove`/`touchend` listeners (not JSX
  `onTouch*` props, since the gesture needs to be caught regardless of
  which element on the page the touch actually starts on): a touch
  starting within 24px of the left edge is tracked, `preventDefault()`'d
  on the touchmove the moment it reads as a rightward horizontal swipe
  (claiming the gesture before the browser's own handling of it can kick
  in), and once net horizontal movement crosses 60px, `onOpen()` fires and
  tracking stops. A touch that turns out to be more vertical than
  horizontal (an ordinary scroll that happens to start near the edge)
  cancels tracking without ever calling `preventDefault()`, so scrolling
  from near the edge is untouched. Gated off once the drawer is already
  open (the backdrop/panel handle their own touches from there — see
  `Sidebar.jsx`'s `mobileOpen` mode above) and above the `xl:` breakpoint
  (`Sidebar` is a persistent, always-open panel there, not a drawer — see
  "Sidebar navigation (desktop)" — so there's nothing for an edge swipe to
  open), and only for a logged-in user at all (no drawer exists on the
  public quote/invoice/MOD-report links, `/login`, etc., so those pages
  keep the browser's native back-swipe untouched, which is the correct
  behavior there). **This is a best-effort override, not a guarantee** —
  Chrome for Android generally respects `preventDefault()` here, but iOS
  Safari's edge-swipe-back is a system-level UIKit gesture recognizer that
  page JavaScript cannot always suppress, particularly in standalone/
  installed-PWA mode; there is no combination of web APIs that reliably
  wins against it on every platform, and the hook's own top-of-file
  comment says so directly rather than overclaiming. `index.css`'s `body`
  rule also gained `overscroll-behavior-x: none` — a free, low-risk second
  layer that helps the same gesture in some browsers/versions, on an app
  that has no horizontal-scroll content to lose by disabling horizontal
  overscroll navigation. Verified with synthetic touch-event dispatch
  (Playwright's touch emulation has no built-in swipe helper, so this
  constructs and dispatches real `TouchEvent`s at specific coordinates):
  an edge-starting rightward swipe past the threshold opens the drawer;
  a short swipe under the threshold, a swipe not starting at the edge, and
  a vertical swipe starting at the edge all correctly leave it closed.
- `components/Footer.jsx` — a small global closing bar (small
  `/logo-symbol.png` mark + "EduSolution.com" wordmark on one side, a
  dynamic `© {new Date().getFullYear()} Edu Solutions Pvt Ltd. All rights
  reserved.` — the year computed rather than a literal, so it never goes
  stale — linking `https://www.edusolutionsmaldives.com`, the same domain
  `Login.jsx`'s own closing section already links (this app's actual own
  domain, per `render.yaml` — an earlier version of both links pointed at
  `edusolutionsmv.com` instead, which turned out to resolve to unrelated
  infrastructure the business doesn't control or pay for, so both were
  corrected to point here), on the other; the
  registered company name, not the "EduSolutions Maldives" trading name
  `Login.jsx`'s own copy uses elsewhere — a footer copyright line is the
  one place in the app that specifically calls for the legal entity name)
  mounted once in `App.jsx` alongside `Navbar`/`BottomNav`, so it appears on
  every route rather than being copy-pasted per page. This is deliberately
  slim — one quiet line, not a multi-column marketing footer — since this
  is an internal business app; `Login.jsx`'s own richer closing section
  (wordmark image + link) is untouched and stays that page's own content,
  with the global `Footer` simply rendering right below it there too.
  `App.jsx`'s root layout is the standard CSS sticky-footer flex pattern to
  make this work on short pages without leaving a dangling gap: the outer
  container is `flex min-h-screen flex-col`, and a `flex flex-1 flex-col`
  wrapper (holding both the routed content, itself in its own `flex-1` div,
  and `Footer`) is what pins `Footer` to the true bottom of the viewport on
  a short page like `Login` while letting it flow naturally below content
  on a tall one — verified by checking the footer's bottom edge lands
  exactly at the viewport height on `Login`, not above or below it. That
  wrapper keeps the existing `pb-16 sm:pb-0` bottom padding gate on
  `user` — needed since `BottomNav` is `fixed` and phone-only, and without
  it `BottomNav` would cover `Footer`/the page's last content on a logged-
  in phone. `Footer` itself takes an optional `className` (default `''`),
  and `App.jsx` passes `user ? 'hidden sm:block' : ''` — **on phones,
  `Footer` only renders when logged out**. This isn't a phone/desktop
  styling preference, it's fixing a real overlap: every list page's
  `FloatingActionButton` (see above) is itself phone-only (`sm:hidden`) and
  fixed at a constant bottom offset, and on a short-content logged-in page
  (e.g. an empty Invoices/Clients list) that offset lands directly inside
  `Footer`'s own band, so the FAB visually sat on top of the copyright text
  — confirmed via a Playwright screenshot before this guard existed.
  Logged-out phone pages (`Login` — which doubles as the app's landing
  page, see `pages/Login.jsx` above — `/q/:token`, `/i/:token`) have
  neither `BottomNav` nor a FAB, so `Footer` stays visible there, and
  desktop (`sm` and up) is unaffected either way since the FAB is already
  hidden at that breakpoint. Tablet/desktop `Footer` visibility was
  separately confirmed on `Dashboard` in dark mode, so the dark-mode
  palette (`dark:border-slate-800 dark:bg-slate-900/50`) was checked too,
  not just the light-mode default.
- `components/KpiCard.jsx` picked up the mockup's card language:
  `rounded-2xl` (was `rounded-lg`), a smaller `rounded-xl` icon chip (was a
  circle), and the value rendered in `font-display font-extrabold
  tabular-nums` instead of a plain `font-semibold` — same `tone`→color
  contract as before (`neutral`/`positive`/`negative`/`warning`), just
  restyled. `components/Accordion.jsx` picked up the same `rounded-2xl`
  for visual consistency with `KpiCard`/`MobileListAccordion`'s cards.
  `KpiCard` also takes an optional `className` (default `''`), appended to
  the card's own classes, for any card that needs to break out of the
  shared grid's per-cell sizing — no current caller uses it (Dashboard's
  own "Bank balance" figure moved into its own hero treatment rather than
  a `KpiCard`, see below, and `Financials.jsx` renders all of its cards at
  one uniform size), but the prop stays for the next one that does.
- `pages/Dashboard.jsx` opens with a time-of-day greeting (`greeting()` —
  "Good morning"/afternoon/evening by `new Date().getHours()`) above the
  user's first name in `font-display`, with the business name (falling back
  to the user's email if `business_settings` hasn't loaded yet) underneath
  — replacing the previous plain "Welcome, {name}" + email line. The hero
  band described above (see "Sidebar navigation" below for the rest of
  this page's redesign) sits directly beneath this greeting, unchanged.
  **Currency-symbol flash on load**: the hero/KPI figures briefly rendered
  with the `'$'` fallback symbol before snapping to the business's real
  `currency_symbol` (e.g. `MVR`) a moment later — `api.financials.summary()`
  and `api.settings.get()` fire together in the same effect but resolve
  independently, and the summary fetch usually wins the race, so the page
  left its "Loading…" state (gated only on `summary`) and painted at least
  one frame with `symbol = settings?.currency_symbol || '$'` before
  `settings` itself arrived. Fixed with a `settingsLoaded` flag, set in a
  `.finally()` alongside the existing `.then()`/`.catch()` on the settings
  fetch — the loading gate now waits on `!summary || !settingsLoaded`, not
  `!summary` alone, so the hero never paints until the real symbol (or, for
  a staff user without `settings:view`, the confirmed-permanent `'$'`
  fallback — `.finally()` still fires on that 403) is known. Deliberately
  *not* the same fix as gating on `!settings` directly, which would hang a
  permission-restricted user on "Loading…" forever, since their settings
  fetch never succeeds — `settingsLoaded` tracks "the fetch is done" (either
  outcome), not "the fetch succeeded." The same independent-parallel-fetch
  race exists on every page that reads `settings?.currency_symbol || '$'`
  from a separate `api.settings.get()` call sitting next to its own primary
  data fetch — this same `settingsLoaded`-gated fix was rolled out to the
  other pages built around a KPI-strip/summary shape once the Dashboard fix
  was confirmed: `pages/business/Financials.jsx` and the four analytics
  pages (`ExpenseAnalytics.jsx`, `InvoiceAnalytics.jsx`,
  `LicenseAnalytics.jsx`, `QuoteAnalytics.jsx`) — each got the identical
  `settingsLoaded` state + `.finally()` + widened loading-gate treatment,
  verified the same way (a Playwright test throttling `/api/settings` to
  confirm no `$` frame ever paints, plus a permission-restricted-staff
  check confirming the page still renders promptly with the `$` fallback
  rather than hanging). **The sweep was then extended to every remaining
  staff page reading `settings?.currency_symbol`** —
  `InvoiceDetail.jsx`/`QuoteDetail.jsx` (single-record detail pages, same
  `!data`-gate shape as the analytics pages) and `Products.jsx`/
  `RecurringInvoices.jsx`/`Licenses.jsx` (list pages with their own
  `loading` boolean rather than a `!data` check — these got the same
  `settingsLoaded` state and `.finally()`, but the fix widens the page's
  existing `loading` render-gate to `loading || !settingsLoaded` instead
  of introducing a second gate, so the "only show the skeleton on the very
  first load" behavior those three pages already have — see
  `lib/useDebouncedValue.js`'s own note on why refetches don't re-show the
  skeleton — is preserved unchanged for search/filter/page-change
  refetches, and only the *initial* paint additionally waits on settings).
  All five were verified the same throttled-Playwright way, with real
  test records in place so each page's money-bearing cells were actually
  exercised, not just an empty state.
  **Re-audited app-wide** after the Dashboard greeting turned up a related
  instance of the same race on a non-currency value (see that fix's own
  note further down this section) — grepping every `api.settings` call
  site found `QuoteForm.jsx`/`InvoiceForm.jsx` as the two the original
  sweep missed: both fetch settings in the same `useEffect` as
  clients/products, pass `currencySymbol={settings?.currency_symbol}`
  (no `|| '$'` fallback of their own) straight to
  `components/LineItemsEditor.jsx`, which *does* default that prop to
  `'$'` — so a brand-new quote/invoice's Line items section, and
  specifically its Subtotal line (which renders even with zero items,
  reading "Subtotal: $0.00"), could paint with the wrong symbol before
  settings resolved. Fixed with the identical `settingsLoaded` +
  `.finally()` pattern, widening each form's existing `if (loading)`
  gate to `if (loading || !settingsLoaded)` — but with the `!canManage`
  permission check moved *ahead* of that gate (it used to come after),
  since `canManage` is synchronous (from `AuthContext`, no fetch) and
  making a staff member without `quotes`/`invoices:manage` wait on a
  settings round-trip just to see "You don't have permission" would have
  been a real, avoidable regression introduced by widening the gate.
  Verified the same throttled-Playwright way: no `$` anywhere in the DOM
  while settings is still in flight (the whole line-items area simply
  isn't rendered yet), then adding a line item once settled shows the
  correct symbol immediately, never a swap. A full re-grep of every
  `api.settings` call site in the app (15 total) confirms this closed
  every remaining gap — everything else was already fixed by the earlier
  sweep, is a settings editor itself (`Settings.jsx`, not a race), or
  reads through `PortalAuthContext` (already confirmed safe above).
  **The client portal and the public document-link pages were
  investigated and found to already be safe, needing no fix**:
  `PublicQuote.jsx`/`PublicInvoice.jsx` read `settings` from the *same*
  `api.public.getQuote()`/`getInvoice()` response as the document itself
  (see `routes/public.js` above) rather than a separate fetch, so there's
  no second promise to race against. The four portal pages that read
  `settings` (`PortalDashboard.jsx`, `PortalInvoices.jsx`,
  `PortalLicenses.jsx`, `PortalQuotes.jsx`) all read it from
  `PortalAuthContext` rather than fetching it themselves — and that
  context's bootstrap effect already fetches `me()`/`getSettings()`
  together via `Promise.all` before ever setting `loading` to `false`,
  the same pattern this fix introduces everywhere else. The one place
  that looked suspect on inspection — `PortalAuthContext.jsx`'s `login()`
  sets `token`/`account` synchronously and fetches `settings` in the
  background, which briefly looked like the same race — turned out to be
  a non-issue in practice: `App.jsx`'s `<ErrorBoundary key={location.pathname}>`
  (see "Error boundaries" above) remounts everything beneath it, including
  `PortalAuthProvider`, on every pathname change — so the moment `login()`
  navigates to `/portal/dashboard`, a *fresh* `PortalAuthProvider` instance
  mounts, reads the now-persisted token from `localStorage`, and runs the
  same `Promise.all`-gated bootstrap effect from scratch before revealing
  anything. Confirmed by instrumenting the context directly (temporary
  `console.log`s tracing renders/mounts/effects) rather than trusting a
  Playwright text-content check alone, since an earlier pass at this same
  verification wrongly concluded pages were safe when they weren't — the
  browser was silently serving cached `/api/settings` responses across
  sequential `page.goto()` calls within one browser context, masking the
  real race entirely; the reliable test methodology is a **fresh browser
  context per page** so no page's check can ride on another's cached
  response.
  `PortalInvoiceDetail.jsx`/`PortalQuoteDetail.jsx` are the portal's own
  per-record detail pages and, like the public pages, get `settings` from
  their own document-fetch response rather than context or a separate
  call — also no race.
  **The same race, on a value that isn't a currency symbol**: reported
  later as "the greeting briefly shows my email, then swaps to the
  business name" — `pages/Dashboard.jsx`'s own greeting subtitle
  (`settings?.business_name || user?.email`, directly under the "Good
  morning, {name}" heading) sits *outside* the `!summary || !settingsLoaded`
  gate the rest of this page's content already waits on, so it painted
  immediately off `user?.email` (always available, no fetch needed) and
  only swapped to `settings.business_name` once the same independent
  settings fetch this whole section is about actually resolved — the exact
  same race, just never swept up in the pass above since the symptom
  wasn't a `$`. Fixed the same way, narrowed to just this one line rather
  than delaying the page's own already-`settingsLoaded`-gated main content
  any further: `settingsLoaded ? settings?.business_name || user?.email :
  ' '` — a single space holds the line's height so nothing shifts once the
  real value lands, rather than the line collapsing to zero height and
  back. Verified with the same throttled-`/api/settings` Playwright
  technique as the rest of this fix: a mid-load screenshot shows the blank
  line (not the email), and the settled state shows the business name with
  no flash in between.
- `pages/business/InvoiceDetail.jsx` gained a mobile-only (`sm:hidden`)
  gradient hero card between the header actions and the existing Bill-to/
  Details grid: total due in `font-display`, a paid-vs-total progress bar,
  and a Paid/Balance split — desktop has no equivalent (its "Details" card
  already surfaces balance due inline), this is purely a phone-first
  "surface the number before the fold" addition and doesn't change any
  desktop markup or the page's data flow.

### Sidebar navigation (desktop)

The app's persistent navigation at `xl:` and up (≥1280px) is a dark
sidebar, not the horizontal link strip `Navbar.jsx` used to show at that
breakpoint — a deliberate, app-wide layout change (not a Dashboard-only
one), landed via a round of mocked-up visual directions the business
owner reviewed and picked a combination from before this was built for
real. Below `xl:`, the phone `BottomNav` tab bar's five primary tabs are
exactly what they were before; the hamburger that opens `Sidebar` itself as
a slide-in drawer (rather than a flat link-list dropdown/sheet) now lives
in `Navbar.jsx`'s own header, top-left corner, at every width below `xl:`
(phones included — see "Top-left hamburger, top-right avatar" under
"Mobile design system" above; `BottomNav.jsx` itself briefly carried a
second copy of this trigger as its own sixth tab, later removed once the
header took over the job) — same component, same links, same icons as the
persistent desktop sidebar either way.

- `components/Sidebar.jsx` — takes an optional `mobileOpen`/`onMobileClose`
  pair (both unused/`undefined` for the persistent desktop instance
  `App.jsx` renders). With `mobileOpen` falsy, it's `hidden ... xl:flex
  xl:sticky xl:top-0 xl:h-screen xl:w-60 xl:flex-col`, self-hiding below
  `xl:` the same way `Navbar.jsx`'s own desktop content used to self-show
  only at `xl:` — the two components are mutually exclusive by
  construction below `xl:` (only one is ever open/relevant at a time), so
  neither needs to know the other exists beyond the props Navbar passes
  in. Background is a fixed `bg-lagoon-950` — intentionally *not*
  theme-aware (no `dark:` variants), the same way an always-dark accent
  panel would work regardless of the app's own light/dark setting, since
  it reads fine against either. Holds, top to bottom: the wordmark (links
  to `/`, same as `Navbar.jsx`'s own), `GlobalSearch` (full-width, no
  `max-w-*` cap — the sidebar itself is the width constraint now), the nav
  list, and a bottom-pinned account row (initials avatar + name, linking
  to `/account`, plus `ThemeToggle` and a logout icon button) — search and
  account controls live in the sidebar itself rather than a separate top
  bar repeated on every page (the shape most dense B2B dashboards —
  Notion, Linear, Vercel — already use for this), which is also what let
  this ship as a global layout change with no changes needed to any
  individual page. `ThemeToggle` needed `!`-prefixed override classes
  (`!text-lagoon-200 hover:!bg-white/10 hover:!text-white`) to read
  correctly against the dark sidebar — its own default classes
  (`text-slate-500` etc.) are appended-not-replaced by its `className`
  prop, so a plain override class isn't guaranteed to win the cascade;
  `!important` is. `GlobalSearch`'s own input needed the same treatment
  for the opposite reason: its `dark:bg-slate-900 dark:text-white`
  styling is tuned for the app's own themed *page* background, not this
  permanently-dark panel — stacked with the app's own dark theme, the
  input read as dark text on a near-black field, effectively invisible.
  Since `GlobalSearch`'s `className` prop only reaches its outer wrapper,
  not the nested `<input>`, the fix is a wrapping `<div>` with Tailwind's
  arbitrary-descendant-selector syntax:
  `[&_input]:!border-lagoon-200 [&_input]:!bg-white
  [&_input]:!text-slate-900 [&_input::placeholder]:!text-slate-400` —
  forces a light input regardless of the app's own theme, in both the
  persistent desktop sidebar and the mobile drawer (both render the same
  `GlobalSearch` call, so both needed it, and both got it from this one
  change).
- The nav list reuses `Navbar.jsx`'s own exported `BUSINESS_LINKS` array —
  one source of truth for "which links exist," with the `can()`/
  `superAdminOnly` filtering logic itself living here in `Sidebar.jsx`
  (see "Mobile/tablet drawer mode" below for why `Navbar.jsx` dropped its
  own copy of this filtering entirely rather than keeping two to drift out
  of sync). `LINK_ICONS` maps each link's `to`
  path to one of `components/icons.jsx`'s icons; a few modules
  deliberately reuse an icon that already carries a close-enough meaning
  elsewhere in the app rather than inventing a new glyph per link —
  Capital and Users both reuse `UsersIcon` (Capital already reuses it on
  its own `Financials.jsx` KPI card, see "Capital contributions" above;
  Users manages staff *people*, so the same glyph reads fine there too).
  Two links had no existing icon to reuse: `ProductIcon` (a small stacked
  box — `ExpenseIcon`'s silhouette already means "money spent"
  specifically, so reusing it for the product catalog would misread) and
  `SettingsIcon` (a gear — Settings was a plain text link in the old top
  nav and never needed one before). Both follow `icons.jsx`'s existing
  20×20/1.5px-stroke/`currentColor` convention.
- `App.jsx`'s root layout gained one more nesting level to make room for
  this: the outermost div is now `flex ... xl:flex-row` with `Sidebar`
  and a new `min-w-0 flex-1 flex-col` "main column" div as its two
  children — `Navbar`/`IdleTimeoutMonitor`/`CommandPalette`/the routed
  `Suspense` content/`Footer` all moved one level deeper, into that main
  column, unchanged otherwise. `BottomNav` (phone-only, `fixed`) and the
  portal's own routing (`isPortalRoute`) are unaffected either way — a
  `position: fixed` element's containing block isn't changed by nesting
  depth alone (only `transform`/`filter`/`perspective`/`contain: paint`
  ancestors would do that, and nothing in this new wrapper sets any of
  those), and `PortalApp` was already rendered inside the routed content,
  never touching `Sidebar`/`Navbar` at all. (`Sidebar`'s own mobile drawer
  mode, added later, portals its content straight to `document.body`
  rather than relying on this nesting at all — see "Mobile/tablet drawer
  mode" below for why.)
- `Navbar.jsx` lost its own `xl:flex` desktop branch entirely (search,
  the link row, "My account", `ThemeToggle`, "Log out") — that content
  now lives in `Sidebar.jsx` instead, so keeping a parallel, now-dead copy
  in `Navbar.jsx` would just be two places to update the same thing. The
  `<header>` itself gained `xl:hidden` so the mobile/tablet top bar
  disappears completely once `Sidebar` takes over, and the mobile menu
  toggle / tablet dropdown's own now-redundant `xl:hidden` qualifiers
  were dropped (the parent already hides at that breakpoint) rather than
  left as harmless-but-confusing dead specificity.
- **Mobile/tablet drawer mode**: the hamburger button (top-left of
  `Navbar.jsx`'s header, visible at every width that header itself renders
  at — phones included, not just tablets, see "Top-left hamburger,
  top-right avatar" under "Mobile design system" above) used to open a
  flat, separately-maintained link-list dropdown; it now opens
  `Sidebar` itself (`{user && menuOpen && <Sidebar mobileOpen
  onMobileClose={() => setMenuOpen(false)} />}`), only mounted while
  actually open — same "don't keep a popup's effects alive in the
  background" convention `Modal.jsx`/`BottomSheet.jsx` already follow.
  This means the tablet nav is now guaranteed to show the exact same
  links/icons/filtering as the persistent desktop sidebar (no second copy
  to drift out of sync), and `Navbar.jsx` itself dropped the
  `visibleLinks`/`isActive`/`handleLogout` helpers it used to need for the
  old dropdown — `Sidebar.jsx` already owns all three internally. With
  `mobileOpen` true, `Sidebar` renders a backdrop (`fixed inset-0 z-30
  bg-slate-900/50 xl:hidden`, click-to-close) plus itself as a slide-in
  panel (`fixed inset-y-0 left-0 z-40 flex w-72 flex-col`, the `xl:*`
  classes from the persistent case left untouched so `xl:sticky`/`xl:flex`
  /etc. still correctly override them at that breakpoint if the viewport
  is ever resized while a drawer happens to be open) — plus a visible
  close (`X`) button in its own header row, and the same Escape-to-close +
  `document.body.style.overflow = 'hidden'` scroll-lock contract as
  `Modal.jsx` (a `useEffect` gated on `mobileOpen`, cleaned up on
  close/unmount). Every nav `<Link>`, the wordmark, and the `/account`
  link all call an `onMobileClose?.()` handler on click (`handleLinkClick`)
  so navigating via the drawer also closes it, not just navigates —
  without this, the drawer would still be sitting open over the new page.
  **The one real gotcha**: `Navbar.jsx`'s `<header>` has `backdrop-blur`
  (`backdrop-filter: blur(...)`), and per the CSS Filter Effects spec,
  `backdrop-filter` establishes a new containing block for
  `position: fixed` descendants — same as `filter` does. A first attempt
  at this feature nested the drawer's `<aside>`/backdrop directly inside
  `<header>` (matching where the old dropdown used to render) and the
  drawer silently collapsed to the header's own ~76px height instead of
  the full viewport, since `inset-y-0` was resolving against the header's
  box, not the viewport — confirmed via a Playwright `getBoundingClientRect()`
  check (a `fullPage` screenshot alone was misleading here, since CDP's
  full-page capture can render `position: fixed` elements oddly regardless
  of this bug; the real fix had to be verified with bounding-box math
  against the actual viewport, not a screenshot). The fix is `Sidebar.jsx`
  rendering its drawer-mode content through `createPortal(content,
  document.body)` — but only when `mobileOpen` is true; the persistent
  desktop instance (`mobileOpen` falsy, rendered by `App.jsx` as a
  `<header>`-independent sibling, so it never had this problem) still
  renders inline as before, unaffected. Any future fixed-position overlay
  that might end up nested inside `Navbar.jsx`'s `<header>` (or any other
  `backdrop-blur`/`filter`/`perspective`/`will-change: transform` ancestor)
  needs the same portal treatment — this isn't a one-off Sidebar quirk, it's
  how CSS containing blocks work.
- **`BottomNav.jsx`'s own "Menu" tab — added, then removed again.** Phones
  briefly got a second route into this same drawer: a sixth `BottomNav.jsx`
  tab that first opened `components/BottomSheet.jsx` with a flat link list,
  then (following the identical pattern described just above)
  `<Sidebar mobileOpen onMobileClose={...} />` directly — `BottomNav.jsx`'s
  own `<nav>` also carries `backdrop-blur`, which would have hit the exact
  same containing-block bug described above if `Sidebar` didn't already
  portal its drawer-mode content to `document.body` itself, so this second
  caller needed no bug-avoidance work of its own. That tab was then removed
  outright once the *same* trigger moved into `Navbar.jsx`'s own header
  instead — top-left corner, every width below `xl:` including phones (see
  "Top-left hamburger, top-right avatar" under "Mobile design system"
  above) — leaving `BottomNav.jsx` with just its primary shortcut tabs
  (Settings joined them later, see that section's own note) and exactly
  one way to reach the full nav, not two.

### Notification center

A bell icon in the top nav, global to every logged-in page, surfacing what
already needs attention — asked for directly as "a notification center on
the top navbar," which in this app's post-sidebar layout means two
different literal locations (see "Sidebar navigation (desktop)" above):
`Sidebar.jsx` *is* the top nav at `xl:` and up, and `Navbar.jsx`'s
`<header>` is the real top nav below that. `components/NotificationCenter.jsx`
is one shared component mounted in both, rather than two separate
implementations, the same "one source of truth, filtered by breakpoint"
approach `BUSINESS_LINKS` already established for the nav links themselves.

- **Deliberately no backend route, no notifications table, no read/unread
  state.** This is a live, computed view built entirely from three existing,
  already-permission-gated list endpoints — the same "don't build it until
  needed" call this app already makes elsewhere (`routes/reports.js`'s
  un-paginated currency-exchange list, `routes/licenses.js`'s own renewal
  history) — not a persisted per-user inbox. Two of the three categories are
  a straight reuse of `pages/Dashboard.jsx`'s own "Needs attention" panel
  logic, fetched independently here rather than imported from that page
  (a different component, same acceptable-duplication precedent
  `EXPIRY_WARNING_DAYS` already sets between `routes/licenses.js` and
  `lib/scheduler.js`): **overdue invoices** (`api.invoices.list(token,
  { status: 'sent' })`, filtered client-side to `is_overdue`, sorted
  oldest-due-first — there's no server-side overdue filter, same as
  Dashboard's own fetch) and **licenses expiring soon**
  (`api.licenses.list(token, { status: 'expiring_soon' })`, sorted
  soonest-first). The third category Dashboard's panel doesn't cover:
  **pending quote requests** (`api.quoteRequests.list(token, { status:
  'pending' })`) — a request sitting unanswered is exactly the kind of
  thing this component exists to surface, and Dashboard's own panel was
  never revisited to add it (this component isn't a Dashboard replacement,
  it's a global companion to it). Each of the three fetches is independently
  gated on its own view permission (`invoices`/`licenses`/`quotes`) via
  `can()`, so a partial-access staff user sees only what they're actually
  allowed to see — the same per-category gating `routes/search.js` already
  does for global search, just client-side here since these are three
  ordinary already-gated list endpoints, not a dedicated aggregation route.
  The whole bell renders nothing (`return null`) if a user holds none of the
  three permissions, rather than an empty, pointless bell.
- **Fetch timing**: `load()` runs once on mount (per permission grant) and
  again every time the dropdown is opened (`useEffect` on `open`) — so a
  tab left open for a while doesn't keep showing a stale count for as long
  as it stays closed, without needing a polling interval running in the
  background the whole time. Every fetch is best-effort (`.catch(() => {})`),
  matching Dashboard's own panel — a failed fetch just leaves that
  category empty rather than surfacing an error from what's meant to be a
  lightweight, ambient widget.
- **UI**: a `BellIcon` button (reused as-is from the existing Remind/Send-
  reminder icon — a bell already means "notification" universally, no new
  glyph needed) with a red count badge (capped display at `9+`) when the
  combined total across all three categories is non-zero, opening an
  absolutely-positioned dropdown on click — same outside-click-to-close
  `mousedown` listener + `boxRef` pattern `components/GlobalSearch.jsx`
  already uses for its own results dropdown, not a `Modal`/`BottomSheet`
  (this is a small anchored popover, not a full takeover). Each category
  renders as its own labeled section (icon + color matching the semantic
  meaning already established elsewhere — red `AlertTriangleIcon` for
  overdue, amber `LicenseIcon` for expiring, `InboxIcon` for quote
  requests), capped at `LIMIT_PER_TYPE` (5) with a "+N more" link to the
  full list page when a category has more than that — clicking any item or
  the "+more" link closes the dropdown and navigates (`useNavigate`, not a
  plain `<Link>`, since closing the dropdown has to happen alongside the
  navigation). Overdue-invoice items link straight to that invoice's own
  detail page (`/invoices/:id`); expiring-license and pending-quote-request
  items link to their respective list pages (`/licenses`, `/quote-requests`)
  rather than a specific row, mirroring Dashboard's own "Needs attention"
  panel exactly (neither Licenses nor QuoteRequests has a per-record routed
  detail page to link to — both are list+modal pages, see their own notes
  above). An empty state ("You're all caught up.") renders when the total
  is zero, rather than an empty dropdown with just a header.
- **The one real layout bug this surfaced**: the dropdown's default
  anchor (`right-0`, absolutely positioned against its own `relative`
  wrapper) assumes there's room to its left to grow into — true for
  `Navbar.jsx`'s header, which spans the full viewport width, but false
  for `Sidebar.jsx`, where the bell sits near the top-right of a narrow
  240px column: a `right-0`-anchored `w-80` (320px) dropdown there
  necessarily extends further left than the sidebar's own left edge,
  overlapping/clipping against the browser window's own left edge rather
  than opening cleanly into the roomy main content area beside it (caught
  visually via a Playwright screenshot, not by reasoning about the CSS
  alone). Fixed with an `align` prop (`'right'` default, `'left'` for the
  `Sidebar.jsx` instance only) that swaps which edge the dropdown anchors
  to — `align="left"` there means the dropdown's *left* edge lines up with
  the bell instead, growing rightward into the main content area, which
  always has room regardless of how narrow the sidebar itself is.
  `Navbar.jsx`'s instance stays on the default right anchor, which was
  never actually a problem there (verified at phone, tablet, and desktop
  widths) — the header's own width, not the button's position within it,
  is what determines whether that anchor has room, and the header is
  always at least as wide as the dropdown.
- **Placement and theming**: `Sidebar.jsx` renders it in the top wordmark
  row (next to the drawer-mode-only close button, both now wrapped in a
  shared `flex items-center gap-0.5` container), with the same forced-light
  `!text-lagoon-200 hover:!bg-white/10 hover:!text-white` override
  `ThemeToggle`'s own Sidebar usage already needs — the component's default
  slate-toned button styling is tuned for the app's themed page background,
  not this permanently-dark `bg-lagoon-950` panel, and a plain override
  class isn't guaranteed to win the cascade there (see `ThemeToggle`'s own
  note on why `!important` is needed). The dropdown panel itself is
  unaffected by that override — it's a light-surfaced (`bg-white
  dark:bg-slate-900`) popover regardless of the sidebar's own fixed dark
  background, same as `GlobalSearch`'s own results dropdown. `Navbar.jsx`
  renders it between the phone-only search-toggle button and `ThemeToggle`,
  visible at every width that header itself renders at (phone through
  tablet) — unlike the hamburger, which is `sm:flex hidden` (phone uses
  `BottomNav` instead), the bell has no phone-specific replacement, so it
  stays visible there.

### Icon action buttons

A standing, app-wide convention: every list/detail page's row and header
action buttons carry an icon, not just text — started on
`pages/business/Licenses.jsx` (see above for the fuller story of why),
then rolled out to every other page with the same shape once the pattern
proved out, rather than staying a one-off.

- `components/IconActionButton.jsx` — the shared building block for
  **row-level** actions (Edit/Delete/Renew/Duplicate/etc.): a compact
  `h-9 w-9` icon-only button, `rounded-md` with a visible border and a
  tone-tinted hover fill, so it reads as a real button rather than bare
  colored text even at that size. Takes `{ icon, tone, title, label,
  onClick, disabled, spinning, type }` — `tone` is one of `lagoon` /
  `emerald` / `amber` / `orange` / `slate` / `red`, the same semantic
  colors used everywhere else in the app (red = destructive, emerald =
  positive, etc.); `title` doubles as the tooltip and, when `label` is
  omitted, the `aria-label` too (pass `label` separately only when the
  two need to differ, e.g. a title that changes to a busy-state message
  like "Renewing…" while the accessible name should stay constant);
  `spinning` adds `animate-spin` to the icon for a literal loading
  indicator (used by Renew's `RefreshIcon` — see `Licenses.jsx` above for
  why not every action's icon gets this treatment). Every list page's
  desktop table action cell and mobile `MobileListAccordion` card use the
  exact same `IconActionButton` calls (just wrapped in a `flex justify-
  end gap-1.5` vs. a plain `flex gap-1.5 pt-1` container), so the two
  breakpoints can never drift.
- Row actions built on `IconActionButton`: `Licenses.jsx` (Renew/Cancel/
  Reactivate/Remind/History/Edit/Delete — the original, most elaborate
  case, see above), `Clients.jsx`/`Products.jsx`/`Expenses.jsx`/
  `CapitalContributions.jsx`/`OwnerDraws.jsx`/`RecurringInvoices.jsx`
  (Edit/Delete, tone `slate`/`red`), `Users.jsx` (Edit/Reset password/
  Delete — the new
  `KeyIcon` is this page's one addition, since nothing else in the app
  needed a "reset password" glyph), `InvoiceDetail.jsx`'s Payments
  table (Download/Email per receipt row, both tone `lagoon`), and
  `Quotes.jsx`/`Invoices.jsx` (Edit/Download PDF/Email to client/
  Duplicate/Void — see "Quote/invoice row actions" below).
- **Quote/invoice row actions**: `Quotes.jsx` and `Invoices.jsx` originally
  had no per-row actions at all — a list row was just data, and every
  action (Edit, Download, Email, Duplicate, Delete) only existed on the
  document's own detail page (see the bulk-select-removal note above).
  Both list pages now carry a `rowActions(item)` helper, the exact same
  shape as `Licenses.jsx`'s own — rendered once in the desktop table's
  trailing action `<td>` (`flex justify-end gap-1.5`) and once inside each
  row's `MobileListAccordion` expanded body (`flex flex-wrap gap-1.5
  pt-1`), so mobile and desktop can never drift, per the shared-helper
  convention described above. The action set is deliberately narrower than
  the detail page's own button row: Edit/Download PDF/Email to client/
  Duplicate/Void only — actions that need more than a single click or a
  simple confirm (Send reminder, Convert to invoice, Record payment) stay
  detail-page-only, reachable by tapping into the row (Void is the one
  exception — a single click opens `VoidReasonModal`, see "Neither quotes
  nor invoices can be deleted..." above, so it earns a row-level shortcut
  the others don't). Edit
  (`PencilIcon`, tone `slate`) navigates via `onClick={() =>
  navigate(...)}` rather than a `<Link>`, since `IconActionButton` has no
  link variant — same reasoning `Licenses.jsx`'s own edit action (which
  opens a modal instead) never needed a `<Link>` either. Download PDF
  (`DownloadIcon`, tone `lagoon`) is the one action with no `canManage`
  gate, matching the detail page's own ungated "Download PDF" button — a
  view-only user can still read a document, just not act on it. Email to
  client (`SendIcon`, tone `lagoon`) opens the same `EmailPreviewModal`
  pattern as the detail pages, one shared instance per list page keyed by
  `emailModal` (the target row's id, or `null`) rather than a `{type,
  paymentId}` object like `InvoiceDetail.jsx`'s — these two list pages only
  ever trigger the one `send` email type, never `remind`/`receipt`, so a
  bare id is enough. Duplicate (`DuplicateIcon`, tone `slate`) reuses the
  same `confirm({..., danger: false})` guard the detail-page Duplicate
  buttons already have (see `useConfirm`/`ConfirmDialog` above) and, on
  success, navigates straight to the new draft's own detail page — not a
  list refresh — the same behavior `QuoteDetail.jsx`/`InvoiceDetail.jsx`'s
  own Duplicate already has, since a fresh duplicate is something to review
  next, not just another row in the list. Void (`XIcon`, tone `red`) opens
  `VoidReasonModal` for that row rather than acting immediately — see
  "Neither quotes nor invoices can be deleted..." above for the shared
  component and each list's own `canVoid()` gate. Edit and Email to client
  are both additionally gated to match the detail page's own rules:
  `Invoices.jsx`'s Edit only shows when `!isLocked` (`status` isn't
  `sent`/`paid`, computed inline per row — mirrors `InvoiceForm.jsx`'s own
  guard) and Email to client is hidden once `status === 'void'` (mirrors
  `InvoiceDetail.jsx`'s own `invoice.status !== 'void'` gate); `Quotes.jsx`
  has neither restriction, matching `QuoteDetail.jsx`, which locks nothing.
  `Invoices.jsx`'s Duplicate is additionally hidden once `status === 'paid'`
  (both here and on `InvoiceDetail.jsx`'s own button row) — cluttering a
  finished invoice's actions with one more thing to second-guess wasn't
  worth it, so it's a UI-only scope decision, not a safety fix (the API
  still allows duplicating a paid invoice into a fresh draft). Void is
  unaffected by this — it's already `canVoid`-gated to `draft`/`sent`
  invoices with `amount_paid === 0`, which a `paid` invoice never
  satisfies, so it was already implicitly hidden here.
  A shared `busy: { id, action }` state (same shape as `Licenses.jsx`'s
  own) tracks which row and which specific action is in flight, so
  Duplicate/Delete on the same row each show their own correct
  spinning/disabled state independent of each other; Download and Email
  aren't tracked this way since one opens a new tab and the other opens a
  modal, neither with a meaningful "busy" row state to show. Both pages'
  `TableSkeleton` `cols` arrays gained a trailing entry for the new action
  column.
- **Header** action buttons (Analytics, Export CSV, Export Excel, New X)
  and **detail-page** action buttons (Edit, Download PDF, Email to
  client, Send reminder, Duplicate, Convert to invoice, Void, Delete,
  Record payment) are a different shape — prominent, multi-word, already
  visually button-styled (bordered or filled) before this convention
  existed — so these keep their text and just gain a **leading icon**
  inline in the same `<button>`/`<Link>` (`flex items-center gap-1.5`),
  rather than switching to `IconActionButton`'s icon-only shape. Applied
  to every list page's header row (`Clients.jsx`, `Products.jsx`,
  `Expenses.jsx`, `CapitalContributions.jsx`, `OwnerDraws.jsx`,
  `RecurringInvoices.jsx`, `Users.jsx`, `Quotes.jsx`, `Invoices.jsx`,
  `Licenses.jsx`) and both document detail pages (`QuoteDetail.jsx`,
  `InvoiceDetail.jsx`).
  **Every header button row wraps** (`className="flex flex-wrap gap-2"` on
  the `<div>` holding the row) rather than staying on one unbreakable line
  — the header buttons on `Quotes.jsx`/`Invoices.jsx`/`Licenses.jsx` in
  particular (Analytics, Export CSV, Export Excel, New X — 4 buttons, the
  most of any list page) overflowed past the page's own right padding on a
  phone-width screen before this, pushing "New quote"/"New invoice"/
  "New license" (and part of the row before it) outside the visible page
  margin instead of wrapping onto a second line; `QuoteDetail.jsx`/
  `InvoiceDetail.jsx`'s own action-button rows already wrapped
  (`flex flex-wrap gap-2`) and never had this problem, so the list-page
  header rows were brought in line with that existing pattern rather than
  inventing a new one. `RecurringInvoices.jsx`'s outer header container
  was also missing `flex-wrap` (`flex items-center justify-between` with no
  `gap-3`, unlike every sibling list page's `flex flex-wrap items-center
  justify-between gap-3`) — it never actually overflowed since that page's
  header only ever holds one button, but was brought in line for the same
  reason: one button away from the same bug otherwise.
- **Deliberately left untouched**: every modal-form's Save/Cancel footer
  (`Clients.jsx`, `Products.jsx`, `Expenses.jsx`,
  `CapitalContributions.jsx`, `OwnerDraws.jsx`, `RecurringInvoices.jsx`,
  `Users.jsx` — both its create/edit and reset-password forms,
  `Licenses.jsx`) and any other
  plain form-submit button (e.g. `QuoteDetail.jsx`'s inline "Create
  invoice" convert form). These are all the exact same shared
  Save/Cancel-footer shape reused verbatim across every resource in the
  app — icon-ing it on just one or two pages would make those the
  inconsistent ones, not a polished addition — and a form's own submit
  button reads as "submit this form," not a standalone action a user
  scans for among several others, so it doesn't have the same
  scannability problem the row/header buttons above were solving.
  `Financials.jsx`'s receipt-download button and `Reports.jsx`'s
  per-report "Download PDF" buttons are similarly out of scope: each is a
  single, already clearly-labeled action embedded in its own context
  (a data table cell, a dedicated report card), not one of several
  same-row actions competing for scannability.
- `components/icons.jsx` gained several icons across this rollout, all
  following the file's existing 20×20/1.5px-stroke/`currentColor`
  convention: `RefreshIcon` (Renew), `BellIcon` (Remind/Send reminder),
  `HistoryIcon` (a clock with a back-arrow tail — deliberately distinct
  from the plain `ClockIcon`, which already means "expiring soon"
  elsewhere on `Licenses.jsx`), `PencilIcon` (Edit), `TrashIcon`
  (Delete), `DownloadIcon` (Export/Download PDF/receipt download),
  `PlusIcon` (New X/Record payment — kept separate from
  `FloatingActionButton.jsx`'s own private inline `PlusIcon`, since
  consolidating the two wasn't otherwise in scope), `KeyIcon` (Reset
  password), `SendIcon` (Email to client/receipt — a paper plane,
  distinct from `BellIcon`'s reminder-nudge meaning), and `DuplicateIcon`
  (two overlapping documents, for Duplicate).

### Responsive / PWA

The app is a responsive installable PWA (installable on iOS/Android home
screens), configured via `vite-plugin-pwa` in `vite.config.js`:

- The manifest (name, icons, `theme_color`, `display`/`display_override`) is
  generated from the `manifest` option at build time — don't hand-edit a
  `manifest.webmanifest` file, it doesn't exist in source, only in `dist/`.
  `display: 'standalone'` is the required, universally-supported base (hides
  the browser's own URL bar/tabs, keeps the OS status bar); `display_override:
  ['fullscreen', 'standalone']` asks browsers that support it to additionally
  hide the status bar for full immersion first, falling back to the plain
  `standalone` behavior anywhere that's unsupported or declined — mainly an
  Android/desktop-install distinction, since iOS doesn't differentiate
  fullscreen from standalone for installed web apps at all.
- Icon source files live in `frontend/public/` (`favicon.svg`,
  `favicon-32x32.png`, `pwa-192x192.png`, `pwa-512x512.png`,
  `maskable-icon-512x512.png`, `apple-touch-icon.png`) — all derived from
  `logo-symbol.png` (the real business mark, also used directly on
  `Login.jsx`; a matching `logo-wordmark.png` exists too but isn't used in
  any icon, just as page-level branding), composited onto a white background
  (matching the manifest's own `background_color`) and centered at a size
  appropriate to each icon's role: ~66% of the canvas for the standard/
  apple-touch icons, ~50% for the maskable icon (so the mark survives being
  cropped into a circle/squircle/rounded-square by the OS — the maskable
  spec's "safe zone" is roughly the inner 80%, and 50% leaves real margin),
  and ~80% for the 32px favicon (a busier mark reads poorly that small, so
  it gets a larger fraction of the tiny canvas than the bigger icons do).
  `favicon.svg` embeds a modest-resolution (128px-wide) raster copy of the
  same logo as a base64 `<image>` inside an SVG wrapper — not true vector
  art (there's no vector source), but still lets browsers that prefer an SVG
  favicon link pick it up; kept at 128px rather than a larger/crisper embed
  purely to keep the file small, since a favicon is fetched on every page
  load. None of this is generated at build time — if the logo changes,
  regenerate each of these files by hand (crop `logo-symbol.png` to its
  content bounding box, composite centered on the sized/backgrounded canvas)
  and replace them; there's no script wired into the build for it.
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
- **Route-level code-splitting**: every page component `App.jsx` routes to
  is loaded via `React.lazy(() => import(...))` rather than a static
  top-of-file import, wrapped in one `<Suspense fallback={<RouteFallback
  />}>` around the whole `<Routes>` block — `RouteFallback` reuses
  `ProtectedRoute.jsx`'s own "Loading…" markup verbatim, so a chunk still in
  flight reads as the same kind of pause the app already shows while
  resolving auth, not a new pattern. Before this, all 26 routed pages
  (Reports, Email Center, every analytics page, the PDF-adjacent code, all
  of it) shipped in one ~562KB (131KB gzip) JS bundle that had to finish
  downloading before even the Login page could render — and since it was
  one bundle, any single-line change to any one page invalidated that whole
  file's hash, forcing every returning user to re-download the entire thing
  on their next visit regardless of which page they actually changed.
  Splitting by route dropped the shared/initial chunk to ~262KB (81KB
  gzip) with each page now its own few-KB chunk fetched on demand, and a
  deploy now only invalidates the chunk(s) that actually changed. This
  doesn't change what the service worker eventually precaches (see above —
  it still walks the full asset list after install), only what has to
  arrive before the very first paint and what a routine deploy invalidates.
  `QuoteForm.jsx`/`InvoiceForm.jsx` are `import`ed both ways — lazily by
  `App.jsx`'s own routes (`/quotes/new`, `/quotes/:id/edit`, etc.) and
  statically by `Quotes.jsx`/`Invoices.jsx` for their embedded "New X"
  modal (see `components/Modal.jsx` above) — Rollup resolves this
  automatically into one shared chunk either caller pulls in, no manual
  wiring needed. `vite.config.js` also gained a `preview.proxy` block
  mirroring the existing `server.proxy` (`/api` → `localhost:4000`) — it
  was missing before, so `npm run preview` (the one workflow command that
  actually serves the real production build, the only way to verify
  chunking like this end to end) had no backend connectivity at all.
- **Stale-chunk recovery after a deploy**: every chunk's filename carries a
  content hash, so a browser tab left open across a deploy is still
  holding the *old* `index.html`'s chunk map. Navigating to a route whose
  chunk was renamed or removed by the new deploy 404s that dynamic
  `import()`, which used to unmount the whole app rather than just the one
  route (see "Error boundaries" below for why, and for the rest of the
  story — this fix alone turned out not to be the full explanation the
  first time it was tried). `main.jsx` listens for `vite:preloadError` —
  the event Vite's own dynamic-import wrapper fires specifically when a
  chunk fails to load — and calls `window.location.reload()` once, which
  fetches the current `index.html` and chunk map and resolves the failed
  navigation transparently. A plain module-scoped boolean (not
  `sessionStorage`, since the failure mode this guards is JS-context-scoped,
  not page-scoped) stops a second `vite:preloadError` in the same page load
  from triggering a second reload, so a *genuinely* broken deploy (not just
  a stale local cache) fails once and stays failed rather than
  reload-looping the tab forever. This note originally claimed
  `registerType: 'autoUpdate'` already handled the common case in the
  background (periodically detecting a new service worker and reloading) —
  that turned out to be wrong, not just incomplete; see "Service worker
  update wiring" below for what `autoUpdate` actually does on its own
  (nothing, without the fix documented there) and why. Still a real,
  worthwhile fix for the failure mode it targets (a stale *chunk map*
  specifically, on a click into a changed route) — it just isn't, and
  never was, a general "the app is running an old version" fix the way
  this note first framed it.
- **Service worker update wiring**: a report of "I don't see the
  notification center on mobile" (an admin, on the live deployed site —
  ruling out both a code bug, since the feature worked correctly in every
  local/production-build test, and a permission-gating explanation, since
  admins always hold every permission) turned out to be the real version of
  the gap the stale-chunk note above only partially closes: a tab (or
  installed PWA) left open across a deploy, never navigated, never
  reloaded. `registerType: 'autoUpdate'` in `vite.config.js`'s `VitePWA()`
  only controls how the *generated service worker itself* behaves once a
  new version is found and activated (`skipWaiting`/`clientsClaim`, so it
  takes over instantly rather than waiting for every tab to close) — it
  does nothing to make the browser actually go looking for that new
  version, and does nothing to reload an already-open tab once it does.
  That behavior only exists in vite-plugin-pwa's `virtual:pwa-register`
  module — and this app was never importing it. `injectRegister` defaults
  to `'auto'`, which resolves to the plugin's own bare, auto-injected
  `registerSW.js` (`if ('serviceWorker' in navigator) { … .register('/sw.js') }`,
  literally nothing else) *unless* the app's own source statically imports
  `virtual:pwa-register` somewhere — which this app never did, so it had
  silently been running the dumb version the entire time. The bare script
  has no listener for a new service worker activating, so even once the
  browser did eventually notice a new `sw.js` (only guaranteed on
  navigation, or roughly once every 24 hours in the background otherwise —
  an infrequent check for a dashboard tab someone just leaves open), the
  already-rendered page never learned about it and kept running the old
  JS in memory indefinitely. `main.jsx` now imports `registerSW` from
  `virtual:pwa-register` (vite-plugin-pwa detects that import at build
  time and swaps to it instead of injecting the bare script — confirmed by
  checking `dist/index.html` no longer references `registerSW.js` after
  this change) with an `onRegisteredSW` callback that polls
  `registration.update()` every hour, so an idle open tab checks for a new
  deploy on its own schedule rather than whatever infrequent interval the
  browser would otherwise pick. With `registerType: 'autoUpdate'`, the
  module's own internal `activated` listener calls `window.location.reload()`
  automatically the moment a new service worker takes over — no prompt, no
  `onNeedRefresh` needed, matching the "silent, automatic" contract
  `autoUpdate` was always supposed to provide. Verified end-to-end (not
  just "does it register") with two real builds: opened a page against a
  v1 build (`window.__BUILD_MARKER__` unset), swapped the served `dist/`
  files to a v2 build in place — the same thing a real redeploy does to an
  already-open tab — called `registration.update()` (simulating the hourly
  check firing), and confirmed the page reloaded on its own and came back
  up on the same route (`/dashboard`) now running v2's code
  (`window.__BUILD_MARKER__ === 'v2'`). Before this fix, that same test
  never reloads — the marker stays unset forever, exactly matching what
  the mobile report described.
- **Error boundaries**: nothing in this app caught a render-time crash
  anywhere until `components/ErrorBoundary.jsx` was added — React's default
  behavior with no error boundary in the tree is to unmount *everything*
  on an uncaught error during render, not just the failing subtree, which
  is what turns one bad page into a blank app with the sidebar and nav gone
  too. This is the second half of a fix that started out misdiagnosed: a
  report of "`ExpenseAnalytics.jsx` opens a blank page" was first read as
  the stale-chunk problem above (it reproduced nowhere locally — fresh dev
  server, fresh production build, empty data, realistic synthetic data,
  every combination rendered fine), shipped as that fix alone, and the
  report came back unchanged — "rest of the analytics works perfectly, I
  only [have] expenses analytics open a blank page," which the stale-chunk
  theory never actually explained (that failure mode is transient and
  route-agnostic, not consistently pinned to one specific page). The real
  cause turned out to be data-shaped, not deploy-shaped:
  `expenses.exchange_rate` is a nullable column added via `ALTER TABLE` to
  a table that already had real `category = 'currency exchange'` rows (see
  `db/index.js`'s migration note on this exact column) — every row created
  before that migration ran, or before the `validate()`/CSV-import checks
  that now require a positive rate for that category existed, carries
  `exchange_rate = NULL` in the live database. `withComputedUsd()` (see
  `routes/expenses.js` above) correctly returns `amount_usd: null` for
  exactly those rows, and `Expenses.jsx`'s own list page already guarded
  every read of it with `!== null` — but `ExpenseAnalytics.jsx`, added in a
  later change, called `t.amount_usd.toFixed(2)` unconditionally in two
  places (the currency-exchange-transactions table's desktop and mobile
  rows), which throws the instant a single legacy no-rate row renders.
  With no error boundary anywhere, that throw unmounted the whole tree —
  a page that looked identical to a stale-chunk failure from the outside
  (same blank result, same total absence of console errors visible to a
  user who isn't watching devtools), but that no synthetic test database
  could ever reproduce, since every test row this app's own test suite of
  Playwright scripts had ever created went through the validated write
  path and therefore always had a real rate. Fixed on both sides: the two
  unconditional `.toFixed()` calls in `ExpenseAnalytics.jsx` now check
  `amount_usd !== null` first (falling back to `'—'`, matching
  `Expenses.jsx`'s own convention exactly), and `ErrorBoundary.jsx` (a
  class component — error boundaries have no hook equivalent, so this is
  the one class component in an otherwise all-function-component codebase)
  is now rendered once in `App.jsx` around the `Suspense`/`Routes` block,
  keyed by `location.pathname` so navigating to any other route remounts
  it and clears whatever it caught. This is deliberately defense-in-depth,
  not just a fix for the one bug found: the boundary means *any* future
  render-time crash on *any* page — this one's cause, or one nobody's
  thought of yet — shows a recoverable "This page hit an error and
  couldn't load" message with a reload button, sidebar and nav still fully
  intact, rather than silently taking down the entire app. The four
  analytics routes' own year-loop math (`routes/expenses.js`'s,
  `routes/invoices.js`'s, `routes/quotes.js`'s, and `routes/licenses.js`'s
  `GET /analytics`, all following the identical `dateStr.slice(0, 4)`
  shape) got a matching backend-side hardening pass at the same time, for
  the same reason as the frontend fix: defense against a class of bug, not
  just the one instance found. A blank/malformed date value used to throw
  outright, or worse — `Number('')` is `0`, not `NaN`, so an empty-string
  date silently computed as year 0 and made the `for (year = currentYear;
  year >= minYear; year--)` loop iterate ~2000 times instead of the
  handful of real years, returning a huge, slow, mostly-empty response
  rather than an obvious error. Each route's `yearOf()` now returns `null`
  for anything that isn't a plausible year (not a string, too short, or
  outside a 1990–current-year+1 band), and a row with no derivable year is
  simply left out of the yearly breakdown rather than corrupting the
  range — everything else that doesn't need a date (category/status
  breakdowns, top-client/payee lists, all-time totals) still counts it.
  Each route's handler body is also now wrapped in try/catch, logging and
  returning a proper `{ error }` JSON response instead of an unhandled
  exception, so any failure mode none of this anticipated still surfaces
  as a real error the frontend's existing `.catch()` can show inline,
  rather than a raw 500 with no body or (pre-`ErrorBoundary`) a blank
  page.

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
