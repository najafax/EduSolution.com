const { Router } = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = Router();
router.use(requireAuth);

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
  } = req.body || {};

  const timeoutNum = Number(session_timeout_minutes);
  if (!Number.isInteger(timeoutNum) || timeoutNum < 1 || timeoutNum > 480) {
    return res.status(400).json({ error: 'session_timeout_minutes must be a whole number between 1 and 480' });
  }

  db.prepare(
    `UPDATE business_settings
     SET business_name = ?, email = ?, phone = ?, address = ?, tax_id = ?, currency_symbol = ?, bank_details = ?,
         session_timeout_minutes = ?, updated_at = datetime('now')
     WHERE id = 1`,
  ).run(business_name, email, phone, address, tax_id, currency_symbol, bank_details, timeoutNum);

  const settings = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();
  res.json({ settings });
});

module.exports = router;
