const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');
const db = require('../db');
const { verifySqliteFile } = require('./backupVerify');
const { sendOpsAlert } = require('./opsAlert');

const BUCKET = process.env.BACKUP_S3_BUCKET;
const ENDPOINT = process.env.BACKUP_S3_ENDPOINT;
const REGION = process.env.BACKUP_S3_REGION || 'auto';
const ACCESS_KEY_ID = process.env.BACKUP_S3_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.BACKUP_S3_SECRET_ACCESS_KEY;
const DAILY_RETENTION = Number(process.env.BACKUP_RETENTION_DAILY) || 7;
const WEEKLY_RETENTION = Number(process.env.BACKUP_RETENTION_WEEKLY) || 4;

function isConfigured() {
  return Boolean(BUCKET && ENDPOINT && ACCESS_KEY_ID && SECRET_ACCESS_KEY);
}

function client() {
  return new S3Client({
    region: REGION,
    endpoint: ENDPOINT,
    credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY },
  });
}

// SQLite's VACUUM INTO writes a consistent, defragmented snapshot to a new
// file in one step — safe to run against a live WAL-mode database (unlike
// copying data.sqlite3's bytes directly, which can catch a write mid-flight
// and produce a corrupt copy).
function createSnapshot() {
  const tmpPath = path.join(os.tmpdir(), `edusolution-backup-${Date.now()}.sqlite3`);
  if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  const escaped = tmpPath.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${escaped}'`);
  return tmpPath;
}

function gzipFile(filePath) {
  const gzPath = `${filePath}.gz`;
  fs.writeFileSync(gzPath, zlib.gzipSync(fs.readFileSync(filePath)));
  return gzPath;
}

async function uploadBackup(filePath, key) {
  await client().send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: fs.readFileSync(filePath),
      ContentType: 'application/gzip',
    }),
  );
}

async function listBackups(prefix) {
  const results = [];
  let ContinuationToken;
  do {
    const res = await client().send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken }));
    (res.Contents || []).forEach((obj) => results.push(obj));
    ContinuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (ContinuationToken);
  // Keys embed an ISO timestamp, so lexical sort is also chronological sort.
  return results.sort((a, b) => a.Key.localeCompare(b.Key));
}

async function pruneBackups(prefix, keep) {
  const objects = await listBackups(prefix);
  const toDelete = objects.slice(0, Math.max(0, objects.length - keep));
  for (const obj of toDelete) {
    await client().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: obj.Key }));
  }
  return toDelete.length;
}

async function downloadBackup(key, destPath) {
  const res = await client().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const chunks = [];
  for await (const chunk of res.Body) chunks.push(chunk);
  fs.writeFileSync(destPath, zlib.gunzipSync(Buffer.concat(chunks)));
}

function timestampKey() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

// Exported directly (like the scheduler.js jobs) so it can be invoked
// outside the cron schedule — the backend/scripts/*.js CLIs, or tests.
async function runBackup() {
  if (!isConfigured()) {
    console.log('[backup] BACKUP_S3_* not configured, skipping database backup');
    return { skipped: true };
  }

  const snapshotPath = createSnapshot();
  let gzPath;
  try {
    gzPath = gzipFile(snapshotPath);
    const stamp = timestampKey();
    const dailyKey = `backups/daily/${stamp}.sqlite3.gz`;
    await uploadBackup(gzPath, dailyKey);

    // Also keep a longer-retention copy under weekly/ once a week.
    let weeklyKey = null;
    if (new Date().getUTCDay() === 0) {
      weeklyKey = `backups/weekly/${stamp}.sqlite3.gz`;
      await uploadBackup(gzPath, weeklyKey);
    }

    const dailyDeleted = await pruneBackups('backups/daily/', DAILY_RETENTION);
    const weeklyDeleted = await pruneBackups('backups/weekly/', WEEKLY_RETENTION);

    console.log(
      `[backup] uploaded ${dailyKey}${weeklyKey ? ` and ${weeklyKey}` : ''}, pruned ${dailyDeleted} daily / ${weeklyDeleted} weekly`,
    );
    return { skipped: false, dailyKey, weeklyKey };
  } finally {
    if (fs.existsSync(snapshotPath)) fs.unlinkSync(snapshotPath);
    if (gzPath && fs.existsSync(gzPath)) fs.unlinkSync(gzPath);
  }
}

// Weekly proof that the newest daily backup really restores: download it,
// unpack to a scratch file, run the integrity/table checks, delete it. Only a
// problem is reported (Telegram, via opsAlert) — a healthy run just logs.
async function verifyLatestBackup() {
  if (!isConfigured()) return { skipped: true };
  const scratch = path.join(os.tmpdir(), `edusolution-verify-${Date.now()}.sqlite3`);
  try {
    const all = await listBackups('backups/daily/');
    if (all.length === 0) throw new Error('no daily backups found in the bucket');
    const newest = all[all.length - 1];
    await downloadBackup(newest.Key, scratch);
    const result = verifySqliteFile(scratch);
    if (!result.ok) throw new Error(`${newest.Key}: ${result.problems.join('; ')}`);
    console.log(`[backup] verified ${newest.Key} restores cleanly (${JSON.stringify(result.counts)})`);
    return { skipped: false, ok: true, key: newest.Key, counts: result.counts };
  } catch (err) {
    console.error('[backup] verification FAILED:', err.message);
    sendOpsAlert(`⚠️ Backup verification FAILED — the latest backup may not restore.\n${err.message}`, 'backup-verify');
    return { skipped: false, ok: false, error: err.message };
  } finally {
    for (const p of [scratch, `${scratch}-wal`, `${scratch}-shm`]) if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

module.exports = { isConfigured, runBackup, listBackups, downloadBackup, createSnapshot, verifyLatestBackup };
