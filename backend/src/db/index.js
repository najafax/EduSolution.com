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
    sort_order INTEGER NOT NULL DEFAULT 0
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
    sort_order INTEGER NOT NULL DEFAULT 0
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

  CREATE INDEX IF NOT EXISTS idx_quotes_client ON quotes(client_id);
  CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id);
  CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);
  CREATE INDEX IF NOT EXISTS idx_quote_items_quote ON quote_items(quote_id);
  CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
  CREATE INDEX IF NOT EXISTS idx_recurring_items ON recurring_invoice_items(recurring_invoice_id);
  CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at);
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

db.pragma('foreign_keys = ON');

// Bound params rather than string-interpolated into the exec() block above,
// so a value like an apostrophe in an address can't break the SQL literal.
db.prepare(
  `INSERT OR IGNORE INTO business_settings (id, business_name, address, phone) VALUES (1, ?, ?, ?)`,
).run('Edu Solutions Pvt Ltd', "Vinares tower, aboomaa hin'gun", '+960 7921335');

module.exports = db;
