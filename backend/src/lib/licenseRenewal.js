const db = require('../db');

const today = () => new Date().toISOString().slice(0, 10);

// Same month-end-clamped billing-cycle math lib/scheduler.js's own
// advanceDate() applies for recurring invoices (e.g. Jan 31 + monthly
// clamps to Feb 28/29 instead of rolling into March).
function advanceExpiry(dateStr, cycle) {
  const d = new Date(`${dateStr}T00:00:00`);
  const originalDay = d.getDate();
  if (cycle === 'yearly') d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1); // monthly, the default
  if (d.getDate() !== originalDay) d.setDate(0);
  return d.toISOString().slice(0, 10);
}

// The one place a license actually gets renewed — extends expiry_date by
// one billing cycle from whichever is later, the current expiry_date or
// today (renewing early keeps the remaining time instead of losing it,
// renewing a lapsed license doesn't backdate a short window from the old
// expiry), and writes the matching license_renewals row. Shared by
// routes/licenses.js's POST /:id/renew (a human clicking "Renew") and
// routes/invoices.js's POST /:id/payments (an invoice whose line items name
// an active license auto-renews it the moment the invoice is paid in full)
// so both paths extend/record a renewal identically — callers are
// responsible for their own guards (e.g. status !== 'cancelled') before
// calling this.
function renewLicense(license, renewedByName) {
  const base = license.expiry_date > today() ? license.expiry_date : today();
  const nextExpiry = advanceExpiry(base, license.billing_cycle);

  db.transaction(() => {
    db.prepare(
      `UPDATE licenses SET expiry_date = ?, last_renewed_at = datetime('now'), last_reminder_sent_at = NULL, updated_at = datetime('now') WHERE id = ?`,
    ).run(nextExpiry, license.id);
    db.prepare(
      `INSERT INTO license_renewals (license_id, previous_expiry_date, new_expiry_date, renewed_by_name) VALUES (?, ?, ?, ?)`,
    ).run(license.id, license.expiry_date, nextExpiry, renewedByName);
  })();

  return nextExpiry;
}

module.exports = { advanceExpiry, renewLicense };
