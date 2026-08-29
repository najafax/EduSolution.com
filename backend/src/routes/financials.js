const { Router } = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = Router();
router.use(requireAuth);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
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
  // `from`/`to` are both optional — Dashboard.jsx's own call never sends
  // them (and always wants the unfiltered, all-time view it's always had),
  // while Financials.jsx's period-filter tabs (This year/Last year/This
  // month/Last month/All time) send both once a period other than "All
  // time" is selected. Malformed or partial input (a bug, not a real user
  // action — this isn't a hand-typed form) just falls back to unfiltered
  // rather than 400ing, since nothing here is destructive and failing open
  // to "show everything" is the safer default for a summary view.
  const { from, to } = req.query;
  const filtered = DATE_RE.test(from || '') && DATE_RE.test(to || '') && from <= to;
  const dateFilter = filtered ? ' AND issue_date BETWEEN ? AND ?' : '';
  const dateArgs = filtered ? [from, to] : [];

  const invoices = db.prepare(`SELECT * FROM invoices WHERE status != 'void'${dateFilter}`).all(...dateArgs);

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

  // A dedicated query, not derived from `invoices` above — that array
  // excludes 'void' (it feeds the financial totals, which void is
  // deliberately kept out of), but "Invoices by status" is a status
  // breakdown that void is very much one of the slices of (see
  // StatusBreakdownChart's own VOID entry) — deriving this from `invoices`
  // would silently drop every voided invoice from the chart. Scoped by the
  // same issue_date range when a period is selected, so the chart still
  // matches whichever period the KPI cards above it are showing.
  const invoiceCounts = db
    .prepare(`SELECT status, COUNT(*) AS c FROM invoices WHERE 1=1${dateFilter} GROUP BY status`)
    .all(...dateArgs)
    .reduce((acc, row) => ({ ...acc, [row.status]: row.c }), {});

  // Not period-scoped even when a filter is active — "how many clients does
  // this business have" is a live headcount, not something that happened
  // during a date range.
  const clientCount = db.prepare('SELECT COUNT(*) AS c FROM clients').get().c;

  const expenseDateFilter = filtered ? ' AND expense_date BETWEEN ? AND ?' : '';
  const totalExpenses = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE 1=1${expenseDateFilter}`).get(...dateArgs).total;
  // Deliberately excluded from netProfit: a capital contribution is an
  // owner/partner putting personal money into the business, not the
  // business earning it — folding it in would make "net profit" claim the
  // business was more profitable than it actually was. It still belongs in
  // bankBalance below, since that cash really did land in the account.
  const netProfit = Math.round((totalPaid - totalExpenses) * 100) / 100;

  const contributionDateFilter = filtered ? ' AND contribution_date BETWEEN ? AND ?' : '';
  const totalCapitalContributions = db
    .prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM capital_contributions WHERE 1=1${contributionDateFilter}`)
    .get(...dateArgs).total;
  // Same exclude-from-netProfit, include-in-bankBalance treatment as capital
  // contributions above, mirrored in the opposite direction: an owner draw
  // is personal money leaving the business, not a business expense, so it
  // doesn't belong in netProfit either — but the cash really did leave the
  // account, so bankBalance still needs to reflect it. A later 'return'
  // entry pays part or all of it back, so only the net (draws - returns)
  // actually moves the balance.
  const drawDateFilter = filtered ? ' AND draw_date BETWEEN ? AND ?' : '';
  const totalOwnerDraws = db
    .prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM owner_draws WHERE type = 'draw'${drawDateFilter}`)
    .get(...dateArgs).total;
  const totalOwnerReturns = db
    .prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM owner_draws WHERE type = 'return'${drawDateFilter}`)
    .get(...dateArgs).total;

  // Bank balance is fundamentally a running total, not a period sum — so
  // unlike every figure above, a period filter doesn't scope it to "just
  // this period," it moves *which instant* the balance is measured at:
  // the close of business on the filtered range's own `to` date (or today,
  // for the unfiltered/"All time" case, which is what this always meant
  // before period filtering existed). This mirrors
  // routes/reports.js's own GET /bank-balance/pdf closing-balance math
  // exactly, just collapsed to one cumulative "as of" cutoff instead of
  // that route's separate opening/closing split (nothing here needs the
  // opening figure, only the running total through `asOf`).
  const asOf = filtered ? to : today();
  const startingBalance = db.prepare('SELECT starting_balance FROM business_settings WHERE id = 1').get()?.starting_balance || 0;
  const paidThroughAsOf = db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE paid_at <= ?').get(asOf).total;
  const expensesThroughAsOf = db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE expense_date <= ?').get(asOf).total;
  const contributionsThroughAsOf = db
    .prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM capital_contributions WHERE contribution_date <= ?')
    .get(asOf).total;
  const drawsThroughAsOf = db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM owner_draws WHERE type = 'draw' AND draw_date <= ?").get(asOf).total;
  const returnsThroughAsOf = db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM owner_draws WHERE type = 'return' AND draw_date <= ?").get(asOf).total;
  const bankBalance =
    Math.round((startingBalance + paidThroughAsOf + contributionsThroughAsOf - expensesThroughAsOf - drawsThroughAsOf + returnsThroughAsOf) * 100) / 100;

  // Deliberately NOT scoped to the period filter — this widget is titled
  // "Revenue, last 6 months" on Financials.jsx, a fixed trailing window
  // independent of whatever period the KPI cards above it are showing, so
  // it always reflects the 6 months trailing from today regardless of
  // which filter tab is selected.
  const months = recentMonths(6);
  const invoicedByMonth = Object.fromEntries(months.map((m) => [m, 0]));
  const allInvoices = filtered ? db.prepare("SELECT * FROM invoices WHERE status != 'void'").all() : invoices;
  for (const inv of allInvoices) {
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

  const paymentDateFilter = filtered ? ' AND payments.paid_at BETWEEN ? AND ?' : '';
  const recentPayments = db
    .prepare(
      `SELECT payments.*, invoices.number AS invoice_number, clients.name AS client_name
       FROM payments
       JOIN invoices ON invoices.id = payments.invoice_id
       JOIN clients ON clients.id = invoices.client_id
       WHERE 1=1${paymentDateFilter}
       ORDER BY payments.paid_at DESC, payments.id DESC
       LIMIT 10`,
    )
    .all(...dateArgs);

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
    totalCapitalContributions: Math.round(totalCapitalContributions * 100) / 100,
    totalOwnerDraws: Math.round(totalOwnerDraws * 100) / 100,
    totalOwnerReturns: Math.round(totalOwnerReturns * 100) / 100,
    bankBalance,
    bankBalanceAsOf: asOf,
    quoteCounts,
    invoiceCounts,
    monthlyTrend,
    recentPayments,
  });
});

module.exports = router;
