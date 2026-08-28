// A minimal, read-only SQL shell for looking directly at the real
// database — for exactly the kind of ad-hoc "how many clients have no
// email," "what does this row actually look like" question this app has
// no page for (same idea as find-campaign-failures.js, generalized to any
// question instead of one specific one). Always opens the database
// read-only (better-sqlite3's own `readonly: true`), so this can never be
// the thing that corrupts real data — for anything that needs to write,
// use the app itself, not this script.
//
// Usage (run from the backend/ directory, on the machine/shell that
// actually has your production DB_PATH — see this repo's own README/
// CLAUDE.md for how to reach it, e.g. `render ssh` for a Render deploy):
//   node scripts/db-query.js --tables              # every table + row count
//   node scripts/db-query.js --schema=clients       # one table's columns
//   node scripts/db-query.js "SELECT * FROM clients LIMIT 10"
require('dotenv').config();
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data.sqlite3');
const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

const args = process.argv.slice(2);

function printTable(rows) {
  if (rows.length === 0) {
    console.log('(no rows)');
    return;
  }
  console.table(rows);
}

if (args.includes('--tables')) {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  console.log(`Database: ${DB_PATH}\n`);
  for (const r of rows) {
    const { n } = db.prepare(`SELECT COUNT(*) AS n FROM "${r.name}"`).get();
    console.log(`  ${r.name.padEnd(30)} ${n} row${n === 1 ? '' : 's'}`);
  }
  process.exit(0);
}

const schemaArg = args.find((a) => a.startsWith('--schema='));
if (schemaArg) {
  const table = schemaArg.split('=')[1];
  const rows = db.prepare(`PRAGMA table_info("${table}")`).all();
  if (rows.length === 0) {
    console.error(`No such table: ${table}`);
    process.exitCode = 1;
  } else {
    console.log(`${table}:\n`);
    for (const c of rows) {
      console.log(`  ${c.name.padEnd(28)} ${c.type}${c.notnull ? ' NOT NULL' : ''}${c.pk ? ' PRIMARY KEY' : ''}`);
    }
  }
  process.exit(0);
}

const sql = args.find((a) => !a.startsWith('--'));
if (!sql) {
  console.log('Usage:');
  console.log('  node scripts/db-query.js --tables');
  console.log('  node scripts/db-query.js --schema=<table>');
  console.log('  node scripts/db-query.js "SELECT ..."');
  process.exit(1);
}

try {
  const rows = db.prepare(sql).all();
  printTable(rows);
  console.log(`\n${rows.length} row${rows.length === 1 ? '' : 's'}`);
} catch (err) {
  console.error('Query error:', err.message);
  process.exitCode = 1;
}
