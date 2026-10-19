const { Router } = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { renderSalesReportPdf, renderTaxReportPdf, renderExpenseReportPdf, renderProfitLossPdf, renderBankBalancePdf, renderReceivablesAgingPdf } = require('../lib/reportPdf');
const { computeAging } = require('../lib/receivablesAging');

const router = Router();
router.use(requireAuth);
// Gated on the same 'financials' grant as the Financials page/summary
// endpoint, not a dedicated 'reports' module — these PDFs surface the same
// sales/tax/expense data at the same sensitivity level, so reusing the
// existing grant avoids a second permission slot (and a Users page update)
// for data staff can already see on the Financials page once granted.
router.use(requirePermission('financials', 'view'));

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDateRange(req, res) {
  const { from, to } = req.query;
  if (!DATE_RE.test(from || '') || !DATE_RE.test(to || '')) {
    res.status(400).json({ error: 'from and to are required as YYYY-MM-DD' });
    return null;
  }
  if (from > to) {
    res.status(400).json({ error: 'from must not be after to' });
    return null;
  }
  return { from, to };
}

function getSettings() {
  return db.prepare('SELECT * FROM business_settings WHERE id = 1').get();
}

function sendPdf(res, buffer, filename) {
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${filename}"` });
  res.send(buffer);
}

// Sales and tax reports both read from invoices by issue_date (accrual —
// what was billed in the period, regardless of whether it's been paid
// yet), excluding void invoices the same way routes/financials.js does.
function invoicesInRange(from, to) {
  return db
    .prepare(
      `SELECT invoices.*, clients.name AS client_name
       FROM invoices JOIN clients ON clients.id = invoices.client_id
       WHERE invoices.status NOT IN ('void', 'draft') AND issue_date BETWEEN ? AND ?
       ORDER BY issue_date ASC, invoices.id ASC`,
    )
    .all(from, to);
}

// Receivables aging: a point-in-time snapshot (what is owed as of a date),
// not a from/to range, so it has its own optional ?asOf= param.
function parseAsOf(req, res) {
  const { asOf } = req.query;
  if (asOf === undefined || asOf === '') return undefined;
  if (!DATE_RE.test(asOf)) {
    res.status(400).json({ error: 'asOf must be YYYY-MM-DD' });
    return null;
  }
  return asOf;
}

router.get('/receivables-aging', (req, res) => {
  const asOf = parseAsOf(req, res);
  if (asOf === null) return;
  res.json(computeAging(asOf));
});

router.get('/receivables-aging/pdf', async (req, res) => {
  const asOf = parseAsOf(req, res);
  if (asOf === null) return;
  const aging = computeAging(asOf);
  const buffer = await renderReceivablesAgingPdf({ aging, settings: getSettings() });
  sendPdf(res, buffer, `receivables-aging-${aging.asOf}.pdf`);
});

router.get('/sales/pdf', async (req, res) => {
  const range = parseDateRange(req, res);
  if (!range) return;
  const invoices = invoicesInRange(range.from, range.to);
  const buffer = await renderSalesReportPdf({ invoices, from: range.from, to: range.to, settings: getSettings() });
  sendPdf(res, buffer, `sales-report-${range.from}-to-${range.to}.pdf`);
});

router.get('/tax/pdf', async (req, res) => {
  const range = parseDateRange(req, res);
  if (!range) return;
  const invoices = invoicesInRange(range.from, range.to);
  const buffer = await renderTaxReportPdf({ invoices, from: range.from, to: range.to, settings: getSettings() });
  sendPdf(res, buffer, `tax-report-${range.from}-to-${range.to}.pdf`);
});

router.get('/expenses/pdf', async (req, res) => {
  const range = parseDateRange(req, res);
  if (!range) return;
  const expenses = db
    .prepare('SELECT * FROM expenses WHERE expense_date BETWEEN ? AND ? ORDER BY category ASC, expense_date ASC, id ASC')
    .all(range.from, range.to);
  const buffer = await renderExpenseReportPdf({ expenses, from: range.from, to: range.to, settings: getSettings() });
  sendPdf(res, buffer, `expense-report-${range.from}-to-${range.to}.pdf`);
});

// Revenue here is cash actually received in the period (payments.paid_at),
// not invoiced amount — the same cash-ish convention routes/financials.js
// uses for netProfit (totalPaid - totalExpenses), just scoped to a date
// range instead of all-time. Expenses are grouped by category so the PDF
// can show a per-category breakdown, same as a conventional P&L statement.
router.get('/profit-loss/pdf', async (req, res) => {
  const range = parseDateRange(req, res);
  if (!range) return;
  const revenueTotal = db
    .prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE paid_at BETWEEN ? AND ?')
    .get(range.from, range.to).total;
  const expensesByCategory = db
    .prepare('SELECT category, COALESCE(SUM(amount), 0) AS total FROM expenses WHERE expense_date BETWEEN ? AND ? GROUP BY category ORDER BY total DESC')
    .all(range.from, range.to);
  const totalExpenses = expensesByCategory.reduce((sum, c) => sum + c.total, 0);
  const buffer = await renderProfitLossPdf({
    revenueTotal,
    expensesByCategory,
    totalExpenses,
    from: range.from,
    to: range.to,
    settings: getSettings(),
  });
  sendPdf(res, buffer, `profit-loss-${range.from}-to-${range.to}.pdf`);
});

// Opening/closing balance for the period — same starting_balance +
// payments/contributions-minus-expenses math as routes/financials.js's
// bankBalance, just split at the period boundary instead of "as of right
// now": opening balance is everything recorded strictly before `from`,
// closing balance adds everything through `to` (inclusive, same BETWEEN
// convention every other report here uses).
router.get('/bank-balance/pdf', async (req, res) => {
  const range = parseDateRange(req, res);
  if (!range) return;

  const settingsRow = getSettings();
  const startingBalance = settingsRow.starting_balance || 0;
  // Transactions dated before the starting-balance date are already inside
  // the starting balance, so they never count (blank = no cutoff).
  const sinceDate = settingsRow.starting_balance_date || '0000-00-00';
  const before = (table, col, extra = '') =>
    db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM ${table} WHERE ${col} >= ? AND ${col} < ?${extra}`).get(sinceDate, range.from).total;
  const paidBefore = before('payments', 'paid_at');
  const expensesBefore = before('expenses', 'expense_date');
  const contributionsBefore = before('capital_contributions', 'contribution_date');
  const drawsBefore = before('owner_draws', 'draw_date', " AND type = 'draw'");
  const returnsBefore = before('owner_draws', 'draw_date', " AND type = 'return'");
  const distributionsBefore = before('owner_draws', 'draw_date', " AND type = 'profit_distribution'");
  const openingBalance =
    Math.round(
      (startingBalance + paidBefore + contributionsBefore - expensesBefore - drawsBefore + returnsBefore - distributionsBefore) * 100,
    ) / 100;

  const periodFrom = range.from > sinceDate ? range.from : sinceDate;
  const within = (table, col, extra = '') =>
    db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM ${table} WHERE ${col} BETWEEN ? AND ?${extra}`).get(periodFrom, range.to).total;
  const totalPayments = within('payments', 'paid_at');
  const totalExpenses = within('expenses', 'expense_date');
  const totalContributions = within('capital_contributions', 'contribution_date');
  const totalDraws = within('owner_draws', 'draw_date', " AND type = 'draw'");
  const totalReturns = within('owner_draws', 'draw_date', " AND type = 'return'");
  const totalDistributions = within('owner_draws', 'draw_date', " AND type = 'profit_distribution'");
  const closingBalance =
    Math.round(
      (openingBalance + totalPayments + totalContributions - totalExpenses - totalDraws + totalReturns - totalDistributions) * 100,
    ) / 100;

  const buffer = await renderBankBalancePdf({
    openingBalance,
    totalPayments,
    totalContributions,
    totalExpenses,
    totalDraws,
    totalReturns,
    totalDistributions,
    closingBalance,
    from: range.from,
    to: range.to,
    settings: getSettings(),
  });
  sendPdf(res, buffer, `bank-balance-${range.from}-to-${range.to}.pdf`);
});

module.exports = router;
