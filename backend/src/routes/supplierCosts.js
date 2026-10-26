const { Router } = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../lib/activity');
const { replay, position } = require('../lib/usdLedger');
const { businessYear, recentMonthKeys, addDays } = require('../lib/businessDate');

// What the business owes suppliers in USD (how much, month by month), set
// against the USD account (lib/usdLedger.js, routes/usdAccount.js) that pays
// it. Supplier payments are made from that account and are what gets
// expensed; this report only measures the debt and how much is paid.
//
// Automatic, aggregate view of how much USD this business needs to spend on
// suppliers, computed straight from real sold invoice line items × each
// matched product's own `cost_price` (USD) — not a manual per-transaction
// entry tool, and not tied to routes/deals.js's own `deals` table at all
// (which is a one-off internal calculator/shareholder-split tool, see that
// file's own top-of-file note). This is what actually answers "how much do
// I owe suppliers this month/year" without staff having to pick line items
// and total them by hand.
//
// Source is invoices only (not quotes) — a quote is a proposal, not a sale
// — and follows the exact same "issued" convention `routes/invoices.js`'s
// own analytics already use for `amountInvoiced`: every invoice regardless
// of status except `void` and `draft`, keyed by the invoice's own
// `issue_date`. A line item resolves its USD cost primarily by joining to
// `products` on `product_id` — but an item with no `product_id` (most
// commonly a bulk-imported historical invoice: routes/import.js's own
// `processInvoices()` always collapses a document to one synthetic line
// item with no `product_id` at all, see CLAUDE.md's own note on that) or a
// since-deleted product falls back to matching its own `description`
// against a current product's `name` (trimmed, case-insensitive) — the
// same "match by content, not id" precedent `POST /invoices/:id/payments`'s
// own license auto-renewal already established for the identical shape of
// problem (a historical row with no live foreign key to the thing it's
// really about). An item resolving to neither just contributes $0 to
// `usdCost` — there's no separate matched/unmatched tracking surfaced
// anywhere; between the product_id join and the description fallback,
// every item sold going forward is expected to resolve to a real product.
const router = Router();
router.use(requireAuth);
const view = requirePermission('financials', 'view');
const manage = requirePermission('financials', 'manage');

const round2 = (n) => Math.round(n * 100) / 100;
const MONTHS_BACK = 12;

function soldItemRows() {
  return db
    .prepare(
      `SELECT i.issue_date AS issue_date, ii.description AS description, ii.quantity AS quantity, ii.product_id AS product_id, p.cost_price AS cost_price, ii.cost_price AS snapshot_cost
       FROM invoice_items ii
       JOIN invoices i ON i.id = ii.invoice_id
       LEFT JOIN products p ON p.id = ii.product_id
       WHERE i.status NOT IN ('void', 'draft')`,
    )
    .all();
}

// Current products keyed by name (trimmed, lowercased) → cost_price, for
// the description-fallback match above. Built fresh on every request
// (this app's own "fetch every row once, loop in JS" precedent — cheap at
// this app's scale, see routes/expenses.js's own GET /analytics) rather
// than cached, so a product's cost_price edit or a newly-added product is
// reflected immediately. When more than one product shares a name, the
// highest id wins — same "most recently created row wins a duplicate-name
// collision" precedent routes/import.js's own license-matching logic
// already uses for the identical ambiguity.
function productCostByName() {
  const map = new Map();
  const products = db.prepare('SELECT id, name, cost_price FROM products ORDER BY id ASC').all();
  for (const p of products) {
    map.set(p.name.trim().toLowerCase(), p.cost_price);
  }
  return map;
}

// Resolves one row's real USD cost per item — the product_id join's own
// cost_price when that resolved to a real product, else the
// description-fallback match above, else null (genuinely unmatched).
function resolveCostPrice(row, nameMap) {
  // Cost stamped when the invoice was saved wins, so later cost_price edits
  // don't rewrite past months.
  if (row.snapshot_cost > 0) return row.snapshot_cost;
  if (row.product_id && row.cost_price !== null) return row.cost_price;
  const key = (row.description || '').trim().toLowerCase();
  return key && nameMap.has(key) ? nameMap.get(key) : null;
}

function resolvedSoldItemRows() {
  const nameMap = productCostByName();
  return soldItemRows().map((row) => ({ ...row, resolvedCostPrice: resolveCostPrice(row, nameMap) }));
}

// Same yearOf()/monthOf() hardening every other analytics route in this app
// applies (see routes/expenses.js's own note on why `''.slice(0, 4)`
// computing as year 0 is a real, previously-hit bug) — a row with no
// derivable date is simply left out of the byMonth/byYear breakdown rather
// than corrupting the range or throwing.
function makeDateHelpers() {
  const currentYear = businessYear();
  const yearOf = (d) => {
    if (typeof d !== 'string' || d.length < 4) return null;
    const y = Number(d.slice(0, 4));
    return Number.isInteger(y) && y >= 1990 && y <= currentYear + 1 ? y : null;
  };
  const monthOf = (d) => {
    if (typeof d !== 'string' || d.length < 7) return null;
    const y = yearOf(d);
    const m = Number(d.slice(5, 7));
    if (y === null || !Number.isInteger(m) || m < 1 || m > 12) return null;
    return d.slice(0, 7);
  };
  return { currentYear, yearOf, monthOf };
}

const monthKeysTrailing = recentMonthKeys;

function summarizeRows(rows) {
  const usdCost = round2(rows.reduce((sum, r) => sum + r.quantity * (r.resolvedCostPrice || 0), 0));
  return { usdCost, itemCount: rows.length };
}

// What each month's cost is made of, biggest first (by item description).
function linesOf(rows) {
  const map = new Map();
  for (const r of rows) {
    const cost = r.quantity * (r.resolvedCostPrice || 0);
    if (!(cost > 0)) continue;
    const key = (r.description || '').trim() || 'Unnamed item';
    const cur = map.get(key) || { name: key, quantity: 0, usdCost: 0 };
    cur.quantity += r.quantity;
    cur.usdCost += cost;
    map.set(key, cur);
  }
  return [...map.values()].map((l) => ({ ...l, usdCost: round2(l.usdCost) })).sort((a, b) => b.usdCost - a.usdCost);
}

// USD already paid per sold-month: supplier payments from the USD account
// ledger tagged to that month, plus months marked as already paid elsewhere
// (supplier_cost_settlements, no ledger entry created).
function coveredByMonth(ledgerRows) {
  const recorded = new Map();
  for (const r of ledgerRows) {
    if (r.type === 'supplier_payment' && r.supplier_cost_month) {
      recorded.set(r.supplier_cost_month, (recorded.get(r.supplier_cost_month) || 0) + r.usd_amount);
    }
  }
  const settled = new Map();
  for (const r of db.prepare('SELECT month, SUM(usd) AS usd FROM supplier_cost_settlements GROUP BY month').all()) {
    settled.set(r.month, r.usd);
  }
  return { recorded, settled };
}

function lastBuyRate(ledgerRows) {
  const buys = ledgerRows.filter((r) => r.type === 'buy' && r.usd_amount > 0);
  const b = buys[buys.length - 1];
  return b ? b.mvr_amount / b.usd_amount : null;
}

function monthStatus(usdCost, recordedUsd, settledUsd) {
  const remainingUsd = round2(Math.max(usdCost - recordedUsd - settledUsd, 0));
  let status = 'none';
  if (usdCost > 0) status = remainingUsd <= 0.005 ? 'covered' : recordedUsd + settledUsd > 0 ? 'partial' : 'unrecorded';
  return { remainingUsd, status };
}

// GET / — the report itself: a trailing 12-month view (gap months included
// at zero, oldest first — same "don't silently skip a quiet month"
// reasoning every other gap-filled breakdown in this app follows) plus a
// full year-over-year view (earliest sale through the current year, gap
// years included at zero, matching routes/expenses.js's own GET
// /analytics exactly). Wrapped in try/catch for the same "return a proper
// JSON error instead of an unhandled exception" reason that route's own
// GET /analytics is.
router.get('/', view, (req, res) => {
  try {
    const rows = resolvedSoldItemRows();
    const { currentYear, yearOf, monthOf } = makeDateHelpers();

    const ledger = replay().rows;
    const { recorded, settled } = coveredByMonth(ledger);
    const byMonth = monthKeysTrailing(MONTHS_BACK).map((month) => {
      const monthRows = rows.filter((r) => monthOf(r.issue_date) === month);
      const sum = summarizeRows(monthRows);
      const recordedUsd = round2(recorded.get(month) || 0);
      const settledUsd = round2(settled.get(month) || 0);
      return { month, ...sum, recordedUsd, settledUsd, ...monthStatus(sum.usdCost, recordedUsd, settledUsd), lines: linesOf(monthRows) };
    });

    const validYears = rows.map((r) => yearOf(r.issue_date)).filter((y) => y !== null);
    const minYear = validYears.length ? Math.min(currentYear, ...validYears) : currentYear;
    const byYear = [];
    for (let year = currentYear; year >= minYear; year--) {
      byYear.push({ year, ...summarizeRows(rows.filter((r) => yearOf(r.issue_date) === year)) });
    }

    const toPayUsd = round2(byMonth.reduce((sum, m) => sum + m.remainingUsd, 0));
    const usdPos = position(null, ledger);
    res.json({
      byMonth,
      byYear,
      totals: summarizeRows(rows),
      // Last 12 months only: older history usually predates this report and
      // was handled elsewhere, so it shouldn't inflate "still to buy".
      toPayUsd,
      paidUsd: round2(byMonth.reduce((sum, m) => sum + m.recordedUsd + m.settledUsd, 0)),
      usdAccount: { ...usdPos, hasOpening: ledger.some((r) => r.type === 'opening'), lastBuyRate: lastBuyRate(ledger) },
      // Positive = the account covers everything owed; negative = USD still to buy.
      coverUsd: round2(usdPos.balanceUsd - toPayUsd),
    });
  } catch (err) {
    console.error('GET /api/supplier-costs failed:', err);
    res.status(500).json({ error: 'Failed to load the supplier cost report' });
  }
});

// POST /settle — marks (part of) a month's cost as already bought, with no
// expense created (the purchase was recorded elsewhere, e.g. on the
// Expenses page, or predates this report). Lets old months drop out of
// "still to buy" without double-counting an expense.
router.post('/settle', manage, (req, res) => {
  const { month, usd_amount, note } = req.body || {};
  if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'month must be in YYYY-MM format' });
  }
  const { monthOf } = makeDateHelpers();
  const rows = resolvedSoldItemRows().filter((r) => monthOf(r.issue_date) === month);
  const { usdCost } = summarizeRows(rows);
  const { recorded, settled } = coveredByMonth(replay().rows);
  const { remainingUsd } = monthStatus(usdCost, recorded.get(month) || 0, settled.get(month) || 0);
  if (!(remainingUsd > 0)) return res.status(409).json({ error: 'Nothing is left to settle for that month.' });
  const usdNum = usd_amount === undefined || usd_amount === '' || usd_amount === null ? remainingUsd : Number(usd_amount);
  if (!Number.isFinite(usdNum) || usdNum <= 0 || usdNum > remainingUsd + 0.005) {
    return res.status(400).json({ error: `usd_amount must be between 0 and $${remainingUsd.toFixed(2)}` });
  }
  db.prepare('INSERT INTO supplier_cost_settlements (month, usd, note, created_by_name) VALUES (?, ?, ?, ?)').run(
    month,
    round2(usdNum),
    String(note || '').trim(),
    req.user.name,
  );
  logActivity({
    userName: req.user.name,
    action: 'marked supplier cost as already bought for',
    entityType: 'expense',
    entityId: null,
    entityLabel: `${month} ($${usdNum.toFixed(2)})`,
  });
  res.status(201).json({ month, usdSettled: round2(usdNum) });
});

// DELETE /settle/:month — undoes any "already bought" marks for a month.
router.delete('/settle/:month', manage, (req, res) => {
  if (!/^\d{4}-\d{2}$/.test(req.params.month)) return res.status(400).json({ error: 'month must be in YYYY-MM format' });
  const info = db.prepare('DELETE FROM supplier_cost_settlements WHERE month = ?').run(req.params.month);
  res.json({ removed: info.changes });
});

// Reused by lib/cashForecast.js: USD still to buy for the last 12 months of
// sold items, and the rate to value it at (last USD purchase, else the USD
// account's average cost).
router.computeToPay = function computeToPay() {
  const rows = resolvedSoldItemRows();
  const { monthOf } = makeDateHelpers();
  const ledger = replay().rows;
  const { recorded, settled } = coveredByMonth(ledger);
  let toPayUsd = 0;
  for (const month of monthKeysTrailing(MONTHS_BACK)) {
    const sum = summarizeRows(rows.filter((r) => monthOf(r.issue_date) === month));
    toPayUsd += monthStatus(sum.usdCost, recorded.get(month) || 0, settled.get(month) || 0).remainingUsd;
  }
  const pos = position(null, ledger);
  return { toPayUsd: round2(toPayUsd), rate: lastBuyRate(ledger) || pos.avgRate || null };
};

// Reused by lib/cashForecast.js: how many USD of supplier cost each MVR of
// invoiced revenue has carried over the last 12 months (all sent/paid items,
// including ones with no cost, so a mixed catalogue is not overstated).
// Used to estimate the supplier cost of income that is not invoiced yet.
router.computeCostShare = function computeCostShare(today) {
  const nameMap = productCostByName();
  const since = addDays(today, -365);
  const rows = db
    .prepare(
      `SELECT i.issue_date AS issue_date, ii.description AS description, ii.quantity AS quantity, ii.amount AS amount,
              ii.product_id AS product_id, p.cost_price AS cost_price, ii.cost_price AS snapshot_cost
         FROM invoice_items ii
         JOIN invoices i ON i.id = ii.invoice_id
         LEFT JOIN products p ON p.id = ii.product_id
        WHERE i.status NOT IN ('void', 'draft') AND i.issue_date > ? AND i.issue_date <= ?`
    )
    .all(since, today);
  let revenue = 0;
  let costUsd = 0;
  for (const r of rows) {
    revenue += r.amount || 0;
    costUsd += r.quantity * (resolveCostPrice(r, nameMap) || 0);
  }
  return { usdPerMvr: revenue > 0 ? costUsd / revenue : 0, revenue: round2(revenue), costUsd: round2(costUsd) };
};

module.exports = router;
