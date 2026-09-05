// One-time migration helper for the MOD Report split-out: dumps this app's
// existing mod_reports/mod_report_settings rows (still sitting untouched in
// this app's own sqlite file — see db/index.js's own note on why they were
// never dropped) to a JSON file, for the najafax/mod-report repo's own
// mod-report-backend/scripts/import-legacy.js to pick up. A no-op (empty
// export) on a database that never had the feature enabled, or one already
// migrated.
//
// Usage (from backend/):
//   npm run export-mod-reports -- /path/to/mod-reports-export.json
require('dotenv').config();
const fs = require('fs');
const db = require('../src/db');

const outFile = process.argv[2] || 'mod-reports-export.json';

function tableExists(name) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

const data = { mod_reports: [], mod_report_settings: null };

if (tableExists('mod_reports')) {
  data.mod_reports = db.prepare('SELECT * FROM mod_reports ORDER BY id').all();
}
if (tableExists('mod_report_settings')) {
  data.mod_report_settings = db.prepare('SELECT * FROM mod_report_settings WHERE id = 1').get() || null;
}

fs.writeFileSync(outFile, JSON.stringify(data, null, 2));
console.log(`Exported ${data.mod_reports.length} MOD report(s)${data.mod_report_settings ? ' and branding settings' : ''} to ${outFile}.`);
console.log('Import it into najafax/mod-report with: cd mod-report-backend && node scripts/import-legacy.js /path/to/' + outFile);
