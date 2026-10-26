const crypto = require('crypto');
const db = require('../db');
const { computeTotals } = require('./totals');
const { nextInvoiceNumber } = require('./numbering');
const { stampItemCosts } = require('./costSnapshot');
const { logActivity } = require('./activity');
const { todayStr, addDays } = require('./businessDate');

// A license that lapsed longer ago than this without being invoiced is assumed
// to be a deliberate lapse (client left, staff forgot to cancel) rather than
// something to start billing again automatically.
const LAPSED_GRACE_DAYS = 30;
// An existing unpaid invoice naming the license, issued this recently before
// the expiry, means the renewal has already been billed by hand.
const ALREADY_BILLED_LOOKBACK_DAYS = 90;

function leadDays() {
  const row = db.prepare('SELECT license_invoice_lead_days AS d FROM business_settings WHERE id = 1').get();
  return row ? Number(row.d) || 0 : 0;
}

// Drafts one renewal invoice per active license that is within `lead_days` of
// expiring (or recently lapsed). The invoice is a plain DRAFT for staff to
// review and send — nothing is ever emailed from here. Its single line item is
// named exactly like the license, so recording the payment later triggers the
// existing auto-renewal (routes/invoices.js matches line items to license
// names) and stamps the real amount received.
function generateLicenseRenewalInvoices({ userName = 'Automated' } = {}) {
  const lead = leadDays();
  if (lead <= 0) return { skipped: 'off', created: [], notBilled: [] };

  const today = todayStr();
  const candidates = db
    .prepare(
      `SELECT licenses.*, clients.name AS client_name
       FROM licenses JOIN clients ON clients.id = licenses.client_id
       WHERE licenses.status = 'active'
         AND licenses.expiry_date <= ? AND licenses.expiry_date >= ?
         AND licenses.renewal_invoice_for != licenses.expiry_date
       ORDER BY licenses.expiry_date, licenses.id`,
    )
    .all(addDays(today, lead), addDays(today, -LAPSED_GRACE_DAYS));

  const findBilled = db.prepare(
    `SELECT i.number FROM invoices i JOIN invoice_items it ON it.invoice_id = i.id
     WHERE i.client_id = ? AND i.status IN ('draft', 'sent')
       AND i.issue_date >= ? AND lower(trim(it.description)) = lower(trim(?))
     LIMIT 1`,
  );
  const findProduct = db.prepare('SELECT id, tax_rate FROM products WHERE lower(trim(name)) = lower(trim(?)) ORDER BY id DESC LIMIT 1');

  const created = [];
  const notBilled = [];
  for (const license of candidates) {
    try {
      if (!(Number(license.amount) > 0)) {
        notBilled.push({ license_id: license.id, name: license.name, client: license.client_name, reason: 'no amount set on the license' });
        continue;
      }
      const billed = findBilled.get(license.client_id, addDays(license.expiry_date, -ALREADY_BILLED_LOOKBACK_DAYS), license.name);
      if (billed) {
        notBilled.push({ license_id: license.id, name: license.name, client: license.client_name, reason: `already on unpaid invoice ${billed.number}` });
        continue;
      }

      const product = findProduct.get(license.name);
      const totals = computeTotals(
        [{ description: license.name, quantity: 1, unit_price: license.amount, product_id: product ? product.id : null }],
        product ? product.tax_rate : 0,
        'percentage',
        0,
      );
      const dueDate = license.expiry_date < today ? today : license.expiry_date;

      const make = db.transaction(() => {
        const number = nextInvoiceNumber();
        const invoiceId = db
          .prepare(
            `INSERT INTO invoices (number, client_id, status, issue_date, due_date, notes,
               discount_type, discount_value, subtotal, discount_amount, tax_rate, tax_amount, total, public_token)
             VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            number,
            license.client_id,
            today,
            dueDate,
            `Renewal of ${license.name} (current expiry ${license.expiry_date})`,
            totals.discountType,
            totals.discountValue,
            totals.subtotal,
            totals.discountAmount,
            totals.taxRate,
            totals.taxAmount,
            totals.total,
            crypto.randomBytes(16).toString('hex'),
          ).lastInsertRowid;
        const item = totals.items[0];
        db.prepare(
          'INSERT INTO invoice_items (invoice_id, product_id, description, quantity, unit_price, amount, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ).run(invoiceId, item.product_id, item.description, item.quantity, item.unit_price, item.amount, item.sort_order);
        stampItemCosts(invoiceId);
        db.prepare('UPDATE licenses SET renewal_invoice_id = ?, renewal_invoice_for = ? WHERE id = ?').run(invoiceId, license.expiry_date, license.id);
        return { invoiceId, number };
      });
      const { invoiceId, number } = make();
      logActivity({
        userName,
        action: 'drafted a renewal invoice for',
        entityType: 'license',
        entityId: license.id,
        entityLabel: `${license.name} (${license.client_name}) — ${number}`,
      });
      created.push({ license_id: license.id, name: license.name, client: license.client_name, invoice_id: invoiceId, number });
    } catch (err) {
      console.error(`[license-invoices] Failed for license #${license.id}:`, err.message);
      notBilled.push({ license_id: license.id, name: license.name, client: license.client_name, reason: err.message });
    }
  }
  console.log(`[license-invoices] Drafted ${created.length} renewal invoice(s), ${notBilled.length} not billed`);
  return { skipped: null, created, notBilled };
}

module.exports = { generateLicenseRenewalInvoices };
