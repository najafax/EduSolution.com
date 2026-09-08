const { Router } = require('express');
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
// `issue_date`. A line item resolves its USD cost by joining to `products`
// on `product_id`; an item with no `product_id` (a manually-typed line) or
// a since-deleted product comes in at $0, same "no live link, so it just
// reads as no cost" precedent routes/deals.js's own invoice-pick
// auto-populate logic already establishes for the identical case — it's
// still counted in `unmatchedItemCount` so the report can say plainly how
// much of what was sold it could actually price.
const router = Router();
router.use(requireAuth);
const view = requirePermission('financials', 'view');
const manage = requirePermission('financials', 'manage');

const round2 = (n) => Math.round(n * 100) / 100;
const MONTHS_BACK = 12;

function soldItemRows() {
  return db
    .prepare(
      `SELECT i.issue_date AS issue_date, ii.quantity AS quantity, ii.product_id AS product_id, p.cost_price AS cost_price
       FROM invoice_items ii
       JOIN invoices i ON i.id = ii.invoice_id
       LEFT JOIN products p ON p.id = ii.product_id
       WHERE i.status != 'void'`,
    )
    .all();
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
  const usdCost = round2(rows.reduce((sum, r) => sum + r.quantity * (r.cost_price || 0), 0));
  const matchedItemCount = rows.filter((r) => r.product_id && r.cost_price !== null).length;
  const unmatchedItemCount = rows.length - matchedItemCount;
  return { usdCost, itemCount: rows.length, matchedItemCount, unmatchedItemCount };
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
    const rows = soldItemRows();
    const { currentYear, yearOf, monthOf } = makeDateHelpers();

    const byMonth = monthKeysTrailing(MONTHS_BACK).map((month) => ({
      month,
      ...summarizeRows(rows.filter((r) => monthOf(r.issue_date) === month)),
    }));

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
  const { month, exchange_rate } = req.body || {};
  if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'month must be in YYYY-MM format' });
  }
  const rateNum = Number(exchange_rate);
  if (!Number.isFinite(rateNum) || rateNum <= 0) {
    return res.status(400).json({ error: 'exchange_rate must be a positive number' });
  }

  const { monthOf } = makeDateHelpers();
  const rows = soldItemRows().filter((r) => monthOf(r.issue_date) === month);
  const { usdCost } = summarizeRows(rows);
  if (!(usdCost > 0)) {
    return res.status(400).json({ error: 'There is no supplier cost to record for that month.' });
  }

  const costMvr = round2(usdCost * rateNum);
  const monthLabel = new Date(`${month}-01T00:00:00`).toLocaleString('default', { month: 'long', year: 'numeric' });
  const today = new Date().toISOString().slice(0, 10);
  const info = db
    .prepare(
      `INSERT INTO expenses (category, description, amount, expense_date, exchange_rate, notes)
       VALUES ('currency exchange', ?, ?, ?, ?, ?)`,
    )
    .run(
      `Supplier cost for ${monthLabel}`,
      costMvr,
      today,
      rateNum,
      `Auto-calculated from ${rows.length} sold line item(s) (${usdCost.toFixed(2)} USD) in ${monthLabel}.`,
    );

  logActivity({
    userName: req.user.name,
    action: 'recorded supplier cost for',
    entityType: 'expense',
    entityId: info.lastInsertRowid,
    entityLabel: `${monthLabel} (${costMvr.toFixed(2)} at rate ${rateNum})`,
  });

  res.status(201).json({ expenseId: info.lastInsertRowid, usdCost, costMvr, month, monthLabel });
});

module.exports = router;
