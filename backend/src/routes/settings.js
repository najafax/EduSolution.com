const { Router } = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');

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

function validateImageField(value, label) {
  if (!value) return '';
  const match = IMAGE_DATA_URI_RE.exec(value);
  if (!match) throw new Error(`${label} must be a PNG or JPEG image`);
  const decodedBytes = Math.ceil((match[2].length * 3) / 4);
  if (decodedBytes > MAX_IMAGE_BYTES) throw new Error(`${label} must be smaller than 400KB`);
  return value;
}

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
  } = req.body || {};

  const timeoutNum = Number(session_timeout_minutes);
  if (!Number.isInteger(timeoutNum) || timeoutNum < 1 || timeoutNum > 480) {
    return res.status(400).json({ error: 'session_timeout_minutes must be a whole number between 1 and 480' });
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
         updated_at = datetime('now')
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
  );

  const settings = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();
  res.json({ settings });
});

module.exports = router;
