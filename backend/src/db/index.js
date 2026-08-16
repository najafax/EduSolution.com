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
    notes TEXT NOT NULL DEFAULT '',
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

  CREATE INDEX IF NOT EXISTS idx_quotes_client ON quotes(client_id);
  CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id);
  CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);
  CREATE INDEX IF NOT EXISTS idx_quote_items_quote ON quote_items(quote_id);
  CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
  CREATE INDEX IF NOT EXISTS idx_recurring_items ON recurring_invoice_items(recurring_invoice_id);
  CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at);
  CREATE INDEX IF NOT EXISTS idx_email_log_created ON email_log(created_at);
  CREATE INDEX IF NOT EXISTS idx_licenses_client ON licenses(client_id);
  CREATE INDEX IF NOT EXISTS idx_licenses_expiry ON licenses(expiry_date);
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

db.pragma('foreign_keys = ON');

// Bound params rather than string-interpolated into the exec() block above,
// so a value like an apostrophe in an address can't break the SQL literal.
db.prepare(
  `INSERT OR IGNORE INTO business_settings (id, business_name, address, phone) VALUES (1, ?, ?, ?)`,
).run('Edu Solutions Pvt Ltd', "Vinares tower, aboomaa hin'gun", '+960 7921335');

module.exports = db;
