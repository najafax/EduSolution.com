const { Router } = require('express');
const usdLedger = require('../lib/usdLedger');
const { todayStr, recentMonthKeys } = require('../lib/businessDate');
const { booksStart } = require('../lib/booksStart');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = Router();
router.use(requireAuth);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const today = () => todayStr();
const monthKey = (dateStr) => dateStr.slice(0, 7); // 'YYYY-MM'

const recentMonths = recentMonthKeys;

// Every figure behind the bank balance: the opening balance plus everything
// dated from `sinceDate` through `asOf` ('0000-00-00' = no lower cutoff).
// Also used to calibrate the opening balance to a known real balance.
function bankFlows(startingBalance, sinceDate, asOf, ledgerRows) {
  const sum = (table, col, extra = '') =>
    db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM ${table} WHERE ${col} >= ? AND ${col} <= ?${extra}`).get(sinceDate, asOf).total;
  const paymentsIn = sum('payments', 'paid_at');
  const contributions = sum('capital_contributions', 'contribution_date');
  const expenses = sum('expenses', 'expense_date');
  const draws = sum('owner_draws', 'draw_date', " AND type = 'draw'");
  const returns = sum('owner_draws', 'draw_date', " AND type = 'return'");
  const distributions = sum('owner_draws', 'draw_date', " AND type = 'profit_distribution'");
  let usdBuys = 0;
  let usdSells = 0;
  for (const r of ledgerRows) {
    if (r.txn_date < sinceDate || r.txn_date > asOf) continue;
    if (r.type === 'buy') usdBuys += r.mvr_amount;
    else if (r.type === 'sell') usdSells += r.mvr_amount;
  }
  const r2 = (n) => Math.round(n * 100) / 100;
  const total = r2(startingBalance + paymentsIn + contributions + returns + usdSells - expenses - draws - distributions - usdBuys);
  return {
    startingBalance: r2(startingBalance),
    sinceDate: sinceDate === '0000-00-00' ? '' : sinceDate,
    asOf,
    paymentsIn: r2(paymentsIn),
    contributions: r2(contributions),
    returns: r2(returns),
    usdSells: r2(usdSells),
    expenses: r2(expenses),
    draws: r2(draws),
    distributions: r2(distributions),
    usdBuys: r2(usdBuys),
    total,
  };
}

// The whole GET /summary computation, pulled out into a plain function so
// routes/dashboard.js's combined overview endpoint can call it in-process
// (a direct function call, not a second HTTP round-trip) rather than
// duplicating this financially-sensitive logic — bank balance, cash-basis
// net profit, etc. — a second time. `from`/`to` are both optional exactly
// as they are on the route below.
function computeSummary(from, to) {
  // Nothing before the books start date counts: an open-ended or earlier range starts there.
  const start = booksStart();
  if (!(DATE_RE.test(from || '') && DATE_RE.test(to || '') && from <= to)) { from = start; to = today(); }
  else if (from < start) from = start;
  if (from > to) to = from;
  const filtered = DATE_RE.test(from || '') && DATE_RE.test(to || '') && from <= to;
  const dateFilter = filtered ? ' AND issue_date BETWEEN ? AND ?' : '';
  const dateArgs = filtered ? [from, to] : [];

  const invoices = db.prepare(`SELECT * FROM invoices WHERE status NOT IN ('void', 'draft')${dateFilter}`).all(...dateArgs);

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
  // Net profit is cash-basis — payments actually RECEIVED in the period,
  // minus expenses RECORDED in the period — deliberately NOT totalPaid
  // above, which is accrual (each filtered-by-issue_date invoice's own
  // running amount_paid). The two sums are identical in the unfiltered/
  // all-time case (every dollar in amount_paid traces back to exactly one
  // payment row, and neither sum is date-restricted then), which is why
  // this drifted apart unnoticed until a real period filter existed: an
  // invoice issued last year but paid this year contributes to this
  // year's cash revenue (payments.paid_at) but not to this year's accrual
  // totalPaid (its issue_date falls outside the range) — netProfit here
  // used to read totalPaid, so it silently missed that payment while
  // routes/reports.js's own GET /profit-loss/pdf (which has always been
  // cash-basis) counted it, producing two different "Net profit" figures
  // for what a user reasonably expects to be the same number over the
  // same range. cashRevenue mirrors that PDF's own `revenueTotal` query
  // exactly, so the two now always agree.
  const paymentDateFilterForRevenue = filtered ? ' AND paid_at BETWEEN ? AND ?' : '';
  const cashRevenue = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE 1=1${paymentDateFilterForRevenue}`).get(...dateArgs).total;
  // Deliberately excluded from netProfit: a capital contribution is an
  // owner/partner putting personal money into the business, not the
  // business earning it — folding it in would make "net profit" claim the
  // business was more profitable than it actually was. It still belongs in
  // bankBalance below, since that cash really did land in the account.
  // Supplier costs (USD paid to suppliers, at the USD account's average cost)
  // and realised FX gain/loss on converting USD back to MVR are P&L items
  // too; buying USD itself is not (it just swaps MVR for USD).
  const ledgerRows = usdLedger.replay().rows;
  const supplierCosts = usdLedger.supplierCostMvr(filtered ? from : null, filtered ? to : null, ledgerRows);
  const fxResult = usdLedger.fxResultMvr(filtered ? from : null, filtered ? to : null, ledgerRows);
  const netProfit = Math.round((cashRevenue - totalExpenses - supplierCosts + fxResult) * 100) / 100;

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
  // A profit distribution (routes/deals.js's own distributeDeal(), type =
  // 'profit_distribution') is a one-way payout of a deal's net profit —
  // never expected back the way a real draw is, so it's deliberately kept
  // out of totalOwnerDraws above (that figure, and everything
  // routes/ownerDraws.js itself shows, means "what's outstanding and could
  // still be returned"). It still needs its own place in bankBalance below
  // though — the cash really did leave the business — so it gets a
  // separate total rather than silently folding into either figure above.
  const totalOwnerDistributions = db
    .prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM owner_draws WHERE type = 'profit_distribution'${drawDateFilter}`)
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
  const openingRow = db.prepare('SELECT starting_balance, starting_balance_date FROM business_settings WHERE id = 1').get() || {};
  const startingBalance = openingRow.starting_balance || 0;
  // Only transactions on/after the starting-balance date count; with no such date
  // set, the books start date is the cutoff (the starting balance is then the balance at that date).
  const sinceDate = openingRow.starting_balance_date || start;
  const bank = bankFlows(startingBalance, sinceDate, asOf, ledgerRows);
  const bankBalance = bank.total;
  const usdPosition = usdLedger.position(asOf, ledgerRows);

  // Deliberately NOT scoped to the period filter — this widget is titled
  // "Revenue, last 6 months" on Financials.jsx, a fixed trailing window
  // independent of whatever period the KPI cards above it are showing, so
  // it always reflects the 6 months trailing from today regardless of
  // which filter tab is selected.
  const months = recentMonths(6);
  const invoicedByMonth = Object.fromEntries(months.map((m) => [m, 0]));
  const allInvoices = filtered ? db.prepare("SELECT * FROM invoices WHERE status NOT IN ('void', 'draft')").all() : invoices;
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

  return {
    totalInvoiced: Math.round(totalInvoiced * 100) / 100,
    totalPaid: Math.round(totalPaid * 100) / 100,
    totalOutstanding,
    overdueCount: overdue.length,
    overdueAmount,
    invoiceCount: invoices.length,
    clientCount,
    totalExpenses: Math.round(totalExpenses * 100) / 100,
    supplierCosts,
    fxResult,
    usdBalance: usdPosition.balanceUsd,
    usdBookValueMvr: usdPosition.bookValueMvr,
    usdAvgRate: usdPosition.avgRate,
    netProfit,
    // The cash-basis revenue netProfit above is actually derived from
    // (see the comment there) — returned so the frontend's own margin %
    // divides by the same figure netProfit was computed from, rather than
    // the accrual totalPaid above, which would produce a margin that
    // doesn't reconcile with netProfit for a filtered period.
    cashRevenue: Math.round(cashRevenue * 100) / 100,
    totalCapitalContributions: Math.round(totalCapitalContributions * 100) / 100,
    totalOwnerDraws: Math.round(totalOwnerDraws * 100) / 100,
    totalOwnerReturns: Math.round(totalOwnerReturns * 100) / 100,
    totalOwnerDistributions: Math.round(totalOwnerDistributions * 100) / 100,
    bankBalance,
    bankBreakdown: bank,
    bankBalanceAsOf: asOf,
    startingBalanceDate: openingRow.starting_balance_date || '',
    booksStart: start,
    quoteCounts,
    invoiceCounts,
    monthlyTrend,
    recentPayments,
  };
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
  res.json(computeSummary(from, to));
});

// Expected cash in/out over the next 30/60/90 days (see lib/cashForecast.js).
function cashForecast() {
  const { computeCashForecast } = require('../lib/cashForecast');
  return computeCashForecast({ openingBalance: computeSummary().bankBalance });
}
router.cashForecast = cashForecast;

router.get('/cash-forecast', requirePermission('financials', 'view'), (req, res) => {
  try {
    res.json(cashForecast());
  } catch (err) {
    console.error('GET /api/financials/cash-forecast failed:', err);
    res.status(500).json({ error: 'Failed to build the cash forecast' });
  }
});

// Set the bank balance to a known real figure: the opening balance is
// recomputed so that the balance at the end of `as_of` (default today) is
// exactly `actual_balance`. Everything dated after it then adds on as usual;
// anything before `as_of` stops counting toward the bank balance (profit
// figures are unaffected).
router.post('/bank-balance/calibrate', requirePermission('financials', 'manage'), (req, res) => {
  const actual = Number(req.body && req.body.actual_balance);
  if (!Number.isFinite(actual)) return res.status(400).json({ error: 'actual_balance must be a number' });
  const asOf = (req.body && req.body.as_of) || today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || asOf > today()) return res.status(400).json({ error: 'as_of must be a valid date, not in the future' });
  const ledgerRows = usdLedger.replay().rows;
  const flows = bankFlows(0, asOf, asOf, ledgerRows); // activity on that day itself, without any opening balance
  const starting = Math.round((actual - flows.total) * 100) / 100;
  db.prepare('UPDATE business_settings SET starting_balance = ?, starting_balance_date = ? WHERE id = 1').run(starting, asOf);
  res.json({ ok: true, startingBalance: starting, startingBalanceDate: asOf, bankBalance: computeSummary().bankBalance });
});

module.exports = router;
module.exports.computeSummary = computeSummary;
