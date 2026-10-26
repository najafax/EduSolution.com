// "Expected cash in the next 30/60/90 days". A projection from data the app
// already holds, not a promise:
//   in : sent invoices with a balance (by due date), recurring invoices about
//        to be generated (due date = run date + due_in_days), licence renewals
//        not already on a sent invoice
//   out: USD still owed to suppliers (valued at the latest buy rate) due now,
//        an estimate of supplier cost on income not yet invoiced (recurring
//        invoices and licence renewals, at the last 12 months' cost share),
//        plus a typical month of expenses (average of the last 90 days)
// Overdue invoices are reported separately and NOT counted as scheduled cash
// in, because when (or whether) they pay is unknowable.
const db = require('./../db');
const { todayStr, addDays, addMonths, addYears } = require('./businessDate');
const { computeTotals } = require('./totals');

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const HORIZONS = [30, 60, 90];

function bucketOf(date, today) {
  for (let i = 0; i < HORIZONS.length; i++) {
    if (date <= addDays(today, HORIZONS[i])) return i;
  }
  return -1; // beyond 90 days
}

function computeCashForecast({ openingBalance = 0, today = todayStr() } = {}) {
  const buckets = HORIZONS.map((days) => ({
    days,
    invoicesIn: 0,
    recurringIn: 0,
    licensesIn: 0,
    supplierOut: 0,
    supplierEstOut: 0,
    expensesOut: 0,
  }));
  const add = (date, key, amount) => {
    if (!(amount > 0)) return;
    const i = bucketOf(date < today ? today : date, today);
    if (i >= 0) buckets[i][key] += amount;
  };

  // Unpaid sent invoices.
  let overdueAmount = 0;
  let overdueCount = 0;
  const inv = db
    .prepare("SELECT total - amount_paid AS balance, due_date FROM invoices WHERE status = 'sent' AND total - amount_paid > 0.005")
    .all();
  for (const r of inv) {
    if (r.due_date < today) {
      overdueAmount += r.balance;
      overdueCount += 1;
    } else add(r.due_date, 'invoicesIn', r.balance);
  }

  // Recurring invoices still to be generated inside the horizon (every
  // occurrence, not just the next).
  const horizonEnd = addDays(today, 90);
  const recs = db.prepare("SELECT * FROM recurring_invoices WHERE active = 1").all();
  const itemStmt = db.prepare('SELECT description, quantity, unit_price FROM recurring_invoice_items WHERE recurring_invoice_id = ? ORDER BY sort_order');
  for (const r of recs) {
    let total = 0;
    try {
      total = computeTotals(itemStmt.all(r.id), r.tax_rate, r.discount_type, r.discount_value).total;
    } catch {
      continue;
    }
    let run = r.next_run_date < today ? today : r.next_run_date;
    for (let guard = 0; guard < 200 && addDays(run, r.due_in_days) <= horizonEnd; guard++) {
      add(addDays(run, r.due_in_days), 'recurringIn', total);
      run = r.frequency === 'weekly' ? addDays(run, 7) : r.frequency === 'yearly' ? addYears(run, 1) : addMonths(run, 1);
    }
  }

  // Licence renewals due in the window. Skip a licence whose current cycle
  // already has a sent invoice (that balance is counted above); a draft
  // renewal invoice does not count as cash in, so the licence still does.
  const lic = db
    .prepare(
      `SELECT l.id, l.amount, l.expiry_date, l.billing_cycle, i.status AS inv_status
         FROM licenses l LEFT JOIN invoices i ON i.id = l.renewal_invoice_id AND l.renewal_invoice_for = l.expiry_date
        WHERE l.status = 'active' AND l.amount > 0 AND l.expiry_date >= ? AND l.expiry_date <= ?`
    )
    .all(today, horizonEnd);
  for (const l of lic) {
    if (l.inv_status === 'sent' || l.inv_status === 'paid') continue;
    let d = l.expiry_date;
    for (let guard = 0; guard < 100 && d <= horizonEnd; guard++) {
      add(d, 'licensesIn', l.amount);
      d = l.billing_cycle === 'yearly' ? addYears(d, 1) : addMonths(d, 1);
    }
  }

  // Supplier costs owed (USD) at the latest buy rate, treated as due now.
  const { toPayUsd, rate } = require('../routes/supplierCosts').computeToPay();
  const supplierMvr = rate ? toPayUsd * rate : 0;
  buckets[0].supplierOut += supplierMvr;

  // Supplier cost we expect on income that has not been invoiced yet, in the
  // same bucket as that income. Invoiced items are already in supplierOut.
  const share = require('../routes/supplierCosts').computeCostShare(today);
  const costShare = rate ? share.usdPerMvr * rate : 0; // MVR of cost per MVR of income
  for (const b of buckets) b.supplierEstOut += (b.recurringIn + b.licensesIn) * costShare;

  // A typical month of recorded expenses (last 90 days / 3), every 30 days.
  const spent = db
    .prepare('SELECT COALESCE(SUM(amount), 0) AS t FROM expenses WHERE expense_date > ? AND expense_date <= ?')
    .get(addDays(today, -90), today).t;
  const typicalMonth = spent / 3;
  buckets.forEach((b) => (b.expensesOut += typicalMonth));

  let running = openingBalance;
  const out = buckets.map((b) => {
    const cashIn = b.invoicesIn + b.recurringIn + b.licensesIn;
    const cashOut = b.supplierOut + b.supplierEstOut + b.expensesOut;
    running += cashIn - cashOut;
    return {
      days: b.days,
      invoicesIn: round2(b.invoicesIn),
      recurringIn: round2(b.recurringIn),
      licensesIn: round2(b.licensesIn),
      supplierOut: round2(b.supplierOut),
      supplierEstOut: round2(b.supplierEstOut),
      expensesOut: round2(b.expensesOut),
      cashIn: round2(cashIn),
      cashOut: round2(cashOut),
      net: round2(cashIn - cashOut),
      projectedBalance: round2(running),
    };
  });

  return {
    asOf: today,
    openingBalance: round2(openingBalance),
    buckets: out,
    overdue: { amount: round2(overdueAmount), count: overdueCount },
    supplier: { toPayUsd, rate: rate ? round2(rate * 10000) / 10000 : null, estimateSharePct: round2(costShare * 100) },
    typicalMonthlyExpenses: round2(typicalMonth),
    lowestBalance: round2(Math.min(openingBalance, ...out.map((b) => b.projectedBalance))),
  };
}

module.exports = { computeCashForecast };
