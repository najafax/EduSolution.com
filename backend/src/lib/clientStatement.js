const db = require('../db');
const { todayStr } = require('./businessDate');

// A client's account statement: every invoice (sent or paid — drafts and
// voids are not receivables, same set as receivablesAging) as a charge on its
// issue date, every payment as a credit on its paid date (a payment reversal
// is a negative payment, so it shows as a charge again), with a running
// balance. Entries before `from` collapse into the opening balance.
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const dayNumber = (d) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86400000);

function computeStatement(clientId, from, to = todayStr()) {
  const client = db.prepare('SELECT id, name, email, phone, address FROM clients WHERE id = ?').get(clientId);
  if (!client) return null;

  const invoices = db
    .prepare("SELECT id, number, issue_date, due_date, total, po_number FROM invoices WHERE client_id = ? AND status IN ('sent','paid') AND issue_date <= ?")
    .all(clientId, to);
  const payments = db
    .prepare(
      `SELECT p.id, p.receipt_number, substr(p.paid_at, 1, 10) AS paid_date, p.amount, p.method, p.reference, i.number AS invoice_number
         FROM payments p JOIN invoices i ON i.id = p.invoice_id
        WHERE i.client_id = ? AND i.status IN ('sent','paid') AND substr(p.paid_at, 1, 10) <= ?`
    )
    .all(clientId, to);

  const all = [
    ...invoices.map((i) => ({
      date: i.issue_date, order: 0, id: i.id, type: 'invoice', ref: i.number,
      description: i.po_number ? `Invoice · PO ${i.po_number}` : 'Invoice',
      charge: i.total, payment: 0,
    })),
    ...payments.map((p) => ({
      date: p.paid_date, order: 1, id: p.id, type: p.amount < 0 ? 'reversal' : 'payment',
      ref: p.receipt_number || p.invoice_number,
      description: p.amount < 0 ? `Payment reversed · ${p.invoice_number}` : `Payment · ${p.invoice_number}${p.reference ? ` · ${p.reference}` : ''}`,
      charge: p.amount < 0 ? -p.amount : 0, payment: p.amount < 0 ? 0 : p.amount,
    })),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order || a.id - b.id));

  let running = 0;
  let opening = 0;
  let charges = 0;
  let paid = 0;
  const entries = [];
  for (const e of all) {
    running = round2(running + e.charge - e.payment);
    if (e.date < from) {
      opening = running;
      continue;
    }
    charges += e.charge;
    paid += e.payment;
    entries.push({ ...e, balance: running });
  }

  const today = to;
  const open = db
    .prepare("SELECT number, due_date, total, amount_paid FROM invoices WHERE client_id = ? AND status = 'sent' AND total - amount_paid > 0.005 ORDER BY due_date")
    .all(clientId)
    .map((i) => ({
      number: i.number,
      due_date: i.due_date,
      balance: round2(i.total - i.amount_paid),
      days_overdue: Math.max(0, dayNumber(today) - dayNumber(i.due_date)),
    }));

  return {
    client,
    from,
    to,
    openingBalance: opening,
    entries,
    totalCharges: round2(charges),
    totalPayments: round2(paid),
    closingBalance: running,
    openInvoices: open,
  };
}

module.exports = { computeStatement };
