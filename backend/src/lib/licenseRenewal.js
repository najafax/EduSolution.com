const db = require('../db');

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
// exactly one billing cycle from the *current* expiry_date, always landing
// on the same day-of-month as the original expiry, and writes the matching
// license_renewals row. This is true even for a badly lapsed license (e.g.
// expired years ago) — the new expiry can still land in the past, in which
// case the license simply reads as expired again until renewed once more;
// that's preferred over silently renewing from today's date, which would
// produce a new-expiry day-of-month unrelated to the license's real cycle.
// Shared by routes/licenses.js's POST /:id/renew (a human clicking "Renew")
// and routes/invoices.js's POST /:id/payments (an invoice whose line items
// name an active license auto-renews it the moment the invoice is paid in
// full) so both paths extend/record a renewal identically — callers are
// responsible for their own guards (e.g. status !== 'cancelled') before
// calling this. Also clears last_reminder_sent_at and
// last_renewal_confirmation_sent_at back to NULL — a fresh renewal means
// neither suppression should carry over from before it: the reminder
// shouldn't stay silenced for the license's next expiry cycle, and the
// "Send renewal confirmation" button (routes/licenses.js's own POST
// /:id/renewal-confirm, gated on this column) should reappear so staff can
// confirm *this* renewal, not read as already-confirmed from the last one.
//
// `amount`, when given as a finite, non-negative number, also updates
// licenses.amount to that figure as part of the same UPDATE — this is what
// keeps the "Amount" column meaning "the amount actually received at the
// last renewal" rather than a value that's only ever set once at creation
// and never touched again. Both callers pass a real figure when one's
// available: routes/licenses.js's POST /:id/renew forwards whatever amount
// staff typed into the Renew form, and routes/invoices.js's auto-renewal
// forwards the matched invoice line item's own `amount` — an exact figure,
// not a guess, since that's literally what the client was billed and paid
// for that license. Omitted (undefined), the license's `amount` is left
// exactly as it was — a renewal recorded with no amount given shouldn't
// silently reset the figure to something wrong.
function renewLicense(license, renewedByName, amount) {
  const nextExpiry = advanceExpiry(license.expiry_date, license.billing_cycle);
  const hasAmount = typeof amount === 'number' && Number.isFinite(amount) && amount >= 0;

  db.transaction(() => {
    if (hasAmount) {
      db.prepare(
        `UPDATE licenses SET expiry_date = ?, amount = ?, last_renewed_at = datetime('now'), last_reminder_sent_at = NULL, last_renewal_confirmation_sent_at = NULL, updated_at = datetime('now') WHERE id = ?`,
      ).run(nextExpiry, amount, license.id);
    } else {
      db.prepare(
        `UPDATE licenses SET expiry_date = ?, last_renewed_at = datetime('now'), last_reminder_sent_at = NULL, last_renewal_confirmation_sent_at = NULL, updated_at = datetime('now') WHERE id = ?`,
      ).run(nextExpiry, license.id);
    }
    db.prepare(
      `INSERT INTO license_renewals (license_id, previous_expiry_date, new_expiry_date, renewed_by_name) VALUES (?, ?, ?, ?)`,
    ).run(license.id, license.expiry_date, nextExpiry, renewedByName);
  })();

  return nextExpiry;
}

module.exports = { advanceExpiry, renewLicense };
