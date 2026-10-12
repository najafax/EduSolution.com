const fs = require('fs');
const path = require('path');
const { Router } = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { isConfigured: isBackupConfigured, listBackups } = require('../lib/backup');

const router = Router();
router.use(requireAuth);

// Signature/stamp are uploaded as data URIs (see frontend Settings.jsx,
// which reads the chosen file with FileReader) rather than going through a
// file-upload endpoint — there's no file storage in this app beyond the
// SQLite DB itself (see db/index.js), and a single business only ever needs
// one of each, so storing them as base64 text alongside the rest of
// business_settings avoids standing up upload/storage infra for two rarely
// -changed images. PDFKit (lib/pdf.js) only supports PNG/JPEG, so those are
// the only two accepted here. Capped well under Express's json() limit
// (bumped to 2mb in index.js for exactly this) so a stray huge upload can't
// bloat every future GET/PUT /api/settings response.
const IMAGE_DATA_URI_RE = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/]+=*)$/;
const MAX_IMAGE_BYTES = 400 * 1024;
const PDF_TEMPLATES = new Set(['modern', 'minimal']);

function validateImageField(value, label) {
  if (!value) return '';
  const match = IMAGE_DATA_URI_RE.exec(value);
  if (!match) throw new Error(`${label} must be a PNG or JPEG image`);
  const decodedBytes = Math.ceil((match[2].length * 3) / 4);
  if (decodedBytes > MAX_IMAGE_BYTES) throw new Error(`${label} must be smaller than 400KB`);
  return value;
}

// A lightweight sibling of GET / for callers that only ever need the
// currency symbol/business name (QuoteForm.jsx/InvoiceForm.jsx's own
// LineItemsEditor currency prop, see frontend/src/lib/api.js) — GET /
// returns the full row, logo/signature/stamp images included, which can
// run past a megabyte of base64 once all three are set (see the 400KB cap
// each one is validated against below); a form that opens on every new
// quote/invoice has no reason to pull that down just to read a 3-character
// symbol. Same requirePermission('settings', 'view') gate as GET / itself,
// so this changes nothing about who can see what, only how much a caller
// that already could see it has to download to get it.
router.get('/summary', requirePermission('settings', 'view'), (req, res) => {
  const settings = db
    .prepare('SELECT currency_symbol, business_name FROM business_settings WHERE id = 1')
    .get();
  res.json({ settings });
});

// Storage readout for the Settings page's "Data" section — the real SQLite
// file's own size (`db.name` is better-sqlite3's own property for the path
// it was opened with, the same `DB_PATH`-or-local-default value db/index.js
// resolves, so this never needs its own copy of that resolution logic) plus,
// best-effort, the free/total space on whichever disk that file actually
// lives on. `fs.statfsSync` (Node 18.15+) isn't guaranteed on every runtime
// this app might ever be deployed to, so a failure there is swallowed and
// just means `diskFreeBytes`/`diskTotalBytes` come back `null` — the
// frontend already treats either as optional and simply doesn't render that
// half of the readout, same "degrade gracefully, don't 500 over a nice-to-
// have" call this app makes elsewhere (e.g. a missing SMTP config).
// Also reports the WAL sidecar's own size (a real diagnostic signal — see
// backend/telegram-bot/bot.js's own dbFileSizes(), which this mirrors: a WAL
// file that's grown large and isn't shrinking usually means checkpointing
// isn't happening) and, when BACKUP_S3_* is configured (lib/backup.js),
// when the last daily/weekly backup actually landed — so "Data" can answer
// "is this app actually protected right now," not just "how big is the
// file." The S3 listing calls are the one part of this route that can be
// slow or fail outright (a misconfigured bucket, a network blip); wrapped
// in their own try/catch so a backup-listing failure never takes down the
// rest of the (synchronous, local-filesystem) storage readout.
router.get('/storage', requirePermission('settings', 'view'), async (req, res) => {
  let dbSizeBytes = null;
  try {
    dbSizeBytes = fs.statSync(db.name).size;
  } catch (err) {
    return res.status(500).json({ error: 'Could not read database file size' });
  }

  let walSizeBytes = null;
  try {
    walSizeBytes = fs.statSync(`${db.name}-wal`).size;
  } catch (err) {
    // No WAL sidecar right now (just checkpointed) — left as null.
  }

  let diskFreeBytes = null;
  let diskTotalBytes = null;
  try {
    const stats = fs.statfsSync(path.dirname(db.name));
    diskFreeBytes = stats.bavail * stats.bsize;
    diskTotalBytes = stats.blocks * stats.bsize;
  } catch (err) {
    // Not available on this Node version/platform — left as null.
  }

  const backupConfigured = isBackupConfigured();
  let lastDailyBackupAt = null;
  let lastWeeklyBackupAt = null;
  if (backupConfigured) {
    try {
      const [daily, weekly] = await Promise.all([listBackups('backups/daily/'), listBackups('backups/weekly/')]);
      if (daily.length) lastDailyBackupAt = daily[daily.length - 1].LastModified;
      if (weekly.length) lastWeeklyBackupAt = weekly[weekly.length - 1].LastModified;
    } catch (err) {
      // S3 unreachable/misconfigured right now — leave both null rather
      // than 500ing the whole storage readout over an optional detail.
    }
  }

  res.json({
    dbSizeBytes,
    walSizeBytes,
    diskFreeBytes,
    diskTotalBytes,
    backupConfigured,
    lastDailyBackupAt,
    lastWeeklyBackupAt,
  });
});

router.get('/', requirePermission('settings', 'view'), (req, res) => {
  const settings = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();
  res.json({ settings });
});

router.put('/', requirePermission('settings', 'manage'), (req, res) => {
  const {
    business_name = '',
    email = '',
    phone = '',
    address = '',
    tax_id = '',
    currency_symbol = '$',
    bank_details = '',
    session_timeout_minutes = 30,
    signature_image = '',
    stamp_image = '',
    logo_image = '',
    signatory_name = '',
    pdf_template = 'modern',
    starting_balance = 0,
  } = req.body || {};

  const timeoutNum = Number(session_timeout_minutes);
  if (!Number.isInteger(timeoutNum) || timeoutNum < 1 || timeoutNum > 480) {
    return res.status(400).json({ error: 'session_timeout_minutes must be a whole number between 1 and 480' });
  }
  if (!PDF_TEMPLATES.has(pdf_template)) {
    return res.status(400).json({ error: `pdf_template must be one of: ${[...PDF_TEMPLATES].join(', ')}` });
  }
  const startingBalanceNum = Number(starting_balance);
  if (!Number.isFinite(startingBalanceNum)) {
    return res.status(400).json({ error: 'starting_balance must be a number' });
  }

  let signatureImage, stampImage, logoImage;
  try {
    signatureImage = validateImageField(signature_image, 'Authorized signature');
    stampImage = validateImageField(stamp_image, 'Company stamp');
    logoImage = validateImageField(logo_image, 'Logo');
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  db.prepare(
    `UPDATE business_settings
     SET business_name = ?, email = ?, phone = ?, address = ?, tax_id = ?, currency_symbol = ?, bank_details = ?,
         session_timeout_minutes = ?, signature_image = ?, stamp_image = ?, logo_image = ?, signatory_name = ?,
         pdf_template = ?, starting_balance = ?, updated_at = datetime('now')
     WHERE id = 1`,
  ).run(
    business_name,
    email,
    phone,
    address,
    tax_id,
    currency_symbol,
    bank_details,
    timeoutNum,
    signatureImage,
    stampImage,
    logoImage,
    signatory_name,
    pdf_template,
    startingBalanceNum,
  );

  const settings = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();
  res.json({ settings });
});

module.exports = router;
