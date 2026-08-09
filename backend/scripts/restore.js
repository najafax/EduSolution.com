require('dotenv').config();
const path = require('path');
const { downloadBackup, isConfigured } = require('../src/lib/backup');

const key = process.argv[2];
const dest = process.argv[3] || path.join(__dirname, '..', `restored-${Date.now()}.sqlite3`);

if (!key) {
  console.error('Usage: node scripts/restore.js <backup-key> [dest-path]');
  console.error('Run `npm run backup:list` to see available backup keys.');
  process.exit(1);
}

if (!isConfigured()) {
  console.error('BACKUP_S3_* environment variables are not set (see .env.example).');
  process.exit(1);
}

const livePath = process.env.DB_PATH || path.join(__dirname, '..', 'data.sqlite3');
if (path.resolve(dest) === path.resolve(livePath)) {
  console.error(`Refusing to write directly over the live database (${livePath}).`);
  console.error('Restore to a separate path, verify it, then swap it in manually while the backend is stopped.');
  process.exit(1);
}

downloadBackup(key, dest)
  .then(() => {
    console.log(`Restored "${key}" to ${dest}`);
    console.log('');
    console.log('This is a separate file — your live database has not been touched.');
    console.log('To actually roll back: stop the backend, replace the DB_PATH file with this one, then restart.');
  })
  .catch((err) => {
    console.error('Restore failed:', err);
    process.exit(1);
  });
