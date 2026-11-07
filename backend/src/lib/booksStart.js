// The one "books start date": nothing dated before it counts in the finance
// figures (profit, revenue, expenses, the supplier "waiting for a supplier
// invoice" list, and — when no explicit starting-balance date is set — the
// bank balance). Records themselves (invoices, quotes, payments, expenses...)
// are never touched; they are just left out of the figures.
const db = require('../db');
const { BOOKS_START } = require('./businessDate');
const { isValidDate } = require('./validate');

// business_settings.books_start, falling back to the fixed floor when blank.
function booksStart() {
  let d = '';
  try {
    const row = db.prepare('SELECT books_start FROM business_settings WHERE id = 1').get();
    d = row && row.books_start;
  } catch {
    d = '';
  }
  return d && isValidDate(d) ? d : BOOKS_START;
}

module.exports = { booksStart };
