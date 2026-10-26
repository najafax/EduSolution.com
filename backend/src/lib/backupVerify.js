const Database = require('better-sqlite3');

// Tables a real EduSolution backup must contain. A file missing one of these
// is not a usable backup, however valid the SQLite container itself is.
const REQUIRED_TABLES = ['users', 'clients', 'invoices', 'invoice_items', 'payments', 'business_settings'];
const COUNTED_TABLES = ['users', 'clients', 'quotes', 'invoices', 'payments', 'expenses', 'licenses'];

// Opens a restored database read-only and checks it is actually usable:
// SQLite's own integrity check, foreign-key consistency, the expected tables,
// and a row count for the main tables so a human can sanity-check the size.
function verifySqliteFile(filePath) {
  const result = { ok: false, problems: [], counts: {}, integrity: null, foreignKeyViolations: 0 };
  let conn;
  try {
    conn = new Database(filePath, { readonly: true, fileMustExist: true });
  } catch (err) {
    result.problems.push(`Could not open as a SQLite database: ${err.message}`);
    return result;
  }
  try {
    const integrity = conn.prepare('PRAGMA integrity_check').all().map((r) => r.integrity_check);
    result.integrity = integrity.join('; ');
    if (!(integrity.length === 1 && integrity[0] === 'ok')) {
      result.problems.push(`Integrity check failed: ${result.integrity}`);
    }

    result.foreignKeyViolations = conn.prepare('PRAGMA foreign_key_check').all().length;
    if (result.foreignKeyViolations > 0) {
      result.problems.push(`${result.foreignKeyViolations} foreign key violation(s)`);
    }

    const tables = new Set(
      conn.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name),
    );
    for (const t of REQUIRED_TABLES) {
      if (!tables.has(t)) result.problems.push(`Missing table: ${t}`);
    }
    for (const t of COUNTED_TABLES) {
      if (tables.has(t)) result.counts[t] = conn.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
    }
    if (tables.has('users') && result.counts.users === 0) result.problems.push('The users table is empty');

    result.ok = result.problems.length === 0;
  } catch (err) {
    result.problems.push(`Check failed: ${err.message}`);
  } finally {
    conn.close();
  }
  return result;
}

module.exports = { verifySqliteFile, REQUIRED_TABLES, COUNTED_TABLES };
