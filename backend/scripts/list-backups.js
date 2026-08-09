require('dotenv').config();
const { listBackups, isConfigured } = require('../src/lib/backup');

async function main() {
  if (!isConfigured()) {
    console.error('BACKUP_S3_* environment variables are not set (see .env.example).');
    process.exit(1);
  }

  const daily = await listBackups('backups/daily/');
  const weekly = await listBackups('backups/weekly/');

  console.log(`Daily backups (${daily.length}):`);
  daily.forEach((o) => console.log(`  ${o.Key}  (${o.LastModified.toISOString()}, ${o.Size} bytes)`));

  console.log(`\nWeekly backups (${weekly.length}):`);
  weekly.forEach((o) => console.log(`  ${o.Key}  (${o.LastModified.toISOString()}, ${o.Size} bytes)`));

  if (daily.length === 0 && weekly.length === 0) {
    console.log('\nNo backups found yet. Run `npm run backup` to create one.');
  }
}

main().catch((err) => {
  console.error('Listing backups failed:', err);
  process.exit(1);
});
