require('dotenv').config();
const { runBackup } = require('../src/lib/backup');

runBackup()
  .then((result) => {
    if (result.skipped) {
      console.log('Backup skipped — BACKUP_S3_* environment variables are not set (see .env.example).');
      process.exit(0);
    }
    console.log('Backup complete:', result);
    process.exit(0);
  })
  .catch((err) => {
    console.error('Backup failed:', err);
    process.exit(1);
  });
