const { Router } = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../lib/activity');

// Internal profit-distribution calculator — never surfaced to a client, not
// even when a deal links back to a real invoice (see db/index.js's own
// CREATE TABLE comment for the full reasoning). A deal computes:
//   net profit (MVR) = revenue_amount - (Σ item.cost_price × qty, in USD) × exchange_rate
// and, once distributed, splits that net profit among active shareholders
// by their own `ownership_percent`. A draft deal is purely a calculator —
// no expense or owner_draws row exists until POST /:id/distribute commits
// it, at which point both are written for real so routes/financials.js's
// existing bankBalance/netProfit math already accounts for them correctly.
// Gated on 'financials', same as Capital contributions/Owner draws/
// Shareholders/Reports — this is exactly that level of sensitive cash data,
// not a reason to declare a new MODULES entry of its own.
const router = Router();
router.use(requireAuth);
const view = requirePermission('financials', 'view');
const manage = requirePermission('financials', 'manage');

const PAGE_SIZE = 20;
const round2 = (n) => Math.round(n * 100) / 100;

function itemsForDeal(dealId) {
  return db.prepare('SELECT * FROM deal_items WHERE deal_id = ? ORDER BY sort_order, id').all(dealId);
}

// Don't-store-what-you-can-compute, same approach invoices.js's
// withComputed() takes for is_overdue — cost/net profit are always derived
// fresh from the deal's own row + its current items rather than a stored
// running total that could drift.
function withComputedDeal(deal) {
  const items = itemsForDeal(deal.id);
  const costUsdTotal = round2(items.reduce((sum, item) => sum + item.quantity * item.cost_price, 0));
  const costMvr = deal.exchange_rate ? round2(costUsdTotal * deal.exchange_rate) : 0;
  const netProfit = round2(deal.revenue_amount - costMvr);
  return { ...deal, items, cost_usd_total: costUsdTotal, cost_mvr: costMvr, net_profit: netProfit };
}

function saveDealItems(dealId, items) {
  db.prepare('DELETE FROM deal_items WHERE deal_id = ?').run(dealId);
  const insert = db.prepare(
    'INSERT INTO deal_items (deal_id, product_id, description, quantity, cost_price, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
  );
  items.forEach((item, index) => {
    insert.run(dealId, item.product_id ?? null, item.description.trim(), Number(item.quantity), Number(item.cost_price), index);
  });
}

function validate(body) {
  const { description, revenue_amount, exchange_rate, items } = body || {};
  if (!description || !description.trim()) return 'description is required';
  const revenueNum = Number(revenue_amount);
  if (!Number.isFinite(revenueNum) || revenueNum < 0) return 'revenue_amount must be a non-negative number';
  if (exchange_rate !== undefined && exchange_rate !== null && exchange_rate !== '') {
    const rateNum = Number(exchange_rate);
    if (!Number.isFinite(rateNum) || rateNum <= 0) return 'exchange_rate must be a positive number';
  }
  if (items !== undefined) {
    if (!Array.isArray(items)) return 'items must be an array';
    for (const item of items) {
      if (!item.description || !String(item.description).trim()) return 'Each cost item needs a description';
      const qty = Number(item.quantity);
      if (!Number.isFinite(qty) || qty <= 0) return 'Each cost item quantity must be a positive number';
      const cost = Number(item.cost_price);
      if (!Number.isFinite(cost) || cost < 0) return 'Each cost item cost price must be a non-negative number';
    }
  }
  return null;
}

router.get('/', view, (req, res) => {
  const { q, status, page: pageParam } = req.query;
  const conditions = [];
  const params = [];
  if (q) {
    conditions.push('description LIKE ?');
    params.push(`%${q}%`);
  }
  if (status && ['draft', 'distributed'].includes(status)) {
    conditions.push('status = ?');
    params.push(status);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const orderBy = 'created_at DESC, id DESC';

  if (!pageParam) {
    const rows = db.prepare(`SELECT * FROM deals ${where} ORDER BY ${orderBy}`).all(...params);
    return res.json({ deals: rows.map(withComputedDeal) });
  }

  const page = Math.max(1, Number(pageParam) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM deals ${where}`).get(...params);
  const rows = db.prepare(`SELECT * FROM deals ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`).all(...params, PAGE_SIZE, offset);
  res.json({
    deals: rows.map(withComputedDeal),
    page,
    pageSize: PAGE_SIZE,
    total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
});

// Includes the linked invoice/expense (display-only summaries, not the full
// rows) and the deal's own distribution history (owner_draws rows linked
// via deal_id) — empty until the deal has actually been distributed.
router.get('/:id', view, (req, res) => {
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!deal) return res.status(404).json({ error: 'Deal not found' });

  const invoice = deal.invoice_id
    ? db
        .prepare('SELECT i.id, i.number, i.total, i.amount_paid, c.name AS client_name FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.id = ?')
        .get(deal.invoice_id)
    : null;
  const expense = deal.expense_id
    ? db.prepare('SELECT id, amount, exchange_rate, expense_date FROM expenses WHERE id = ?').get(deal.expense_id)
    : null;
  const distributions = db.prepare('SELECT * FROM owner_draws WHERE deal_id = ? ORDER BY id').all(deal.id);

  res.json({ deal: withComputedDeal(deal), invoice, expense, distributions });
});

router.post('/', manage, (req, res) => {
  const error = validate(req.body);
  if (error) return res.status(400).json({ error });

  const { description, invoice_id, payee = '', revenue_amount, exchange_rate, items = [] } = req.body;
  const invoiceIdNum = invoice_id ? Number(invoice_id) : null;
  if (invoiceIdNum) {
    const invoice = db.prepare('SELECT id FROM invoices WHERE id = ?').get(invoiceIdNum);
    if (!invoice) return res.status(400).json({ error: 'Linked invoice not found' });
  }

  const insertDeal = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO deals (description, invoice_id, payee, revenue_amount, exchange_rate, created_by_name)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        description.trim(),
        invoiceIdNum,
        (payee || '').trim(),
        Number(revenue_amount),
        exchange_rate ? Number(exchange_rate) : null,
        req.user.name,
      );
    saveDealItems(info.lastInsertRowid, items);
    return info.lastInsertRowid;
  });
  const dealId = insertDeal();

  const deal = withComputedDeal(db.prepare('SELECT * FROM deals WHERE id = ?').get(dealId));
  logActivity({ userName: req.user.name, action: 'created', entityType: 'deal', entityId: deal.id, entityLabel: deal.description });
  res.status(201).json({ deal });
});

router.put('/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Deal not found' });
  if (existing.status === 'distributed') {
    return res.status(409).json({ error: 'This deal has already been distributed and can no longer be edited.' });
  }

  const error = validate(req.body);
  if (error) return res.status(400).json({ error });

  const { description, invoice_id, payee = '', revenue_amount, exchange_rate, items = [] } = req.body;
  const invoiceIdNum = invoice_id ? Number(invoice_id) : null;
  if (invoiceIdNum) {
    const invoice = db.prepare('SELECT id FROM invoices WHERE id = ?').get(invoiceIdNum);
    if (!invoice) return res.status(400).json({ error: 'Linked invoice not found' });
  }

  const updateDeal = db.transaction(() => {
    db.prepare(
      `UPDATE deals SET description = ?, invoice_id = ?, payee = ?, revenue_amount = ?, exchange_rate = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(description.trim(), invoiceIdNum, (payee || '').trim(), Number(revenue_amount), exchange_rate ? Number(exchange_rate) : null, req.params.id);
    saveDealItems(req.params.id, items);
  });
  updateDeal();

  const deal = withComputedDeal(db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id));
  logActivity({ userName: req.user.name, action: 'updated', entityType: 'deal', entityId: deal.id, entityLabel: deal.description });
  res.json({ deal });
});

router.delete('/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Deal not found' });
  if (existing.status === 'distributed') {
    return res.status(409).json({ error: 'This deal has already been distributed and cannot be deleted.' });
  }

  db.prepare('DELETE FROM deals WHERE id = ?').run(req.params.id);
  logActivity({ userName: req.user.name, action: 'deleted', entityType: 'deal', entityId: existing.id, entityLabel: existing.description });
  res.status(204).end();
});

// The one real action: locks the deal, writes a real 'currency exchange'
// expense for the USD cost (only when there actually is one) and one real
// owner_draws row per active, >0%-owned shareholder — the same primitives
// a human would create by hand elsewhere in this app, just computed and
// attributed together in one transaction so they can never drift apart or
// be recorded only halfway.
router.post('/:id/distribute', manage, (req, res) => {
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!deal) return res.status(404).json({ error: 'Deal not found' });
  if (deal.status === 'distributed') return res.status(409).json({ error: 'This deal has already been distributed.' });

  const computed = withComputedDeal(deal);
  if (computed.cost_usd_total > 0 && !(deal.exchange_rate > 0)) {
    return res
      .status(400)
      .json({ error: 'Set an exchange rate before distributing — this deal has a supplier cost in USD to convert.' });
  }
  if (computed.net_profit <= 0) {
    return res.status(400).json({
      error: `This deal has no profit to distribute (net profit is ${computed.net_profit.toFixed(2)}). Review the cost and revenue first.`,
    });
  }

  const shareholders = db
    .prepare('SELECT * FROM shareholders WHERE active = 1 AND ownership_percent > 0 ORDER BY name COLLATE NOCASE')
    .all();
  if (shareholders.length === 0) {
    return res
      .status(400)
      .json({ error: 'No active shareholders have an ownership percentage set — add one on the Shareholders page first.' });
  }

  const today = new Date().toISOString().slice(0, 10);
  const distribute = db.transaction(() => {
    let expenseId = deal.expense_id;
    if (computed.cost_usd_total > 0) {
      const info = db
        .prepare('INSERT INTO expenses (category, description, amount, expense_date, payee, exchange_rate) VALUES (?, ?, ?, ?, ?, ?)')
        .run('currency exchange', `Supplier cost for deal: ${deal.description}`, computed.cost_mvr, today, deal.payee || '', deal.exchange_rate);
      expenseId = info.lastInsertRowid;
    }

    for (const sh of shareholders) {
      const amount = round2((computed.net_profit * sh.ownership_percent) / 100);
      if (amount <= 0) continue;
      db.prepare(
        `INSERT INTO owner_draws (type, deal_id, taken_by_name, amount, draw_date, notes, created_by_name) VALUES ('draw', ?, ?, ?, ?, ?, ?)`,
      ).run(deal.id, sh.name, amount, today, `Distribution from deal: ${deal.description}`, req.user.name);
    }

    db.prepare(
      `UPDATE deals SET status = 'distributed', expense_id = ?, distributed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
    ).run(expenseId, deal.id);
  });
  distribute();

  const updated = withComputedDeal(db.prepare('SELECT * FROM deals WHERE id = ?').get(deal.id));
  const distributions = db.prepare('SELECT * FROM owner_draws WHERE deal_id = ? ORDER BY id').all(deal.id);
  logActivity({
    userName: req.user.name,
    action: 'distributed',
    entityType: 'deal',
    entityId: deal.id,
    entityLabel: `${deal.description} (net ${computed.net_profit.toFixed(2)})`,
  });
  res.json({ deal: updated, distributions });
});

module.exports = router;
