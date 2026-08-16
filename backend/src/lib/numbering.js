const db = require('../db');

// Sequential per-type, per-year numbers, e.g. Q-2026-0001, INV-2026-0001, R-2026-0001.
// Safe without locking: better-sqlite3 calls are synchronous, so nothing else
// can run between the MAX query and the INSERT that consumes this number.
// Derived from the highest existing sequence number rather than a row COUNT,
// so deleting anything other than the most-recently-numbered row can't cause
// the next generated number to collide with one that's still on the books.
function numberForYear(prefix, table, column, year) {
  const base = `${prefix}-${year}-`;
  const like = `${base}%`;
  const { maxSeq } = db
    .prepare(`SELECT MAX(CAST(SUBSTR(${column}, ${base.length + 1}) AS INTEGER)) AS maxSeq FROM ${table} WHERE ${column} LIKE ?`)
    .get(like);
  const seq = String((maxSeq || 0) + 1).padStart(4, '0');
  return `${base}${seq}`;
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
