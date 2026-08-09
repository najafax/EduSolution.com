const { Router } = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const settings = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();
  res.json({ settings });
});

router.put('/', (req, res) => {
  const {
    business_name = '',
    email = '',
    phone = '',
    address = '',
    tax_id = '',
    currency_symbol = '$',
    bank_details = '',
  } = req.body || {};

  db.prepare(
    `UPDATE business_settings
     SET business_name = ?, email = ?, phone = ?, address = ?, tax_id = ?, currency_symbol = ?, bank_details = ?,
         updated_at = datetime('now')
     WHERE id = 1`,
  ).run(business_name, email, phone, address, tax_id, currency_symbol, bank_details);

  const settings = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();
  res.json({ settings });
});

module.exports = router;
