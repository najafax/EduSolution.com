// Proves a backup can actually be restored: downloads the newest daily backup
// (or a key you name, or a local file), unpacks it into a scratch file, and
// runs the checks in lib/backupVerify.js on it. Never touches the live database.
//
//   npm run backup:verify                 newest daily backup from S3
//   npm run backup:verify -- <key>        a specific backup key
//   npm run backup:verify -- --file x.gz  a local .sqlite3 or .sqlite3.gz
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { verifySqliteFile } = require('../src/lib/backupVerify');

const args = process.argv.slice(2);
const fileIdx = args.indexOf('--file');
const scratch = path.join(__dirname, '..', `.verify-${Date.now()}.sqlite3`);

function cleanup() {
  for (const p of [scratch, `${scratch}-wal`, `${scratch}-shm`]) if (fs.existsSync(p)) fs.unlinkSync(p);
}

async function obtain() {
  if (fileIdx !== -1) {
    const src = args[fileIdx + 1];
    if (!src || !fs.existsSync(src)) throw new Error(`File not found: ${src}`);
    const raw = fs.readFileSync(src);
    fs.writeFileSync(scratch, src.endsWith('.gz') ? zlib.gunzipSync(raw) : raw);
    return { label: src, modified: fs.statSync(src).mtime };
  }
  const { isConfigured, listBackups, downloadBackup } = require('../src/lib/backup');
  if (!isConfigured()) throw new Error('BACKUP_S3_* environment variables are not set (see .env.example).');
  let key = args[0];
  let modified = null;
  const all = await listBackups('backups/daily/');
  if (!key) {
    if (all.length === 0) throw new Error('No daily backups found in the bucket.');
    const newest = all[all.length - 1];
    key = newest.Key;
    modified = newest.LastModified;
  } else {
    const hit = all.find((o) => o.Key === key) || (await listBackups(key))[0];
    modified = hit && hit.LastModified;
  }
  await downloadBackup(key, scratch);
  return { label: key, modified };
}

(async () => {
  try {
    const { label, modified } = await obtain();
    const ageH = modified ? (Date.now() - new Date(modified).getTime()) / 3_600_000 : null;
    console.log(`Backup: ${label}`);
    if (ageH !== null) console.log(`Age:    ${ageH.toFixed(1)} hours old`);
    console.log(`Size:   ${(fs.statSync(scratch).size / 1024 / 1024).toFixed(2)} MB once unpacked`);
    const r = verifySqliteFile(scratch);
    console.log(`Integrity: ${r.integrity}`);
    console.log('Rows:', Object.entries(r.counts).map(([t, n]) => `${t}=${n}`).join('  '));
    if (r.ok) {
      console.log('\nRESULT: OK — this backup restores to a healthy database.');
    } else {
      console.error('\nRESULT: PROBLEM');
      r.problems.forEach((p) => console.error(` - ${p}`));
      process.exitCode = 1;
    }
  } catch (err) {
    console.error('Verification failed:', err.message);
    process.exitCode = 1;
  } finally {
    cleanup();
  }
})();
