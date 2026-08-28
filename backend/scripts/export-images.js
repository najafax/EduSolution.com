// Decodes every image this app stores inline as a base64 data URI (see
// db/index.js's own notes on business_settings/mod_report_settings/
// payment_proofs/mod_reports — there's no separate file storage service,
// so every logo/signature/stamp/upload/issue-photo lives as text in a
// column) into real files on disk, so they can be opened with an ordinary
// image viewer instead of a SQL client. Read-only — never writes back to
// the database, same as scripts/db-query.js.
//
// Usage (run from the backend/ directory, against your real DB_PATH):
//   node scripts/export-images.js                    # writes to ./exported-images
//   node scripts/export-images.js --out=/tmp/photos   # custom output dir
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data.sqlite3');
const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

const outArg = process.argv.find((a) => a.startsWith('--out='));
const OUT_DIR = outArg ? outArg.split('=')[1] : path.join(process.cwd(), 'exported-images');
fs.mkdirSync(OUT_DIR, { recursive: true });

const EXT_BY_MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
};

let written = 0;
let skipped = 0;

// dataUri looks like "data:image/png;base64,iVBORw0KG..." — parses the
// mime type out (falling back to .bin for anything unrecognized, so an
// unexpected format still gets written rather than silently dropped) and
// writes the decoded bytes to <baseName>.<ext> inside OUT_DIR.
function writeDataUri(dataUri, baseName) {
  if (!dataUri || typeof dataUri !== 'string' || !dataUri.startsWith('data:')) {
    skipped += 1;
    return;
  }
  const match = dataUri.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) {
    skipped += 1;
    return;
  }
  const [, mime, base64] = match;
  const ext = EXT_BY_MIME[mime.toLowerCase()] || 'bin';
  const destPath = path.join(OUT_DIR, `${baseName}.${ext}`);
  fs.writeFileSync(destPath, Buffer.from(base64, 'base64'));
  console.log(`  ${destPath}`);
  written += 1;
}

function safe(name) {
  return String(name).replace(/[^a-z0-9._-]+/gi, '_').slice(0, 80);
}

console.log(`Database: ${DB_PATH}\nOutput:   ${OUT_DIR}\n`);

// business_settings — single row, logo/signature/stamp
const settings = db.prepare('SELECT logo_image, signature_image, stamp_image FROM business_settings WHERE id = 1').get();
if (settings) {
  console.log('business_settings:');
  writeDataUri(settings.logo_image, 'business-logo');
  writeDataUri(settings.signature_image, 'business-signature');
  writeDataUri(settings.stamp_image, 'business-stamp');
}

// mod_report_settings — single row, its own separate logo
const modSettings = db.prepare('SELECT logo_image FROM mod_report_settings WHERE id = 1').get();
if (modSettings) {
  console.log('mod_report_settings:');
  writeDataUri(modSettings.logo_image, 'mod-report-logo');
}

// payment_proofs — one row per client upload
const proofs = db.prepare('SELECT id, file_data, file_name FROM payment_proofs').all();
if (proofs.length > 0) {
  console.log(`payment_proofs (${proofs.length}):`);
  for (const p of proofs) {
    const stem = (p.file_name || 'file').replace(/\.[a-z0-9]+$/i, '');
    writeDataUri(p.file_data, `payment-proof-${p.id}-${safe(stem)}`);
  }
}

// mod_reports — a signature per report, plus any photos embedded in
// issues_json ([{ photo, caption }]) — parsed out since they're nested
// inside a JSON text column, not their own column.
const reports = db.prepare('SELECT id, signature, issues_json FROM mod_reports').all();
if (reports.length > 0) {
  console.log(`mod_reports (${reports.length}):`);
  for (const r of reports) {
    writeDataUri(r.signature, `mod-report-${r.id}-signature`);
    let issues = [];
    try {
      issues = JSON.parse(r.issues_json || '[]');
    } catch {
      issues = [];
    }
    issues.forEach((issue, i) => {
      if (issue && issue.photo) {
        writeDataUri(issue.photo, `mod-report-${r.id}-issue-${i + 1}`);
      }
    });
  }
}

console.log(`\n${written} file(s) written, ${skipped} blank/unrecognized field(s) skipped.`);
