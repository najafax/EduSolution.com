const db = require('../db');

// Sequential per-type, per-year numbers, e.g. Q-2026-0001, INV-2026-0001, R-2026-0001.
// Safe without locking: better-sqlite3 calls are synchronous, so nothing else
// can run between the COUNT and the INSERT that consumes this number.
function nextNumber(prefix, table) {
  const year = new Date().getFullYear();
  const like = `${prefix}-${year}-%`;
  const { c } = db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE number LIKE ?`).get(like);
  const seq = String(c + 1).padStart(4, '0');
  return `${prefix}-${year}-${seq}`;
}

function nextReceiptNumber() {
  const year = new Date().getFullYear();
  const like = `R-${year}-%`;
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM payments WHERE receipt_number LIKE ?').get(like);
  const seq = String(c + 1).padStart(4, '0');
  return `R-${year}-${seq}`;
}

module.exports = {
  nextQuoteNumber: () => nextNumber('Q', 'quotes'),
  nextInvoiceNumber: () => nextNumber('INV', 'invoices'),
  nextReceiptNumber,
};
