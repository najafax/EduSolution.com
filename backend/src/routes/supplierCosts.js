const { Router } = require('express');
const { todayStr } = require('../lib/businessDate');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../lib/activity');

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
// of status except `void` (draft included — see that route's own
// `issuedThisYear`/`amountInvoiced` split), keyed by the invoice's own
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
  const currentYear = new Date().getFullYear();
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

function monthKeysTrailing(count) {
  const now = new Date();
  const keys = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
}

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

// USD already covered per sold-month: purchases recorded from this report
// (expenses tagged with supplier_cost_month) plus months marked as already
// bought elsewhere (supplier_cost_settlements, no expense created).
function coveredByMonth() {
  const recorded = new Map();
  for (const r of db
    .prepare("SELECT supplier_cost_month AS month, SUM(supplier_cost_usd) AS usd FROM expenses WHERE supplier_cost_month != '' GROUP BY supplier_cost_month")
    .all()) {
    recorded.set(r.month, r.usd);
  }
  const settled = new Map();
  for (const r of db.prepare('SELECT month, SUM(usd) AS usd FROM supplier_cost_settlements GROUP BY month').all()) {
    settled.set(r.month, r.usd);
  }
  return { recorded, settled };
}

function lastExchangeRate() {
  const r = db
    .prepare("SELECT exchange_rate FROM expenses WHERE category = 'currency exchange' AND exchange_rate > 0 ORDER BY expense_date DESC, id DESC LIMIT 1")
    .get();
  return r ? r.exchange_rate : null;
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

    const { recorded, settled } = coveredByMonth();
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

    res.json({
      byMonth,
      byYear,
      totals: summarizeRows(rows),
      // Last 12 months only: older history usually predates this report and
      // was handled elsewhere, so it shouldn't inflate "still to buy".
      toBuyUsd: round2(byMonth.reduce((sum, m) => sum + m.remainingUsd, 0)),
      recordedUsd: round2(byMonth.reduce((sum, m) => sum + m.recordedUsd + m.settledUsd, 0)),
      lastRate: lastExchangeRate(),
    });
  } catch (err) {
    console.error('GET /api/supplier-costs failed:', err);
    res.status(500).json({ error: 'Failed to load the supplier cost report' });
  }
});

// POST /record — the "Record as expense" action: recomputes the given
// month's USD cost fresh, server-side (never trusts a client-submitted
// total), and writes it as a real `category: 'currency exchange'` expense
// on the existing Expenses page at the given rate — the one, single place
// a real currency-exchange purchase is recorded in this app (see
// routes/deals.js's own top-of-file note on why this replaced a
// deal-scoped conversion mechanism). No dedicated "already recorded this
// month" tracking — a business can record the same month's figure more
// than once if they choose to (e.g. a partial purchase now, the rest
// later); if that turns out to be a mistake, it's the same one-off manual
// correction any other wrong expense entry already gets on the Expenses
// page, not something this route needs to guard against.
router.post('/record', manage, (req, res) => {
  const { month, exchange_rate, usd_amount, expense_date } = req.body || {};
  if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'month must be in YYYY-MM format' });
  }
  const rateNum = Number(exchange_rate);
  if (!Number.isFinite(rateNum) || rateNum <= 0) {
    return res.status(400).json({ error: 'exchange_rate must be a positive number' });
  }
  const dateStr = expense_date ? String(expense_date) : todayStr();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || Number.isNaN(Date.parse(dateStr))) {
    return res.status(400).json({ error: 'expense_date must be a valid date (YYYY-MM-DD)' });
  }

  const { monthOf } = makeDateHelpers();
  const rows = resolvedSoldItemRows().filter((r) => monthOf(r.issue_date) === month);
  const { usdCost } = summarizeRows(rows);
  const { recorded, settled } = coveredByMonth();
  const { remainingUsd } = monthStatus(usdCost, recorded.get(month) || 0, settled.get(month) || 0);
  if (!(usdCost > 0)) {
    return res.status(400).json({ error: 'There is no supplier cost to record for that month.' });
  }
  if (!(remainingUsd > 0)) {
    return res.status(409).json({ error: 'That month is already fully recorded.' });
  }
  // Default to everything still outstanding; allow a smaller partial purchase.
  const usdNum = usd_amount === undefined || usd_amount === '' || usd_amount === null ? remainingUsd : Number(usd_amount);
  if (!Number.isFinite(usdNum) || usdNum <= 0) {
    return res.status(400).json({ error: 'usd_amount must be a positive number' });
  }
  if (usdNum > remainingUsd + 0.005) {
    return res.status(400).json({ error: `Only $${remainingUsd.toFixed(2)} is still left to record for that month.` });
  }

  const costMvr = round2(usdNum * rateNum);
  const monthLabel = new Date(`${month}-01T00:00:00`).toLocaleString('default', { month: 'long', year: 'numeric' });
  const partial = usdNum < remainingUsd - 0.005;
  const info = db
    .prepare(
      `INSERT INTO expenses (category, description, amount, expense_date, exchange_rate, notes, supplier_cost_month, supplier_cost_usd)
       VALUES ('currency exchange', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      `Supplier cost for ${monthLabel}${partial ? ' (partial)' : ''}`,
      costMvr,
      dateStr,
      rateNum,
      `Supplier cost for ${monthLabel}: $${usdNum.toFixed(2)} USD of $${usdCost.toFixed(2)} owed, from ${rows.length} sold line item(s).`,
      month,
      round2(usdNum),
    );

  logActivity({
    userName: req.user.name,
    action: 'recorded supplier cost for',
    entityType: 'expense',
    entityId: info.lastInsertRowid,
    entityLabel: `${monthLabel} ($${usdNum.toFixed(2)} at rate ${rateNum} = ${costMvr.toFixed(2)})`,
  });

  res.status(201).json({ expenseId: info.lastInsertRowid, usdCost, usdRecorded: round2(usdNum), costMvr, month, monthLabel });
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
  const { recorded, settled } = coveredByMonth();
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

module.exports = router;
