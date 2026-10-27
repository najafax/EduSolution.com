const { Router } = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../lib/activity');
const { replay, position } = require('../lib/usdLedger');
const { todayStr, addDays } = require('../lib/businessDate');
const { isValidDate } = require('../lib/validate');

// USD owed to suppliers, built on supplier invoices (routes/supplierInvoices.js).
// Three buckets:
//   to pay     supplier invoices received and not yet paid (exact, paid in full)
//   awaiting   client invoices sold since `supplier_track_from` whose supplier
//              cost is not yet covered by linked supplier invoices (estimate
//              from product cost prices; "no supplier invoice needed" hides one)
//   paid       supplier invoices paid (history lives on the list)
// Set against the USD account (lib/usdLedger.js) that pays them.
const router = Router();
router.use(requireAuth);
const view = requirePermission('financials', 'view');
const manage = requirePermission('financials', 'manage');

const round2 = (n) => Math.round(n * 100) / 100;

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

function lastBuyRate(ledgerRows) {
  const buys = ledgerRows.filter((r) => r.type === 'buy' && r.usd_amount > 0);
  const b = buys[buys.length - 1];
  return b ? b.mvr_amount / b.usd_amount : null;
}

function trackFrom() {
  const row = db.prepare('SELECT supplier_track_from AS d FROM business_settings WHERE id = 1').get();
  // Not set yet (fresh install): only this month's sales count.
  return (row && row.d) || `${todayStr().slice(0, 7)}-01`;
}

// Estimated USD supplier cost per client invoice, from item cost prices, for
// the invoices matched by `whereSql` (over `invoices i`).
function estimatedByInvoice(whereSql, params) {
  const nameMap = productCostByName();
  const items = db
    .prepare(
      `SELECT i.id AS invoice_id, i.number, i.issue_date, c.name AS client_name,
              ii.description AS description, ii.quantity AS quantity, ii.product_id AS product_id,
              p.cost_price AS cost_price, ii.cost_price AS snapshot_cost
         FROM invoice_items ii
         JOIN invoices i ON i.id = ii.invoice_id
         LEFT JOIN clients c ON c.id = i.client_id
         LEFT JOIN products p ON p.id = ii.product_id
        WHERE ${whereSql}`,
    )
    .all(...params);
  const byInvoice = new Map();
  for (const r of items) {
    const cost = r.quantity * (resolveCostPrice(r, nameMap) || 0);
    if (!(cost > 0)) continue;
    const cur = byInvoice.get(r.invoice_id) || { invoice_id: r.invoice_id, number: r.number, issue_date: r.issue_date, client_name: r.client_name, estimatedUsd: 0 };
    cur.estimatedUsd += cost;
    byInvoice.set(r.invoice_id, cur);
  }
  return byInvoice;
}
router.estimatedByInvoice = estimatedByInvoice;

// Client invoices (sent/paid, issued on/after the tracking date, not marked
// "no supplier invoice needed") whose estimated USD cost is not yet covered
// by linked supplier invoices.
function computeAwaiting() {
  const from = trackFrom();
  const byInvoice = estimatedByInvoice("i.status IN ('sent', 'paid') AND i.supplier_cost_done = 0 AND i.issue_date >= ?", [from || '0000-00-00']);
  const linked = new Map(
    db.prepare('SELECT invoice_id, SUM(usd_amount) AS t FROM supplier_invoice_links GROUP BY invoice_id').all().map((r) => [r.invoice_id, r.t]),
  );
  const list = [];
  for (const inv of byInvoice.values()) {
    const linkedUsd = linked.get(inv.invoice_id) || 0;
    const remainingUsd = round2(inv.estimatedUsd - linkedUsd);
    if (remainingUsd > 0.005) list.push({ ...inv, estimatedUsd: round2(inv.estimatedUsd), linkedUsd: round2(linkedUsd), remainingUsd });
  }
  list.sort((a, b) => a.issue_date.localeCompare(b.issue_date) || a.invoice_id - b.invoice_id);
  return list;
}

// GET /profit?from=&to=&invoice= — real profit per sale (lib/saleProfit.js).
router.get('/profit', view, (req, res) => {
  try {
    const { from, to, invoice } = req.query;
    if (from && !isValidDate(from)) return res.status(400).json({ error: 'from must be a valid date' });
    if (to && !isValidDate(to)) return res.status(400).json({ error: 'to must be a valid date' });
    res.json(require('../lib/saleProfit').computeSaleProfits({ from, to, invoiceId: invoice ? Number(invoice) : null }));
  } catch (err) {
    console.error('GET /api/supplier-costs/profit failed:', err);
    res.status(500).json({ error: 'Failed to load profit per sale' });
  }
});

// GET / — everything the USD & suppliers page needs in one call.
router.get('/', view, (req, res) => {
  try {
    const today = todayStr();
    const ledger = replay().rows;
    const usdPos = position(null, ledger);
    const unpaid = db.prepare("SELECT usd_amount, due_date FROM supplier_invoices WHERE status = 'unpaid'").all();
    const toPayUsd = round2(unpaid.reduce((s, r) => s + r.usd_amount, 0));
    const overdueUsd = round2(unpaid.filter((r) => r.due_date && r.due_date < today).reduce((s, r) => s + r.usd_amount, 0));
    const awaiting = computeAwaiting();
    const awaitingUsd = round2(awaiting.reduce((s, a) => s + a.remainingUsd, 0));
    const rate = lastBuyRate(ledger) || usdPos.avgRate || null;
    const year = today.slice(0, 4);
    const paidThisYear = db
      .prepare("SELECT COALESCE(SUM(usd_amount), 0) AS t, COUNT(*) AS n FROM supplier_invoices WHERE status = 'paid' AND paid_at >= ?")
      .get(`${year}-01-01`);
    const coverUsd = round2(usdPos.balanceUsd - toPayUsd);
    res.json({
      usdAccount: { ...usdPos, hasOpening: ledger.some((r) => r.type === 'opening'), lastBuyRate: lastBuyRate(ledger) },
      toPayUsd,
      toPayCount: unpaid.length,
      overdueUsd,
      awaitingUsd,
      awaiting,
      paidThisYearUsd: round2(paidThisYear.t),
      paidThisYearCount: paidThisYear.n,
      // Positive = the account covers every unpaid supplier invoice; negative = USD still to buy.
      coverUsd,
      shortfallUsd: coverUsd < 0 ? round2(-coverUsd) : 0,
      shortfallMvr: coverUsd < 0 && rate ? round2(-coverUsd * rate) : null,
      rate: rate ? round2(rate * 10000) / 10000 : null,
      trackFrom: trackFrom(),
    });
  } catch (err) {
    console.error('GET /api/supplier-costs failed:', err);
    res.status(500).json({ error: 'Failed to load the supplier overview' });
  }
});

// PUT /track-from — sales before this date are not expected to produce a
// supplier invoice we are still waiting for.
router.put('/track-from', manage, (req, res) => {
  const d = req.body && req.body.track_from;
  if (!isValidDate(d)) return res.status(400).json({ error: 'Choose a valid date' });
  db.prepare('UPDATE business_settings SET supplier_track_from = ? WHERE id = 1').run(d);
  logActivity({ userName: req.user.name, action: 'set supplier-invoice tracking start to', entityType: 'supplier_invoice', entityId: null, entityLabel: d });
  res.json({ trackFrom: d });
});

// POST /awaiting/:invoiceId/done — "no supplier invoice needed" for this sale
// (or bring it back with { done: false }).
router.post('/awaiting/:invoiceId/done', manage, (req, res) => {
  const inv = db.prepare('SELECT id, number FROM invoices WHERE id = ?').get(req.params.invoiceId);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  const done = req.body && req.body.done === false ? 0 : 1;
  db.prepare('UPDATE invoices SET supplier_cost_done = ? WHERE id = ?').run(done, inv.id);
  logActivity({
    userName: req.user.name,
    action: done ? 'marked no supplier invoice needed for' : 'is waiting for a supplier invoice for',
    entityType: 'invoice',
    entityId: inv.id,
    entityLabel: inv.number,
  });
  res.json({ ok: true });
});

// Reused by lib/cashForecast.js: USD still to pay suppliers. `invoiced` is
// the exact total of unpaid supplier invoices with their due dates; `awaiting`
// is the estimate for sales whose supplier invoice has not arrived yet. The
// rate is the latest USD purchase, else the USD account's average cost.
router.computeToPay = function computeToPay() {
  const ledger = replay().rows;
  const pos = position(null, ledger);
  const invoiced = db.prepare("SELECT usd_amount, due_date FROM supplier_invoices WHERE status = 'unpaid'").all();
  const awaitingUsd = round2(computeAwaiting().reduce((s, a) => s + a.remainingUsd, 0));
  const invoicedUsd = round2(invoiced.reduce((s, r) => s + r.usd_amount, 0));
  return { toPayUsd: round2(invoicedUsd + awaitingUsd), invoicedUsd, awaitingUsd, invoiced, rate: lastBuyRate(ledger) || pos.avgRate || null };
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
