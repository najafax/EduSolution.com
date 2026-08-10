const db = require('../db');

// Sequential per-type, per-year numbers, e.g. Q-2026-0001, INV-2026-0001, R-2026-0001.
// Safe without locking: better-sqlite3 calls are synchronous, so nothing else
// can run between the COUNT and the INSERT that consumes this number.
function numberForYear(prefix, table, column, year) {
  const like = `${prefix}-${year}-%`;
  const { c } = db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE ${column} LIKE ?`).get(like);
  const seq = String(c + 1).padStart(4, '0');
  return `${prefix}-${year}-${seq}`;
}

function nextNumber(prefix, table) {
  return numberForYear(prefix, table, 'number', new Date().getFullYear());
}

function nextReceiptNumber() {
  return numberForYear('R', 'payments', 'receipt_number', new Date().getFullYear());
}

module.exports = {
  nextQuoteNumber: () => nextNumber('Q', 'quotes'),
  nextInvoiceNumber: () => nextNumber('INV', 'invoices'),
  nextReceiptNumber,
  // Historical-import-only: same scheme, but for a specific (possibly past)
  // year rather than always "now" — so an invoice dated 2023 gets an
  // INV-2023-#### number instead of being stamped with the current year.
  invoiceNumberForYear: (year) => numberForYear('INV', 'invoices', 'number', year),
  quoteNumberForYear: (year) => numberForYear('Q', 'quotes', 'number', year),
  receiptNumberForYear: (year) => numberForYear('R', 'payments', 'receipt_number', year),
};
