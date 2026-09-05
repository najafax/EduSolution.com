const path = require('path');
const Database = require('better-sqlite3');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data.sqlite3');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    reset_token TEXT,
    reset_token_expires TEXT,
    role TEXT NOT NULL DEFAULT 'staff',
    active INTEGER NOT NULL DEFAULT 1,
    notify_overdue INTEGER NOT NULL DEFAULT 0,
    password_changed_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS user_permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    module TEXT NOT NULL,
    can_view INTEGER NOT NULL DEFAULT 0,
    can_manage INTEGER NOT NULL DEFAULT 0,
    UNIQUE(user_id, module)
  );

  CREATE TABLE IF NOT EXISTS business_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    business_name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    tax_id TEXT NOT NULL DEFAULT '',
    currency_symbol TEXT NOT NULL DEFAULT '$',
    bank_details TEXT NOT NULL DEFAULT '',
    session_timeout_minutes INTEGER NOT NULL DEFAULT 30,
    signature_image TEXT NOT NULL DEFAULT '',
    stamp_image TEXT NOT NULL DEFAULT '',
    logo_image TEXT NOT NULL DEFAULT '',
    signatory_name TEXT NOT NULL DEFAULT '',
    pdf_template TEXT NOT NULL DEFAULT 'modern',
    starting_balance REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS quotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT NOT NULL UNIQUE,
    client_id INTEGER NOT NULL REFERENCES clients(id),
    status TEXT NOT NULL DEFAULT 'draft',
    issue_date TEXT NOT NULL,
    expiry_date TEXT,
    notes TEXT NOT NULL DEFAULT '',
    discount_type TEXT NOT NULL DEFAULT 'percentage',
    discount_value REAL NOT NULL DEFAULT 0,
    tax_rate REAL NOT NULL DEFAULT 0,
    subtotal REAL NOT NULL DEFAULT 0,
    discount_amount REAL NOT NULL DEFAULT 0,
    tax_amount REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    converted_invoice_id INTEGER,
    public_token TEXT UNIQUE,
    client_response TEXT,
    client_responded_at TEXT,
    created_by_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS quote_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    quantity REAL NOT NULL DEFAULT 1,
    unit_price REAL NOT NULL DEFAULT 0,
    amount REAL NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    product_id INTEGER
  );

  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT NOT NULL UNIQUE,
    client_id INTEGER NOT NULL REFERENCES clients(id),
    quote_id INTEGER REFERENCES quotes(id),
    recurring_invoice_id INTEGER,
    status TEXT NOT NULL DEFAULT 'draft',
    issue_date TEXT NOT NULL,
    due_date TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    discount_type TEXT NOT NULL DEFAULT 'percentage',
    discount_value REAL NOT NULL DEFAULT 0,
    tax_rate REAL NOT NULL DEFAULT 0,
    subtotal REAL NOT NULL DEFAULT 0,
    discount_amount REAL NOT NULL DEFAULT 0,
    tax_amount REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    amount_paid REAL NOT NULL DEFAULT 0,
    last_reminder_sent_at TEXT,
    public_token TEXT UNIQUE,
    created_by_name TEXT NOT NULL DEFAULT '',
    po_number TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS invoice_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    quantity REAL NOT NULL DEFAULT 1,
    unit_price REAL NOT NULL DEFAULT 0,
    amount REAL NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    product_id INTEGER
  );

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    receipt_number TEXT NOT NULL UNIQUE,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    amount REAL NOT NULL,
    method TEXT NOT NULL DEFAULT 'bank_transfer',
    reference TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    paid_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- A client's uploaded evidence that they paid — a bank transfer slip, a
  -- payment advice, a receipt photo — attached to one invoice from the
  -- client portal (routes/clientPortal.js's POST /invoices/:id/payment-
  -- proof). Deliberately not an automatic payment record: this app has no
  -- payment-gateway integration, so a proof is just that — evidence for a
  -- human to review against the real bank statement and then record
  -- through the existing POST /invoices/:id/payments flow (routes/
  -- invoices.js) same as always. file_data is a base64 data URI, same
  -- storage approach business_settings already uses for logo/signature/
  -- stamp images — no separate file storage service exists in this app,
  -- and a payment slip is small enough (a photo or a short PDF) that
  -- storing it inline is the same acceptable tradeoff. file_type is the
  -- MIME type (image/jpeg, image/png, image/webp, or application/pdf —
  -- see routes/clientPortal.js's own validation), kept as its own column
  -- rather than parsed back out of the data URI on every read. status
  -- (pending or reviewed) lets staff mark one as handled once they've
  -- checked it against their bank statement and recorded the real payment
  -- (or decided it doesn't match anything), so InvoiceDetail.jsx's own
  -- list can visually distinguish "still needs a look" from "already
  -- dealt with" without a separate read/dismissed table.
  CREATE TABLE IF NOT EXISTS payment_proofs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    file_data TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_type TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
    reviewed_by_name TEXT NOT NULL DEFAULT '',
    reviewed_at TEXT
  );

  -- Note: this schema used to also define mod_reports/mod_report_settings
  -- (the Manager on Duty shift-handover checklist) here. That feature has
  -- moved to its own standalone app (../mod-report-backend) with its own
  -- database — see that app's own db/index.js for the current schema.
  -- Deliberately not dropped here: an existing deployment's sqlite file
  -- still has these tables with their historical data untouched (nothing
  -- in this app reads or writes them anymore), available for a one-time
  -- export via scripts/export-mod-reports.js into the new app.

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    unit_price REAL NOT NULL DEFAULT 0,
    tax_rate REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL DEFAULT 'other',
    description TEXT NOT NULL,
    amount REAL NOT NULL,
    expense_date TEXT NOT NULL,
    payee TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    exchange_rate REAL,
    payee_account_number TEXT NOT NULL DEFAULT '',
    usd_destination TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Money an owner/partner puts INTO the business from personal funds — the
  -- mirror image of an expenses row tagged 'shareholder payments' (money
  -- taken OUT), but deliberately its own table rather than a negative
  -- expense: an expense with a negative amount would corrupt every existing
  -- expense total/report that assumes amount > 0, and "contribution" is a
  -- distinct real-world event (a capital injection, not a business cost)
  -- that deserves its own record shape rather than a sign trick. See
  -- routes/capitalContributions.js.
  CREATE TABLE IF NOT EXISTS capital_contributions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contributor_name TEXT NOT NULL,
    amount REAL NOT NULL,
    contribution_date TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_by_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Money an owner/partner takes OUT of the business for personal use —
  -- the mirror image of capital_contributions above (money going IN). A
  -- separate table for the same reason capital_contributions itself is
  -- separate from a negative expense: expenses.amount is validated > 0
  -- everywhere, so a draw needs its own always-positive amount rather
  -- than corrupting that invariant. type ('draw' or 'return') keeps both
  -- halves of this relationship — money taken, and money paid back — in
  -- one place with one running balance, rather than splitting "return"
  -- off into capital_contributions (which already covers a fresh
  -- injection unrelated to any prior draw, a different real-world event
  -- even though the cash movement looks the same).
  CREATE TABLE IF NOT EXISTS owner_draws (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL DEFAULT 'draw',
    taken_by_name TEXT NOT NULL,
    amount REAL NOT NULL,
    draw_date TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_by_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS recurring_invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL REFERENCES clients(id),
    frequency TEXT NOT NULL DEFAULT 'monthly',
    notes TEXT NOT NULL DEFAULT '',
    discount_type TEXT NOT NULL DEFAULT 'percentage',
    discount_value REAL NOT NULL DEFAULT 0,
    tax_rate REAL NOT NULL DEFAULT 0,
    due_in_days INTEGER NOT NULL DEFAULT 14,
    next_run_date TEXT NOT NULL,
    last_generated_at TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS recurring_invoice_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recurring_invoice_id INTEGER NOT NULL REFERENCES recurring_invoices(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    quantity REAL NOT NULL DEFAULT 1,
    unit_price REAL NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_name TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id INTEGER,
    entity_label TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS email_templates (
    type TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS email_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    to_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    sent_by_name TEXT NOT NULL DEFAULT '',
    entity_type TEXT,
    entity_id INTEGER,
    entity_label TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS licenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL REFERENCES clients(id),
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    billing_cycle TEXT NOT NULL DEFAULT 'yearly',
    amount REAL NOT NULL DEFAULT 0,
    start_date TEXT NOT NULL,
    expiry_date TEXT NOT NULL,
    url TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    last_renewed_at TEXT,
    last_reminder_sent_at TEXT,
    last_renewal_confirmation_sent_at TEXT,
    created_by_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS license_renewals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    license_id INTEGER NOT NULL REFERENCES licenses(id),
    previous_expiry_date TEXT NOT NULL,
    new_expiry_date TEXT NOT NULL,
    renewed_by_name TEXT NOT NULL DEFAULT '',
    renewed_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- A client's own login for the (upcoming) self-serve portal — deliberately
  -- a separate table rather than columns bolted onto clients: this is an
  -- auth concern, not business data (same reasoning user_permissions is
  -- split from users), and clients.email isn't unique/required today, so
  -- login identity needs its own constrained column. One row per client
  -- (client_id UNIQUE) — a client portal account represents the
  -- organization's single login, not a per-person account, matching how
  -- clients itself always means the organization, not an individual.
  -- password_hash stays NULL until the client actually accepts their invite
  -- and sets a password; ON DELETE CASCADE mirrors the FK convention every
  -- other clients-owned table already uses.
  CREATE TABLE IF NOT EXISTS client_portal_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    invite_token TEXT,
    invite_token_expires TEXT,
    reset_token TEXT,
    reset_token_expires TEXT,
    password_changed_at TEXT NOT NULL DEFAULT (datetime('now')),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- A client's ask for a quote, submitted from the portal — deliberately
  -- not a quote itself (no pricing set by the client, no public_token, no
  -- PDF): a client picks what they want from the product catalog (or
  -- describes it in the description column when nothing in the catalog
  -- fits), staff turns that into a real priced quote using the existing
  -- quote-creation flow. description is now optional (was NOT NULL with
  -- no default before quote_request_items existed) — a request can be
  -- carried entirely by its catalog items instead. quote_id stays NULL
  -- until a staff member actually creates that quote
  -- (routes/quoteRequests.js's POST /:id/link-quote) — ON DELETE SET NULL
  -- rather than CASCADE, so deleting the resulting quote later doesn't
  -- silently destroy the record that a request was ever made, just its
  -- link to that particular quote.
  CREATE TABLE IF NOT EXISTS quote_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    quote_id INTEGER REFERENCES quotes(id) ON DELETE SET NULL,
    decision_note TEXT NOT NULL DEFAULT '',
    decided_by_name TEXT NOT NULL DEFAULT '',
    decided_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- The catalog items a client picked while building a quote_requests row
  -- — deliberately carries no price/amount column: a client is never
  -- trusted with pricing, even read-only client-supplied numbers, so the
  -- server only ever stores product_id + quantity here and looks up the
  -- real (current) price itself, both for display and for QuoteForm.jsx's
  -- pre-fill when staff builds the actual quote. product_id has no
  -- REFERENCES constraint, same reason quote_items/invoice_items' own
  -- product_id column doesn't (see that note above) — products.js allows
  -- deleting a product outright with no reference check, and a FK here
  -- would turn that into a 500 instead of leaving a harmless stale id.
  -- description is a denormalized snapshot of the product's name at
  -- request time, same reasoning quote_items/invoice_items snapshot
  -- theirs — so the request still reads sensibly even if the product is
  -- later renamed or deleted.
  CREATE TABLE IF NOT EXISTS quote_request_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quote_request_id INTEGER NOT NULL REFERENCES quote_requests(id) ON DELETE CASCADE,
    product_id INTEGER,
    description TEXT NOT NULL,
    quantity REAL NOT NULL DEFAULT 1
  );

  -- One row per bulk/promotional email send (see routes/campaigns.js) —
  -- a summary record, not a per-recipient log. recipient_type is
  -- 'all' (every client with an email on file) or 'selected' (an
  -- explicit list, including the single-client shortcut from the
  -- Clients page). recipient_count is how many were targeted;
  -- sent_count/failed_count split that by outcome, since a bulk send
  -- can partially fail (one client's address rejects mail) without the
  -- whole campaign failing. Each individual successful send is also
  -- logged to the existing email_log table (type: campaign) for the
  -- per-recipient audit trail, the same way every other client-facing
  -- send in this app double-logs to activity_log and email_log. This is
  -- a brand-new table with no production data yet, so a plain CREATE
  -- TABLE IF NOT EXISTS is enough.
  CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    recipient_type TEXT NOT NULL DEFAULT 'all',
    recipient_count INTEGER NOT NULL DEFAULT 0,
    sent_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    sent_by_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Per-recipient detail for a campaign's own failed_count above — which
  -- specific client(s) a bulk send didn't reach, and why. Originally the
  -- send route only ever returned this in its one-time POST response
  -- (never persisted anywhere), so once that response was gone — the page
  -- reloaded, the toast dismissed — there was no way to find out which
  -- recipients had failed after the fact. client_name/client_email are
  -- denormalized snapshots (not just client_id) so this row still reads
  -- sensibly if the client is later renamed or deleted; ON DELETE CASCADE
  -- on campaign_id since a failure record only makes sense alongside the
  -- campaign it belongs to. Brand-new table, no production data yet, so a
  -- plain CREATE TABLE IF NOT EXISTS is enough.
  CREATE TABLE IF NOT EXISTS campaign_failures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    client_id INTEGER,
    client_name TEXT NOT NULL DEFAULT '',
    client_email TEXT NOT NULL DEFAULT '',
    error TEXT NOT NULL DEFAULT ''
  );

  -- One row per issued staff JWT (see middleware/auth.js's requireAuth,
  -- which now checks this table on every request, not just the token's own
  -- signature/expiry). Lets a logged-in user see "which devices/browsers am
  -- I signed in on" (MyAccount.jsx) and revoke one without changing their
  -- password (which would log out *every* session, not just the one being
  -- lost/stolen). jti is a random id embedded in the JWT payload at
  -- login/register time -- the row this token maps to; a token whose jti
  -- has no matching row, or whose row has revoked_at set, is rejected the
  -- same as an expired one. user_agent is read straight from the request
  -- header at login (free-text, not parsed into a device/browser name --
  -- good enough for a person to recognize "that's my phone" from).
  -- Brand-new table, no production data yet, so a plain CREATE TABLE IF
  -- NOT EXISTS is enough.
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    jti TEXT NOT NULL UNIQUE,
    user_agent TEXT NOT NULL DEFAULT '',
    ip_address TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    revoked_at TEXT
  );

  -- The public marketing website's editable content (see routes/website.js
  -- and the unauthenticated GET /api/public/site) — five brand-new tables,
  -- no production data yet, so plain CREATE TABLE IF NOT EXISTS is enough
  -- for all five (see this file's own top-of-file note on when that's
  -- correct vs. when a column addition later needs the ALTER TABLE
  -- treatment instead). status/visible follow this app's existing
  -- draft-vs-published convention (quotes/invoices' own status column) —
  -- the public site only ever reads the published/visible rows, exactly
  -- the same "only show what's actually ready" filtering
  -- products.visible_in_portal already does for the client portal's own catalog.
  CREATE TABLE IF NOT EXISTS website_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft',
    published_at TEXT,
    created_by_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS website_testimonials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quote TEXT NOT NULL,
    author_name TEXT NOT NULL DEFAULT '',
    author_role TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft',
    display_order INTEGER NOT NULL DEFAULT 0,
    created_by_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS website_services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    icon TEXT NOT NULL DEFAULT 'service',
    visible INTEGER NOT NULL DEFAULT 1,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- photo is a base64 data URI, same inline-image approach
  -- business_settings' logo/signature/stamp and payment_proofs' file_data
  -- already use — this app has no separate file storage service, and a
  -- headshot is small enough to store inline the same way.
  CREATE TABLE IF NOT EXISTS website_team_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT '',
    photo TEXT NOT NULL DEFAULT '',
    visible INTEGER NOT NULL DEFAULT 1,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS website_gallery (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    image TEXT NOT NULL,
    caption TEXT NOT NULL DEFAULT '',
    visible INTEGER NOT NULL DEFAULT 1,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- video_url is a Google Drive share link (e.g. EduPage tutorial
  -- recordings) — this app has no video storage of its own, so a video
  -- lives on Drive and this table just points at it; there's no
  -- thumbnail column since one is always derivable from the Drive file
  -- id embedded in video_url (https://drive.google.com/thumbnail?id=...),
  -- same don't-store-what-you-can-compute approach invoices.js's
  -- withComputed() takes for is_overdue.
  CREATE TABLE IF NOT EXISTS website_videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    video_url TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '',
    visible INTEGER NOT NULL DEFAULT 1,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_quotes_client ON quotes(client_id);
  CREATE INDEX IF NOT EXISTS idx_quote_requests_client ON quote_requests(client_id);
  CREATE INDEX IF NOT EXISTS idx_quote_request_items_request ON quote_request_items(quote_request_id);
  CREATE INDEX IF NOT EXISTS idx_campaigns_created ON campaigns(created_at);
  CREATE INDEX IF NOT EXISTS idx_campaign_failures_campaign ON campaign_failures(campaign_id);
  CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id);
  CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);
  CREATE INDEX IF NOT EXISTS idx_quote_items_quote ON quote_items(quote_id);
  CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
  CREATE INDEX IF NOT EXISTS idx_recurring_items ON recurring_invoice_items(recurring_invoice_id);
  CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at);
  CREATE INDEX IF NOT EXISTS idx_email_log_created ON email_log(created_at);
  CREATE INDEX IF NOT EXISTS idx_licenses_client ON licenses(client_id);
  CREATE INDEX IF NOT EXISTS idx_licenses_expiry ON licenses(expiry_date);
  CREATE INDEX IF NOT EXISTS idx_payment_proofs_invoice ON payment_proofs(invoice_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_jti ON sessions(jti);
  CREATE INDEX IF NOT EXISTS idx_website_posts_status ON website_posts(status, published_at);
  CREATE INDEX IF NOT EXISTS idx_website_testimonials_status ON website_testimonials(status);
  CREATE INDEX IF NOT EXISTS idx_website_services_visible ON website_services(visible);
  CREATE INDEX IF NOT EXISTS idx_website_team_visible ON website_team_members(visible);
  CREATE INDEX IF NOT EXISTS idx_website_gallery_visible ON website_gallery(visible);
  CREATE INDEX IF NOT EXISTS idx_website_videos_visible ON website_videos(visible);

  -- Added once the query patterns above (list routes' ORDER BY, the
  -- scheduler's WHERE clauses, routes/reports.js's date-range SUMs) were
  -- audited against what was actually indexed. SQLite doesn't index a
  -- plain column automatically -- only PRIMARY KEY and UNIQUE columns get
  -- one for free -- so every WHERE/ORDER BY column below was previously a
  -- full table scan. Harmless at today's row counts, but each of these
  -- mirrors a query this app already runs on every request to the
  -- relevant page (a list's default sort, the daily scheduler jobs, a
  -- report's date-range filter), so the cost of staying unindexed only
  -- grows with real usage. status/date composites are ordered
  -- (equality-column first, range-column second) to match SQLite's own
  -- left-to-right index usage rules.
  CREATE INDEX IF NOT EXISTS idx_invoices_status_due ON invoices(status, due_date);
  CREATE INDEX IF NOT EXISTS idx_invoices_issue_date ON invoices(issue_date);
  CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);
  CREATE INDEX IF NOT EXISTS idx_quotes_issue_date ON quotes(issue_date);
  CREATE INDEX IF NOT EXISTS idx_quotes_expiry_date ON quotes(expiry_date);
  CREATE INDEX IF NOT EXISTS idx_expenses_expense_date ON expenses(expense_date);
  CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);
  CREATE INDEX IF NOT EXISTS idx_recurring_invoices_client ON recurring_invoices(client_id);
  CREATE INDEX IF NOT EXISTS idx_recurring_invoices_next_run ON recurring_invoices(next_run_date);
  CREATE INDEX IF NOT EXISTS idx_payments_paid_at ON payments(paid_at);
  CREATE INDEX IF NOT EXISTS idx_capital_contributions_date ON capital_contributions(contribution_date);
  CREATE INDEX IF NOT EXISTS idx_owner_draws_date ON owner_draws(draw_date);
  CREATE INDEX IF NOT EXISTS idx_license_renewals_license ON license_renewals(license_id);
  CREATE INDEX IF NOT EXISTS idx_quote_requests_status ON quote_requests(status);
  CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity_log(entity_type, action);
`);

// Lightweight migration for columns added to `users` after this table
// already existed in production. CREATE TABLE IF NOT EXISTS above is a
// no-op against a live database, so new columns have to be added by hand —
// there's no migration tool (see CLAUDE.md). Guarded by checking
// PRAGMA table_info first so this is safe to run on every startup,
// including against a brand-new DB where the columns are already present
// from the CREATE TABLE above (the ALTERs are simply skipped).
const userColumns = new Set(db.prepare('PRAGMA table_info(users)').all().map((c) => c.name));
if (!userColumns.has('role')) {
  db.exec(`
    ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'staff';
    ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE users ADD COLUMN notify_overdue INTEGER NOT NULL DEFAULT 0;
  `);
  // Every account created before roles existed had full, unrestricted
  // access — promote them all to admin so this migration can never
  // silently strip access from someone already using the app. Only
  // accounts created after this point default to 'staff'.
  db.prepare(`UPDATE users SET role = 'admin'`).run();
}

// Same pattern as above, for the session-timeout column added to
// `business_settings` after that table's single row already existed in
// production.
const settingsColumns = new Set(db.prepare('PRAGMA table_info(business_settings)').all().map((c) => c.name));
if (!settingsColumns.has('session_timeout_minutes')) {
  db.exec(`ALTER TABLE business_settings ADD COLUMN session_timeout_minutes INTEGER NOT NULL DEFAULT 30;`);
}

// Same pattern again: `signature_image`/`stamp_image` (base64 data URIs,
// see routes/settings.js) added to business_settings after that table's
// single row already existed in production.
if (!settingsColumns.has('signature_image')) {
  db.exec(`
    ALTER TABLE business_settings ADD COLUMN signature_image TEXT NOT NULL DEFAULT '';
    ALTER TABLE business_settings ADD COLUMN stamp_image TEXT NOT NULL DEFAULT '';
  `);
}

// Same pattern again: `logo_image` (data URI, same shape as
// signature_image/stamp_image) and `signatory_name` (the name printed
// under "Authorized Signature" on quote/invoice PDFs — distinct from
// quotes.created_by_name/invoices.created_by_name below, which is whoever
// actually created that specific document, not the business's authorized
// signer) added to business_settings after that table's single row already
// existed in production.
if (!settingsColumns.has('logo_image')) {
  db.exec(`
    ALTER TABLE business_settings ADD COLUMN logo_image TEXT NOT NULL DEFAULT '';
    ALTER TABLE business_settings ADD COLUMN signatory_name TEXT NOT NULL DEFAULT '';
  `);
}

// Same pattern again: `pdf_template` ('modern' | 'minimal' — see
// lib/pdf.js) picks which layout quote/invoice/receipt PDFs render with,
// added to business_settings after that table's single row already existed
// in production.
if (!settingsColumns.has('pdf_template')) {
  db.exec(`ALTER TABLE business_settings ADD COLUMN pdf_template TEXT NOT NULL DEFAULT 'modern';`);
}

// Same pattern again: `starting_balance` (see "Bank balance" in
// routes/financials.js below) added to business_settings after that
// table's single row already existed in production.
if (!settingsColumns.has('starting_balance')) {
  db.exec(`ALTER TABLE business_settings ADD COLUMN starting_balance REAL NOT NULL DEFAULT 0;`);
}

// Same pattern again: `clients` used to have separate `name` (contact
// person) and `company` fields, which in practice was just a confusing
// way to ask the same question twice — a client here always means the
// organization being billed, not an individual contact. Fold `company`
// into `name` (company wins where both were set, since that's the value
// that actually identifies the client) and drop the now-redundant column.
const clientColumns = new Set(db.prepare('PRAGMA table_info(clients)').all().map((c) => c.name));
if (clientColumns.has('company')) {
  db.exec(`UPDATE clients SET name = company WHERE TRIM(COALESCE(company, '')) != '';`);
  db.exec(`ALTER TABLE clients DROP COLUMN company;`);
}

// Same pattern again: `tax_rate` added to `products` after that table
// already existed in production with real catalog rows.
const productColumns = new Set(db.prepare('PRAGMA table_info(products)').all().map((c) => c.name));
if (!productColumns.has('tax_rate')) {
  db.exec(`ALTER TABLE products ADD COLUMN tax_rate REAL NOT NULL DEFAULT 0;`);
}

// Same pattern once more: `visible_in_portal` opts a product into the
// client portal's "Request a quote" catalog picker (routes/clientPortal.js's
// GET /products) — defaults to 0 (hidden) rather than 1, so every existing
// product stays out of client view until an admin explicitly reviews and
// opts it in, rather than the whole catalog suddenly becoming
// client-visible the moment this shipped.
if (!productColumns.has('visible_in_portal')) {
  db.exec(`ALTER TABLE products ADD COLUMN visible_in_portal INTEGER NOT NULL DEFAULT 0;`);
}

// Same pattern again: `password_changed_at` added to `users` so existing
// JWTs (issued before this column existed) can be invalidated the moment a
// user resets or changes their password — see middleware/auth.js. Backfill
// to `created_at` rather than `datetime('now')` so no pre-existing token is
// accidentally invalidated by the migration itself.
if (!userColumns.has('password_changed_at')) {
  db.exec(`ALTER TABLE users ADD COLUMN password_changed_at TEXT;`);
  db.prepare(`UPDATE users SET password_changed_at = created_at WHERE password_changed_at IS NULL`).run();
}

// Same pattern again: `product_id` added to `quote_items`/`invoice_items` so
// a line item's originating product can be recovered by id instead of by
// matching its description against the current product name — the latter
// silently breaks (falls back to a 0% tax contribution) if the product is
// renamed after the item was added. No REFERENCES constraint on purpose:
// products.js allows deleting a product outright with no check for existing
// references, and a FK here would turn that into a constraint-violation 500
// instead of just leaving old items with a stale, best-effort id.
const quoteItemColumns = new Set(db.prepare('PRAGMA table_info(quote_items)').all().map((c) => c.name));
if (!quoteItemColumns.has('product_id')) {
  db.exec(`ALTER TABLE quote_items ADD COLUMN product_id INTEGER;`);
}
const invoiceItemColumns = new Set(db.prepare('PRAGMA table_info(invoice_items)').all().map((c) => c.name));
if (!invoiceItemColumns.has('product_id')) {
  db.exec(`ALTER TABLE invoice_items ADD COLUMN product_id INTEGER;`);
}

// Same pattern again: `created_by_name` added to `quotes`/`invoices` so the
// PDF can print a "Prepared By" line (see lib/pdf.js) — captured once at
// creation time (routes/quotes.js, routes/invoices.js), same
// denormalize-rather-than-join approach as invoice_items/quote_items
// storing description/unit_price directly. Left blank on rows that predate
// this column, and on invoices generated with no human in the loop
// (recurring-invoice generation in lib/scheduler.js, bulk CSV import in
// routes/import.js) — the PDF simply omits the row when it's blank, the
// same "only if present" convention as NOTES/PAYMENT DETAILS already use.
const quoteColumns = new Set(db.prepare('PRAGMA table_info(quotes)').all().map((c) => c.name));
if (!quoteColumns.has('created_by_name')) {
  db.exec(`ALTER TABLE quotes ADD COLUMN created_by_name TEXT NOT NULL DEFAULT '';`);
}
const invoiceColumns = new Set(db.prepare('PRAGMA table_info(invoices)').all().map((c) => c.name));
if (!invoiceColumns.has('created_by_name')) {
  db.exec(`ALTER TABLE invoices ADD COLUMN created_by_name TEXT NOT NULL DEFAULT '';`);
}

// Same pattern again: `url` added to `licenses` (the client's activation/
// portal link, see routes/licenses.js) after that table already existed in
// production with real license rows from an earlier deploy of the Licenses
// feature — without this, every INSERT/UPDATE that names the `url` column
// (manual create/edit, POST /api/import/licenses) 500s with "table licenses
// has no column named url" against a database created before this column
// was added.
const licenseColumns = new Set(db.prepare('PRAGMA table_info(licenses)').all().map((c) => c.name));
if (!licenseColumns.has('url')) {
  db.exec(`ALTER TABLE licenses ADD COLUMN url TEXT NOT NULL DEFAULT '';`);
}

// Same pattern once more: last_renewal_confirmation_sent_at (routes/
// licenses.js's POST /:id/renewal-confirm) stamped the moment a renewal
// confirmation email actually goes out, so Licenses.jsx can hide that
// action until the license is renewed again — same "suppress until the
// next real reason to send it" idea last_reminder_sent_at already
// establishes for the renewal reminder, just with no 7-day re-send
// window of its own (a confirmation is a one-time fact about a specific
// renewal, not a nag that should eventually repeat on a timer). Reuses
// the already-declared licenseColumns set from the url migration above.
if (!licenseColumns.has('last_renewal_confirmation_sent_at')) {
  db.exec(`ALTER TABLE licenses ADD COLUMN last_renewal_confirmation_sent_at TEXT;`);
}

// Same pattern again: `payee` (who an expense was paid to — a shareholder,
// an employee, a landlord, a vendor; see "Expense filters" in
// routes/expenses.js below) added to `expenses` after that table already
// existed in production with real expense rows.
const expenseColumns = new Set(db.prepare('PRAGMA table_info(expenses)').all().map((c) => c.name));
if (!expenseColumns.has('payee')) {
  db.exec(`ALTER TABLE expenses ADD COLUMN payee TEXT NOT NULL DEFAULT '';`);
}

// Same pattern once more: three columns specific to the 'currency exchange'
// category (see "Currency exchange details" in routes/expenses.js below) —
// `exchange_rate` is nullable (unlike every other numeric column in this
// app, which defaults to 0) since 0 is a nonsensical rate and would divide-
// by-zero when computing the USD amount received; NULL unambiguously means
// "not a currency exchange row / rate not entered" instead. The other two
// are plain optional text, same `TEXT NOT NULL DEFAULT ''` convention as
// `payee`/`notes`.
if (!expenseColumns.has('exchange_rate')) {
  db.exec(`ALTER TABLE expenses ADD COLUMN exchange_rate REAL;`);
}
if (!expenseColumns.has('payee_account_number')) {
  db.exec(`ALTER TABLE expenses ADD COLUMN payee_account_number TEXT NOT NULL DEFAULT '';`);
}
if (!expenseColumns.has('usd_destination')) {
  db.exec(`ALTER TABLE expenses ADD COLUMN usd_destination TEXT NOT NULL DEFAULT '';`);
}

// Same pattern again: `notify_quote_responses` added to `users` — the
// opt-in preference (MyAccount.jsx, mirroring `notify_overdue`) for a
// staff digest when a client accepts a quote via the portal or public link
// (see lib/quoteAcceptedNotify.js) — after `users` already had real accounts.
if (!userColumns.has('notify_quote_responses')) {
  db.exec(`ALTER TABLE users ADD COLUMN notify_quote_responses INTEGER NOT NULL DEFAULT 0;`);
}

// Same pattern once more: `notify_monthly_report` added to `users` — the
// opt-in preference (MyAccount.jsx, mirroring `notify_overdue`/
// `notify_quote_responses`) for the automated monthly P&L summary email
// (see lib/scheduler.js's `runMonthlyReport()`) — after `users` already
// had real accounts.
if (!userColumns.has('notify_monthly_report')) {
  db.exec(`ALTER TABLE users ADD COLUMN notify_monthly_report INTEGER NOT NULL DEFAULT 0;`);
}

// Same pattern again: `notify_payment_proofs` added to `users` — the
// opt-in preference (MyAccount.jsx, mirroring `notify_quote_responses`)
// for a staff digest when a client uploads a payment slip/advice against
// an invoice via the portal (see lib/paymentProofNotify.js and
// routes/clientPortal.js's own POST /invoices/:id/payment-proof) — after
// `users` already had real accounts.
if (!userColumns.has('notify_payment_proofs')) {
  db.exec(`ALTER TABLE users ADD COLUMN notify_payment_proofs INTEGER NOT NULL DEFAULT 0;`);
}

// Same pattern once more: `avatar_image` on `users` — a profile photo,
// same inline base64-data-URI storage business_settings' logo/signature/
// stamp and payment_proofs.file_data already use (no separate file
// storage service in this app). Blank default means "no photo," which
// every reader (MyAccount.jsx, Sidebar.jsx's account row) falls back to
// initials for, same "only show the exception case" convention this app
// already follows elsewhere.
if (!userColumns.has('avatar_image')) {
  db.exec(`ALTER TABLE users ADD COLUMN avatar_image TEXT NOT NULL DEFAULT '';`);
}

// Same pattern once more for `payment_proofs.review_note` — the staff
// note attached when rejecting a proof (see "Payment proof upload" below,
// the reject action). Unlike `payment_proofs` itself, this can't go
// straight into the CREATE TABLE statement: the table shipped in the
// previous deploy and may already carry real uploaded proofs, so this
// follows the same ALTER TABLE lesson `licenses.url` learned the hard way.
const paymentProofColumns = new Set(db.prepare('PRAGMA table_info(payment_proofs)').all().map((c) => c.name));
if (!paymentProofColumns.has('review_note')) {
  db.exec(`ALTER TABLE payment_proofs ADD COLUMN review_note TEXT NOT NULL DEFAULT '';`);
}

// `client_viewed_at` on both `quotes` and `invoices` — stamped the first
// time a client actually opens the document, whether via its public
// `public_token` link (routes/public.js) or the client portal
// (routes/clientPortal.js), so staff have a real "did they even see this"
// signal instead of guessing from a lack of response. Deliberately the
// *first* view only, not the most recent one — the question this answers
// is "has the client seen it at all," and overwriting on every subsequent
// view would erase that useful earliest timestamp for no benefit. Reuses
// the already-declared `quoteColumns`/`invoiceColumns` sets from the
// `created_by_name` migration above rather than re-querying `PRAGMA
// table_info` a second time for the same two tables.
if (!quoteColumns.has('client_viewed_at')) {
  db.exec(`ALTER TABLE quotes ADD COLUMN client_viewed_at TEXT;`);
}
if (!invoiceColumns.has('client_viewed_at')) {
  db.exec(`ALTER TABLE invoices ADD COLUMN client_viewed_at TEXT;`);
}

// `restricted` on `users` — lets a super_admin subject a specific plain
// `admin` account to the same per-module `user_permissions` grants a
// `staff` account already has, instead of that account automatically
// bypassing the whole permission system the way every admin-tier account
// does by default (see lib/permissions.js's isUnrestrictedAdmin()). Only
// ever meaningful for role = 'admin' — a `staff` account is already
// permission-gated with nothing to toggle, and a `super_admin` can never
// be restricted (routes/users.js refuses to store it as anything but 0 for
// either of those roles), so this stays a plain unconstrained INTEGER
// rather than needing a CHECK tied to role. Defaults to 0 (unrestricted —
// today's behavior, unchanged) for every existing and newly created admin;
// only a super_admin flipping it via the Users page ever sets it to 1.
if (!userColumns.has('restricted')) {
  db.exec(`ALTER TABLE users ADD COLUMN restricted INTEGER NOT NULL DEFAULT 0;`);
}

// `notify_admin_changes` — the opt-in preference (MyAccount.jsx, mirroring
// `notify_overdue`/`notify_quote_responses`/etc.) for the staff digest sent
// when a new admin-tier account is created or an existing account is
// promoted into one (see lib/adminChangeNotify.js and routes/users.js's
// `POST /`/`PUT /:id`) — only ever meaningful for a `super_admin` account
// (a plain admin can't reach the Users page actions that would trigger
// this at all, see assertSuperAdminForAdminTier), but stored as a plain
// column on every user the same as the other notify_* preferences rather
// than a super_admin-only special case, so `PUT /api/auth/preferences`
// doesn't need role-specific logic to accept it.
if (!userColumns.has('notify_admin_changes')) {
  db.exec(`ALTER TABLE users ADD COLUMN notify_admin_changes INTEGER NOT NULL DEFAULT 0;`);
}

// po_number — an optional client-supplied purchase order reference,
// captured when a quote is converted into an invoice (the point where a
// client's own purchase order actually gets matched against the document
// they're about to be billed against) but also editable afterward via the
// regular invoice create/edit form, same as notes. Reuses the already-
// declared invoiceColumns set from the created_by_name migration above.
// Same ALTER TABLE treatment every other post-launch invoices column in
// this file follows — invoices has carried real documents since the
// app's first deploy.
if (!invoiceColumns.has('po_number')) {
  db.exec(`ALTER TABLE invoices ADD COLUMN po_number TEXT NOT NULL DEFAULT '';`);
}

// void_reason — a plain, required-at-write-time remark captured the moment
// a quote/invoice is voided (routes/quotes.js's and routes/invoices.js's
// own POST /:id/void), so "why was this cancelled" survives on the record
// itself rather than only in a one-line activity_log entry. Voiding is now
// the *only* way to cancel a quote or invoice — both routers' DELETE /:id
// was removed outright (see those files' own notes) — so this column is
// what makes that the safer trade: nothing is ever destroyed, but every
// cancellation carries a stated reason. Reuses the already-declared
// quoteColumns/invoiceColumns sets from the created_by_name migration
// above. Same ALTER TABLE treatment as every other post-launch column on
// these two tables — both have carried real documents since the app's
// first deploy.
if (!quoteColumns.has('void_reason')) {
  db.exec(`ALTER TABLE quotes ADD COLUMN void_reason TEXT NOT NULL DEFAULT '';`);
}
if (!invoiceColumns.has('void_reason')) {
  db.exec(`ALTER TABLE invoices ADD COLUMN void_reason TEXT NOT NULL DEFAULT '';`);
}

db.pragma('foreign_keys = ON');

// Bound params rather than string-interpolated into the exec() block above,
// so a value like an apostrophe in an address can't break the SQL literal.
db.prepare(
  `INSERT OR IGNORE INTO business_settings (id, business_name, address, phone) VALUES (1, ?, ?, ?)`,
).run('Edu Solutions Pvt Ltd', "Vinares tower, aboomaa hin'gun", '+960 7921335');

module.exports = db;
