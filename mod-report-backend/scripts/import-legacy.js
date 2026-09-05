// One-time migration helper: imports the JSON export produced by the main
// EduSolution app's `npm run export-mod-reports` (backend/scripts/
// export-mod-reports.js) into this app's own database, preserving report
// ids and timestamps so history looks identical from before/after the
// split. Safe to re-run — every insert is `INSERT OR IGNORE`, keyed on the
// legacy id, so running it twice against the same export just no-ops the
// second time rather than duplicating rows.
//
// Usage (from mod-report-backend/):
//   node scripts/import-legacy.js /path/to/mod-reports-export.json
require('dotenv').config();
const fs = require('fs');
const db = require('../src/db');

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/import-legacy.js <path-to-export.json>');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(file, 'utf8'));

const insertReport = db.prepare(`
  INSERT OR IGNORE INTO mod_reports
    (id, mod_name, report_date, weather, time_started, occupancy_percent, sections_json, villas_json, guest_interactions_json, issues_json, signature, submitted_by_name, submitted_at, edited_at)
  VALUES
    (@id, @mod_name, @report_date, @weather, @time_started, @occupancy_percent, @sections_json, @villas_json, @guest_interactions_json, @issues_json, @signature, @submitted_by_name, @submitted_at, @edited_at)
`);

const importReports = db.transaction((reports) => {
  let inserted = 0;
  for (const r of reports) {
    const result = insertReport.run(r);
    if (result.changes > 0) inserted += 1;
  }
  return inserted;
});

const insertedCount = importReports(data.mod_reports || []);
console.log(`Imported ${insertedCount} of ${(data.mod_reports || []).length} MOD report(s) (rows already present were skipped).`);

if (data.mod_report_settings) {
  const s = data.mod_report_settings;
  // Deliberately does not carry over the old submission_token — a public
  // link should be re-generated fresh from this app's own Settings tab
  // once it's live, not silently keep accepting submissions at the old
  // app's URL shape.
  db.prepare('UPDATE mod_report_settings SET business_name = ?, logo_image = ? WHERE id = 1').run(s.business_name || '', s.logo_image || '');
  console.log('Imported MOD report branding (business name / logo). Generate a new public link from Settings once this app is live.');
}
