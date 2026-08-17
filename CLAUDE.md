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
  production data since the very first deploy.
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
  `licenses`, `financials`, `activity`, `settings`, `users`, `import`) —
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
`q` and `page` compose freely, and CSV export routes (`GET /export.csv`)
are deliberately untouched by either, always returning every row.

- `routes/clients.js`, `routes/settings.js` — plain CRUD for `clients`, and
  GET/PUT for the single-row `business_settings` table (business name,
  address, tax ID, currency symbol, bank details, `session_timeout_minutes`
  — see "Idle session timeout" below — this is what prints on every PDF's
  header/footer, plus the one security policy value). `clients.js` also has
  `GET /export.csv` (registered before `GET /:id` so it isn't shadowed by
  the `:id` param). `PUT /` validates `session_timeout_minutes` is a whole
  number between 1 and 480, and `starting_balance` is any finite number
  (negative allowed — an overdraft on the day you started using the app is
  a valid starting point, see "Bank balance" in `routes/financials.js`
  below). `GET /` supports `?q=` (name/email) and
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
  existing "has recorded payments" guard below. **Invoices only**, also:
  `POST /:id/void` is the actual way an invoice becomes `void` — a
  dedicated action route rather than a `status` value on the generic
  `PUT /:id` above, because that route already 409s once `status` is
  `sent`/`paid`, but voiding is precisely the escape hatch a *sent*
  invoice needs (cancel a mistake, e.g. a client backed out) — it has to
  work exactly where `PUT` refuses to. (`PUT /:id` still technically
  accepts `status: 'void'` in its body too, but since it's blocked for
  `sent`/`paid` invoices and the frontend never sends a `status` field at
  all, that path is effectively dead — `POST /:id/void` is the only route
  that matters in practice.) Blocked with 409 if the invoice is already
  `void`, already `paid` (voiding real money needs a refund process, not a
  status flip), or has *any* recorded payment at all — mirrors the
  DELETE guard's "has recorded payments" check, so a partially-paid sent
  invoice can't have its payments silently orphaned by voiding it.
  Voiding also has ripple effects on the other invoice actions, all
  enforced server-side: `POST /:id/send` and `POST /:id/remind` both 409
  on a `void` invoice (there's no reason to email or nag a client about a
  cancelled invoice), and `POST /:id/payments` already rejected `void`
  the same as `draft` before this feature existed. A voided invoice is
  excluded from `routes/financials.js`'s summary and the sales/tax PDF
  reports in `routes/reports.js` (both filter `status != 'void'`), the
  same way those already excluded nothing else — void is the only status
  either of them filters out.
- **License auto-renewal on invoice payment**: `POST /invoices/:id/payments`
  auto-renews any of the invoice's client's *active* licenses that the
  invoice was actually billing for, the moment the payment brings the
  invoice fully to `status: 'paid'` (not on a partial payment) — matches
  the "once they've paid, renew it" framing the manual Renew button already
  uses (see `routes/licenses.js` above), just triggered by a payment
  instead of a click. There's no `invoice_id` column on `licenses` linking
  the two — matching is by content: each `invoice_items.description` is
  trimmed/lowercased and checked against that client's active licenses'
  `name` the same way, so a line item literally naming a license (e.g.
  "LMS Pro Annual License") renews that specific license, and an invoice
  for something unrelated (or naming a `cancelled` license, which is
  excluded from the candidate query entirely) never touches any license at
  all. Multiple matching line items still only renew a license once each;
  an invoice can auto-renew more than one license if it bills for more than
  one by name. The actual renewal — extend `expiry_date` by one billing
  cycle, insert the `license_renewals` row, reset `last_reminder_sent_at`
  — is `lib/licenseRenewal.js`'s `renewLicense()`, the exact same function
  `routes/licenses.js`'s `POST /:id/renew` calls for a human clicking
  "Renew"; extracting it there was what let this feature reuse it here with
  no duplicated logic. Each auto-renewal gets its own `logActivity()` entry
  (`action: 'auto-renewed via invoice payment for'`, attributed to whoever
  recorded the payment — this is a direct consequence of their action, not
  an unattended background job like `lib/scheduler.js`'s cron jobs, so it's
  *not* logged as `'Automated'` the way those are) and is included in the
  response's `autoRenewedLicenses` array (`{ id, name, expiry_date }[]`).
  `InvoiceDetail.jsx`'s `handleRecordPayment()` reads that array and appends
  "Also renewed: X, Y." to the existing "Payment recorded." notice when
  non-empty, so the person recording the payment sees the side effect
  immediately rather than discovering it later on the Licenses page.
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
  expense_date/notes) plus `GET /` (`?q=` search, `?page=` — see
  "Pagination convention" above) and `GET /export.csv`. `GET /` also always
  returns `totalAmount` (`SUM(amount)` over every row matching the current
  `?q=` filter, computed independently of `LIMIT`/`OFFSET`) alongside
  `expenses` — `Expenses.jsx`'s "Total" row reads this rather than summing
  the current page's `expenses` array, so the total stays the true
  search-filtered grand total once pagination means that array is no longer
  the complete result set. `CATEGORIES` is a fixed list (`rent, utilities,
  supplies, salaries, shareholder payments, marketing, software, travel,
  other`) served to the frontend for the category `<select>` — the same
  list (`EXPENSE_CATEGORIES`) is duplicated in `routes/import.js` for CSV
  import validation, so a category added here needs to be added there too.
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
  `StatusBadge`/the mobile accent stripe render. `EXPIRY_WARNING_DAYS = 14`
  is the one threshold controlling both when a still-active license starts
  reading as `expiring_soon` and which licenses `lib/scheduler.js`'s
  automated alert job (below) treats as candidates — duplicated as a literal
  over there rather than imported (same acceptable-duplication call as
  `EXPENSE_CATEGORIES` between `routes/expenses.js`/`routes/import.js`; keep
  both in sync). `GET /` supports `?q=` (license name or client name) and
  `?status=` (one of the four `display_status` values — `statusWhere()`
  translates each into the actual SQL date comparison against `expiry_date`,
  since only `cancelled` is a direct column match) composed with `?page=`
  (see "Pagination convention" above). `GET /summary` is independent of
  pagination/search — a `{ active, expiring_soon, expired, cancelled, total }`
  count across every license, backing the KPI strip at the top of
  `Licenses.jsx` — and `GET /export.csv`, both following the usual
  conventions. **The core action**: `POST /:id/renew` is "the client paid,
  extend it" — advances `expiry_date` by one `billing_cycle` (`monthly` or
  `yearly`, month-end-clamped the same way `lib/scheduler.js`'s own
  `advanceDate()` handles Jan 31 → Feb) from *whichever is later*, the
  current `expiry_date` or today: renewing early keeps the remaining time
  instead of losing it, renewing a lapsed license extends from today instead
  of compounding a backdated short window off the old expiry. Blocked (409)
  only when `status` is already `cancelled` — a cancelled license needs an
  explicit edit back to `active` first, `renew` is for "still active, just
  needs paying," not for un-cancelling. Renewing also clears
  `last_reminder_sent_at` back to `NULL`, so a license that was reminded
  right before renewal doesn't inherit a stale suppression window blocking
  its *next* expiry cycle's alerts. The actual expiry-advancing/
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
  stored/exported/imported alongside `notes` — same precedent: editable via
  the form and included in CSV export/import, but not shown as its own list
  or mobile-accordion column) for the client's activation/portal link;
  nothing currently reads it back out — it's captured now so a future
  activation-email template can interpolate it, not wired into
  `lib/emailTemplates.js`'s `licenseRemindEmail()` yet.
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
  beyond `invoices.amount_paid`. **Bank balance**: `bankBalance` is
  `business_settings.starting_balance` (admin-editable on the Settings page,
  see `routes/settings.js` above) plus `netProfit` — the one number this
  app can vouch for without a real bank feed: whatever balance you had the
  day you set `starting_balance`, plus every payment collected and minus
  every expense recorded since. It's a running proxy, not a live balance —
  anything moving money outside the `payments`/`expenses` tables (a loan, a
  tax remittance, an owner draw never logged as an expense) isn't
  reflected, so it can drift from the real account over time if those go
  unrecorded. `Dashboard.jsx`/`Financials.jsx` both render it as a `KpiCard`
  (icon: `BankIcon`) alongside the other summary figures, tone flipping to
  `negative` the same way `netProfit`'s own card does when the number goes
  below zero (a startup deficit or heavy early spending).
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
  is `business_settings.starting_balance` plus every `payments`/`expenses`
  row dated strictly *before* `from`, closing balance adds every row
  *through* `to` (same inclusive `BETWEEN` convention the other reports
  use) on top of that. None of these routes call `logActivity()` (same
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
  with no SMTP configured at all. Also exports `textToHtml()` — see "Email
  preview before sending" above — the plain-text-to-HTML conversion for a
  user-edited email body.
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
  backs `routes/import.js`.
- `routes/import.js` — `POST /api/import/:type` (`type` is `clients`,
  `expenses`, `invoices`, `quotes`, or `licenses`) bulk-imports historical
  data from CSV text in the request body. Always validates every row first; `commit: false`
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
  same as `"2500"`.
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
  `app.listen` callback) registers four `node-cron` jobs, all server-time:
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
  - `15 8 * * *` — `runLicenseExpiryAlerts()`: staggered 15 minutes after
    the overdue-reminder job purely so the two jobs' console output doesn't
    interleave, not for any functional reason. Same shape as
    `runOverdueReminders()` — skips entirely if `SMTP_HOST` isn't set,
    same 7-day `last_reminder_sent_at` re-send suppression — but selects
    `licenses` where `status = 'active'` and `expiry_date` is within
    `routes/licenses.js`'s `EXPIRY_WARNING_DAYS` (14, duplicated here as a
    literal — see that file's own comment) of today, which naturally
    includes already-lapsed licenses too (a past `expiry_date` is always
    `<=` today+14). Emails via `licenseRemindEmail()` — the same
    admin-editable template the manual "Remind" button on `Licenses.jsx`
    uses, see `lib/emailTemplates.js` above for why this is the one
    automated job that reuses an editable template instead of hardcoding
    its own text — with no PDF attachment (a license isn't a document).
    Logged to `email_log` as type `license_expiry_alert`. No staff-digest
    equivalent to `notifyStaffOfReminders()` for this job — that's scoped
    to overdue invoices specifically, not extended here.
  All four jobs are also exported directly (`runBackup`,
  `generateDueRecurringInvoices`, `runOverdueReminders`,
  `runLicenseExpiryAlerts`) so they can be invoked outside the cron
  schedule (tests, or a manual "run now" action).

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
- `middleware/auth.js`'s `requireAdmin` is a second, stricter gate than
  `requirePermission` — it checks `req.user.role === 'admin'` directly
  rather than consulting `user_permissions`, so no staff grant can ever
  unlock it (unlike every other module in this app, which a staff member
  can be granted access to). Reserved for actions with no per-row undo
  (`routes/dataReset.js`) or, as of the Email Center, for a feature that's
  simply admin-only *for now* by deliberate scope decision rather than a
  no-undo action — `routes/emailCenter.js` reuses the same middleware
  rather than adding a new gatable module to `lib/permissions.js`'s
  `MODULES`, since opening it to staff later (if that turns out to be
  wanted) is a one-line change to `requirePermission('email_center', ...)`
  plus a `MODULES` entry, not a reason to add that plumbing speculatively
  now.
- `routes/dataReset.js` (mounted at `/api/data-reset`, `requireAuth` +
  `requireAdmin`, its own `router.use()` chain independent of the
  `requirePermission`/module system entirely) — `POST /` bulk-deletes
  whichever tables the caller picks via a `categories` array (one or more
  of `clients`, `quotes`, `invoices`, `recurring`, `licenses`, `expenses`,
  `products`, `activity`), rather than an all-or-nothing clear. A
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
  (rendered only when `user.role === 'admin'`, re-checking the same
  condition the backend enforces rather than trusting a hidden button) is
  the only caller — a checkbox per category (`RESET_CATEGORIES`), with
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
  `requireAdmin` via its own `router.use()` chain — same pattern as
  `routes/dataReset.js` above, admin-only for now rather than gated by a
  new `MODULES` entry) — the Email Center's API: `GET /templates` (calls
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
  `reports.js` is the reverse case: every route in it is a read (a PDF
  download, never a mutation), so it applies `requirePermission('financials',
  'view')` once via `router.use()` rather than gating individual routes —
  and reuses the `financials` module rather than declaring its own, since
  these reports surface the same data at the same sensitivity level.

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
  feature existed. `pages/EmailCenter.jsx` (route `/email-center`) is the
  same guard pattern but checks `user?.role === 'admin'` directly instead
  of `can(module, 'view')` — same convention as `Import.jsx`'s
  `DangerZone` below, since this is admin-only for now rather than gated by
  a permission module (see `routes/emailCenter.js` above). It has two
  sections: **Templates**, a `TemplateCard` per editable type (the 4 from
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
  same conditional Renew/Remind/Edit/Delete buttons and duplicating them
  would drift. Renew and Remind buttons are conditioned on the row's raw
  `status` (`active`/`cancelled`), not the computed `display_status` — a
  lapsed-but-not-cancelled license (`display_status: 'expired'`) still
  shows both, mirroring `routes/licenses.js`'s own guards exactly (Renew
  is blocked only by `cancelled`, not by having already expired — that's
  the whole point of a renew button). The "New license"/"Edit license"
  modal's Status field (`active`/`cancelled`) only renders while editing
  an existing license (`editingId` truthy) — a brand-new license is always
  created `active`, there's nothing to toggle yet. Mobile cards get the
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
  "License name" above it) follows the same not-in-the-list-or-card
  precedent as "Notes" below it — captured on create/edit and round-tripped
  through `startEdit()`, but never rendered as its own column or accordion
  row, since nothing currently reads it back beyond the form itself (see
  `routes/licenses.js` above for why: it's there for a future activation-
  email template to interpolate, not wired to one yet).
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
  above) at the bottom, but only when `user.role === 'admin'` — checked
  directly against the role, not `can('import', 'manage')` like the rest
  of this page, since a staff member could be granted that permission
  without being trusted with a bulk, unrecoverable delete.
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
  `Expenses.jsx`) or from the record's own detail page
  (`Invoices.jsx`/`Quotes.jsx`, which never had a per-row list action to
  begin with). `components/BulkActionBar.jsx` was deleted along with its
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
  instead of the route, gain a Cancel button that calls `onCancel`, and call
  `onSuccess(quote)`/`onSuccess(invoice)` instead of navigating internally —
  the list page's `onSuccess` closes the modal and navigates to the new
  document's detail page itself, and `onCancel` just closes the modal. The
  routed `/quotes/:id/edit`/`/invoices/:id/edit` pages are deliberately
  **not** converted to open in a modal from the list — only the "New X" flow
  is — so editing still gets the full page (with its own URL, refresh-safe,
  bookmarkable) and `InvoiceForm.jsx`'s locked-status guard (see below)
  keeps working unmodified.
- `components/Navbar.jsx` — `BUSINESS_LINKS` entries each carry a `module`
  (`null` for Dashboard, which is always visible); the rendered link list
  is filtered through `can(link.module, 'view')` so a restricted user never
  sees a nav link leading to a page that would just reject them — same
  UX-only caveat as the business-page button gating above, not a security
  boundary on its own. The Email Center's entry additionally carries
  `adminOnly: true` (`module: null`, since it isn't gated by the permission
  system at all) — `visibleLinks`'s filter checks
  `(!link.adminOnly || user?.role === 'admin')` alongside the existing
  module check, mirroring `routes/emailCenter.js`'s `requireAdmin` rather
  than a `can()` check, same UX-only caveat. "My account" is appended after
  the filtered links, unconditionally visible to any logged-in user (admin
  or staff) since it's never permission-gated.
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
  (tablets and up still get the hamburger — see `Navbar.jsx` below). Four
  permanent tabs (`PRIMARY_TABS`: Home/Invoices/Quotes/Clients, each
  filtered through `can(module, 'view')` the same way `Navbar.jsx`'s
  `visibleLinks` is) plus a fifth "More" tab that opens a
  `components/BottomSheet.jsx` listing everything else from `Navbar.jsx`'s
  exported `BUSINESS_LINKS` (Products, Recurring, Expenses, Financials,
  Reports, Activity, Users, Email Center when `user.role === 'admin'`,
  Settings) plus "My account" and "Log out" — the same set the old mobile
  drawer held. `App.jsx` renders `<BottomNav />` only when `user` is
  truthy (mirroring `Navbar.jsx`'s own `{user ? ... }` split) and wraps the
  routed `<Routes>` in a `pb-16 sm:pb-0` div so the fixed bar never covers
  a page's last content or action buttons; `FloatingActionButton.jsx`'s
  `bottom` offset was raised to `calc(5.5rem + env(safe-area-inset-bottom))`
  for the same reason, and got the mockup's gradient (`from-lagoon-600
  to-lagoon-700`) + `rounded-2xl` squircle treatment instead of a flat
  circle.
- `components/BottomSheet.jsx` — the mobile counterpart to `Modal.jsx`:
  same open/backdrop-click/Escape/body-scroll-lock contract, but slides up
  from the bottom with rounded top corners and a drag-handle bar instead of
  a centered card, matching the native-mobile-app convention for a menu
  triggered from a bottom tab. Currently used only by `BottomNav.jsx`'s
  "More" tab, but is a generic `{ open, onClose, title, children }`
  component like `Modal.jsx`, not hardcoded to that one caller.
- `components/Navbar.jsx` now splits its previously-single `xl:hidden`
  mobile treatment into two: a phone-only search icon toggle (`sm:hidden`)
  that reveals an inline `GlobalSearch` row below the header (`GlobalSearch`
  gained an `autoFocus` prop for this), since `BottomNav.jsx` replaced
  phones' only other route to `GlobalSearch` (the hamburger drawer); and
  the hamburger toggle itself + its dropdown drawer, now `hidden sm:flex`/
  `hidden sm:block` — visible from `sm` up to `xl` (tablets) only, since
  phones use `BottomNav.jsx` instead. `xl:flex` desktop nav is unchanged.
- `components/KpiCard.jsx` picked up the mockup's card language:
  `rounded-2xl` (was `rounded-lg`), a smaller `rounded-xl` icon chip (was a
  circle), and the value rendered in `font-display font-extrabold
  tabular-nums` instead of a plain `font-semibold` — same `tone`→color
  contract as before (`neutral`/`positive`/`negative`/`warning`), just
  restyled. `components/Accordion.jsx` picked up the same `rounded-2xl`
  for visual consistency with `KpiCard`/`MobileListAccordion`'s cards.
- `pages/Dashboard.jsx` opens with a time-of-day greeting (`greeting()` —
  "Good morning"/afternoon/evening by `new Date().getHours()`) above the
  user's first name in `font-display`, with the business name (falling back
  to the user's email if `business_settings` hasn't loaded yet) underneath
  — replacing the previous plain "Welcome, {name}" + email line.
- `pages/business/InvoiceDetail.jsx` gained a mobile-only (`sm:hidden`)
  gradient hero card between the header actions and the existing Bill-to/
  Details grid: total due in `font-display`, a paid-vs-total progress bar,
  and a Paid/Balance split — desktop has no equivalent (its "Details" card
  already surfaces balance due inline), this is purely a phone-first
  "surface the number before the fold" addition and doesn't change any
  desktop markup or the page's data flow.

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
