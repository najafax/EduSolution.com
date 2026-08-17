const { Router } = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = Router();
router.use(requireAuth);

const today = () => new Date().toISOString().slice(0, 10);
const monthKey = (dateStr) => dateStr.slice(0, 7); // 'YYYY-MM'

// Last `count` calendar months including the current one, oldest first.
function recentMonths(count) {
  const months = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

router.get('/summary', requirePermission('financials', 'view'), (req, res) => {
  const invoices = db.prepare("SELECT * FROM invoices WHERE status != 'void'").all();

  const totalInvoiced = invoices.reduce((sum, inv) => sum + inv.total, 0);
  const totalPaid = invoices.reduce((sum, inv) => sum + inv.amount_paid, 0);
  const totalOutstanding = Math.round((totalInvoiced - totalPaid) * 100) / 100;

  const overdue = invoices.filter(
    (inv) => inv.status === 'sent' && inv.amount_paid < inv.total && inv.due_date < today(),
  );
  const overdueAmount = Math.round(
    overdue.reduce((sum, inv) => sum + (inv.total - inv.amount_paid), 0) * 100,
  ) / 100;

  const quoteCounts = db
    .prepare('SELECT status, COUNT(*) AS c FROM quotes GROUP BY status')
    .all()
    .reduce((acc, row) => ({ ...acc, [row.status]: row.c }), {});

  const invoiceCounts = db
    .prepare('SELECT status, COUNT(*) AS c FROM invoices GROUP BY status')
    .all()
    .reduce((acc, row) => ({ ...acc, [row.status]: row.c }), {});

  const clientCount = db.prepare('SELECT COUNT(*) AS c FROM clients').get().c;

  const totalExpenses = db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM expenses').get().total;
  const netProfit = Math.round((totalPaid - totalExpenses) * 100) / 100;

  // Not a real-time bank feed — just the one number this app can actually
  // vouch for: whatever balance you had the day you set starting_balance
  // (business_settings, see routes/settings.js), plus every payment
  // collected since, minus every expense recorded since. Anything moving
  // money outside those two tables (a loan, a tax remittance, an owner
  // draw not logged as an expense) won't be reflected, so this is a
  // running proxy, not a bank statement.
  const startingBalance = db.prepare('SELECT starting_balance FROM business_settings WHERE id = 1').get()?.starting_balance || 0;
  const bankBalance = Math.round((startingBalance + netProfit) * 100) / 100;

  const months = recentMonths(6);
  const invoicedByMonth = Object.fromEntries(months.map((m) => [m, 0]));
  for (const inv of invoices) {
    const key = monthKey(inv.issue_date);
    if (key in invoicedByMonth) invoicedByMonth[key] += inv.total;
  }
  const allPayments = db.prepare('SELECT amount, paid_at FROM payments').all();
  const paidByMonth = Object.fromEntries(months.map((m) => [m, 0]));
  for (const p of allPayments) {
    const key = monthKey(p.paid_at);
    if (key in paidByMonth) paidByMonth[key] += p.amount;
  }
  const monthlyTrend = months.map((m) => ({
    month: m,
    invoiced: Math.round(invoicedByMonth[m] * 100) / 100,
    paid: Math.round(paidByMonth[m] * 100) / 100,
  }));

  const recentPayments = db
    .prepare(
      `SELECT payments.*, invoices.number AS invoice_number, clients.name AS client_name
       FROM payments
       JOIN invoices ON invoices.id = payments.invoice_id
       JOIN clients ON clients.id = invoices.client_id
       ORDER BY payments.paid_at DESC, payments.id DESC
       LIMIT 10`,
    )
    .all();

  res.json({
    totalInvoiced: Math.round(totalInvoiced * 100) / 100,
    totalPaid: Math.round(totalPaid * 100) / 100,
    totalOutstanding,
    overdueCount: overdue.length,
    overdueAmount,
    invoiceCount: invoices.length,
    clientCount,
    totalExpenses: Math.round(totalExpenses * 100) / 100,
    netProfit,
    bankBalance,
    quoteCounts,
    invoiceCounts,
    monthlyTrend,
    recentPayments,
  });
});

module.exports = router;
