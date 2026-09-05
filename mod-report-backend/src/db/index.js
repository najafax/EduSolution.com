const path = require('path');
const Database = require('better-sqlite3');

// Same DB_PATH override convention the main EduSolution app uses (see its
// own db/index.js) — unset locally defaults next to this file, in
// production points at a mounted persistent disk so data survives redeploys.
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data.sqlite3');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  -- Every account can see and submit every MOD report — this app has no
  -- per-module permission system the way the main EduSolution app does
  -- (see that app's routes/modReports.js, which was gated to its
  -- super_admin role tier before this feature moved here). A login is
  -- already the whole access boundary this standalone app needs.
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    password_changed_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Identical shape to the main app's mod_reports table (see that app's
  -- CLAUDE.md for the full field-by-field rationale) — copied rather than
  -- redesigned, so a straight data export/import between the two never
  -- needs a column mapping. submitted_by_user_id has no FK here (a
  -- reference into a users table this app didn't create the row from,
  -- and legacy rows imported from the old app carry ids that don't
  -- correspond to any user here) — submitted_by_name is the durable record
  -- either way.
  CREATE TABLE IF NOT EXISTS mod_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mod_name TEXT NOT NULL,
    report_date TEXT NOT NULL,
    weather TEXT NOT NULL DEFAULT '',
    time_started TEXT NOT NULL DEFAULT '',
    occupancy_percent REAL,
    sections_json TEXT NOT NULL DEFAULT '{}',
    villas_json TEXT NOT NULL DEFAULT '[]',
    guest_interactions_json TEXT NOT NULL DEFAULT '[]',
    issues_json TEXT NOT NULL DEFAULT '[]',
    signature TEXT NOT NULL DEFAULT '',
    submitted_by_user_id INTEGER,
    submitted_by_name TEXT NOT NULL DEFAULT '',
    submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
    edited_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_mod_reports_submitted_at ON mod_reports(submitted_at);

  -- Single-row branding + public-link settings, same shape as the main
  -- app's mod_report_settings table.
  CREATE TABLE IF NOT EXISTS mod_report_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    business_name TEXT NOT NULL DEFAULT '',
    logo_image TEXT NOT NULL DEFAULT '',
    submission_token TEXT
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
`);

db.prepare('INSERT OR IGNORE INTO mod_report_settings (id) VALUES (1)').run();

module.exports = db;
