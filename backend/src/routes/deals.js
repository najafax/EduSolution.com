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
// no owner_draws row exists until POST /:id/distribute commits it, which
// pays shareholders their share off the deal's own *estimated* exchange
// rate. **The USD cost itself is a separate, independent action** —
// POST /:id/convert-usd, recorded whenever the real USD purchase actually
// happens at whatever the real rate turns out to be, is the one thing that
// writes the real 'currency exchange' expense and actually subtracts the
// cost from bankBalance; until then the money for it just sits in the
// bank, untouched. See distributeDeal()'s and convertDealToUsd()'s own
// notes below for the full story of why these are two separate manual
// actions rather than one. Gated on 'financials', same as Capital
// contributions/Owner draws/Shareholders/Reports — this is exactly that
// level of sensitive cash data, not a reason to declare a new MODULES
// entry of its own.
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
  if (existing.status === 'distributed' || existing.expense_id) {
    return res
      .status(409)
      .json({ error: 'This deal has already been distributed or had its USD purchase recorded, and can no longer be edited.' });
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

// TEMPORARY: bulk-deletes every draft deal, for clearing out test records
// created while trying out this feature — never touches a distributed
// deal, which is real, already-recorded financial history and stays
// permanently locked here the same as PUT/DELETE /:id below. Registered
// ahead of DELETE /:id so 'drafts' is never swallowed as an :id value.
// A draft can now carry a real linked expense of its own (POST
// /:id/convert-usd below can run on a still-draft deal — converting to
// USD and distributing to shareholders are independent actions, see that
// route's own note), so this also reverses that expense before deleting
// the draft itself, same reasoning DELETE /distributed below already
// applies to a distributed deal's own expense_id — otherwise this cleanup
// tool would leave a real, still-subtracting expense behind with no deal
// left to explain it. Remove this route (and its Profit Distribution page
// button) once it's no longer needed for cleanup.
router.delete('/drafts', manage, (req, res) => {
  const drafts = db.prepare("SELECT * FROM deals WHERE status = 'draft'").all();
  if (drafts.length === 0) return res.json({ deleted: 0 });

  const deleteAll = db.transaction(() => {
    for (const deal of drafts) {
      if (deal.expense_id) {
        db.prepare('DELETE FROM expenses WHERE id = ?').run(deal.expense_id);
      }
    }
    db.prepare("DELETE FROM deals WHERE status = 'draft'").run();
  });
  deleteAll();

  logActivity({
    userName: req.user.name,
    action: 'bulk deleted',
    entityType: 'deal',
    entityId: null,
    entityLabel: `${drafts.length} draft deal(s) (test cleanup)`,
  });
  res.json({ deleted: drafts.length });
});

// TEMPORARY, same reasoning as DELETE /drafts above but for the other
// side of the ledger — bulk-deletes every *distributed* deal, fully
// reversing what POST /:id/distribute (or /distribute-all) wrote for it:
// the linked 'currency exchange' expense (if any) and every owner_draws
// row tied to that deal (deal_id = deal.id), then the deal itself. This
// is what actually undoes a test distribution's effect on bankBalance —
// deleting just the deal row alone (which PUT/DELETE /:id both still
// refuse to do for a real, non-test distributed deal) would leave the
// expense/payout rows behind, still subtracting from the running balance
// with no deal left to explain them. Only ever touches rows this
// feature itself created (matched by deal_id / the deal's own stored
// expense_id) — never a manually-entered expense or owner draw. Remove
// this route (and its Profit Distribution page button) once it's no
// longer needed for cleanup; a real, non-test distributed deal should
// never be deleted this way in production, since it erases genuine
// financial history rather than test data.
router.delete('/distributed', manage, (req, res) => {
  const distributed = db.prepare("SELECT * FROM deals WHERE status = 'distributed'").all();
  if (distributed.length === 0) return res.json({ deleted: 0 });

  const deleteAll = db.transaction(() => {
    for (const deal of distributed) {
      db.prepare('DELETE FROM owner_draws WHERE deal_id = ?').run(deal.id);
      if (deal.expense_id) {
        db.prepare('DELETE FROM expenses WHERE id = ?').run(deal.expense_id);
      }
    }
    db.prepare("DELETE FROM deals WHERE status = 'distributed'").run();
  });
  deleteAll();

  logActivity({
    userName: req.user.name,
    action: 'bulk deleted',
    entityType: 'deal',
    entityId: null,
    entityLabel: `${distributed.length} distributed deal(s) and their linked expense/payout records (test cleanup)`,
  });
  res.json({ deleted: distributed.length });
});

router.delete('/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Deal not found' });
  if (existing.status === 'distributed' || existing.expense_id) {
    return res
      .status(409)
      .json({ error: 'This deal has already been distributed or had its USD purchase recorded, and cannot be deleted.' });
  }

  db.prepare('DELETE FROM deals WHERE id = ?').run(req.params.id);
  logActivity({ userName: req.user.name, action: 'deleted', entityType: 'deal', entityId: existing.id, entityLabel: existing.description });
  res.status(204).end();
});

// The real work behind both POST /:id/distribute and POST /distribute-all
// below — writes one real owner_draws row per active, >0%-owned
// shareholder, the same primitive a human would create by hand elsewhere
// in this app. `computedDeal` is a withComputedDeal() result (raw row +
// cost_usd_total/cost_mvr/net_profit, cost_mvr computed from the deal's own
// *typed-in, estimated* exchange_rate); the caller is responsible for
// eligibility checks (a positive net profit, a real exchange rate whenever
// there's a USD cost, a real linked+paid invoice) and for wrapping this in
// its own db.transaction() — a bulk caller distributing several deals at
// once wraps them all in one transaction, not one each.
//
// Deliberately does **not** write the 'currency exchange' expense for the
// USD cost — see convertDealToUsd() below and its own POST /:id/convert-usd
// route for why that's now a separate, later, manual action instead: this
// used to write both the expense and the shareholder payout together the
// instant Distribute was clicked, using whatever estimated rate happened
// to be typed into the deal at the time — which meant the cost portion
// left the bank balance for a USD purchase that, in reality, hadn't
// happened yet. Distributing now only ever pays shareholders their share
// of the *estimated* net profit; the cost side stays untouched in the
// bank balance until the real purchase is recorded separately, at
// whichever rate turns out to be real that day.
//
// Recorded as owner_draws.type = 'profit_distribution', not 'draw' — this
// is a one-way profit payout, not money that's expected to come back the
// way a real draw is, so it's deliberately a distinct type from the two
// TYPES a human can create via the manual Owner Draws form (see
// routes/ownerDraws.js's own TYPES constant, unchanged by this). That
// router excludes 'profit_distribution' from its own draw/return totals,
// list, exports, and per-name breakdown entirely (see its own notes) —
// it still counts against routes/financials.js's bankBalance, since the
// cash really did leave the business.
function distributeDeal(computedDeal, shareholders, userName, today) {
  for (const sh of shareholders) {
    const amount = round2((computedDeal.net_profit * sh.ownership_percent) / 100);
    if (amount <= 0) continue;
    db.prepare(
      `INSERT INTO owner_draws (type, deal_id, taken_by_name, amount, draw_date, notes, created_by_name) VALUES ('profit_distribution', ?, ?, ?, ?, ?, ?)`,
    ).run(computedDeal.id, sh.name, amount, today, `Distribution from deal: ${computedDeal.description}`, userName);
  }

  db.prepare(`UPDATE deals SET status = 'distributed', distributed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(
    computedDeal.id,
  );
}

// The other half of a deal's real-money footprint, and the one that used
// to happen automatically inside distributeDeal() above — writes the real
// 'currency exchange' expense for the deal's USD cost, at whatever rate
// the caller actually got when they went and bought the USD (never the
// deal's own typed-in estimate, though it's a reasonable starting point
// for the form to prefill). This is the one action that actually
// subtracts the cost from bankBalance — nothing does before this runs,
// so the money genuinely sits in the bank, untouched, for however long it
// takes between distributing and actually converting. Independent of
// distributeDeal() above: a deal can be converted before, after, or
// without ever being distributed (a deal with no shareholders configured
// yet, say) — the two actions don't gate each other, matching the
// deliberate choice not to reconcile a later real rate against an
// already-paid-out estimate (see POST /:id/convert-usd's own note).
// Overwrites the deal's own exchange_rate with the real one used, so a
// later read of this deal (its own cost_mvr/net_profit, the "View split"
// modal) reflects reality, not the stale estimate — distributeDeal()'s
// own payout is unaffected either way, since it already ran off whatever
// estimate was in force at the time.
function convertDealToUsd(computedDeal, realRate, today) {
  const costMvr = round2(computedDeal.cost_usd_total * realRate);
  const info = db
    .prepare('INSERT INTO expenses (category, description, amount, expense_date, payee, exchange_rate) VALUES (?, ?, ?, ?, ?, ?)')
    .run('currency exchange', `Supplier cost for deal: ${computedDeal.description}`, costMvr, today, computedDeal.payee || '', realRate);
  db.prepare(`UPDATE deals SET exchange_rate = ?, expense_id = ?, converted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(
    realRate,
    info.lastInsertRowid,
    computedDeal.id,
  );
}

// Distributing a deal pays shareholders their share of *estimated* net
// profit (revenue minus the deal's own typed-in exchange-rate estimate of
// the USD cost — it no longer writes the cost itself as an expense, see
// distributeDeal()'s own note) — it never adds the deal's own
// revenue_amount to bankBalance anywhere (see routes/financials.js's own
// comment on this). That's correct precisely when the revenue was already
// added some other way, i.e. a real invoice payment — for a deal with no
// linked, actually-paid invoice, distributing subtracts money that was
// never added in the first place, making bankBalance drop by part of the
// deal's revenue_amount out of nowhere. Requiring a linked, paid invoice
// before distribution is allowed closes that gap at the source, rather
// than relying on staff to only ever use this for real, invoice-backed
// deals (which the temporary DELETE /distributed cleanup route above was
// built to clean up after when that didn't hold).
function eligibilityError(computedDeal) {
  if (!computedDeal.invoice_id) {
    return 'Link this deal to a real, paid invoice before distributing — see "Link to a paid invoice" on the record. Without one, the revenue was never added to the bank balance, so distributing it would incorrectly subtract money that was never there.';
  }
  const invoice = db.prepare('SELECT amount_paid FROM invoices WHERE id = ?').get(computedDeal.invoice_id);
  if (!invoice || !(invoice.amount_paid > 0)) {
    return 'The invoice linked to this deal has no recorded payment yet — link one that\'s actually been paid before distributing.';
  }
  if (computedDeal.cost_usd_total > 0 && !(computedDeal.exchange_rate > 0)) {
    return 'Set an exchange rate before distributing — this deal has a supplier cost in USD to convert.';
  }
  if (computedDeal.net_profit <= 0) {
    return `This deal has no profit to distribute (net profit is ${computedDeal.net_profit.toFixed(2)}). Review the cost and revenue first.`;
  }
  return null;
}

router.post('/:id/distribute', manage, (req, res) => {
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!deal) return res.status(404).json({ error: 'Deal not found' });
  if (deal.status === 'distributed') return res.status(409).json({ error: 'This deal has already been distributed.' });

  const computed = withComputedDeal(deal);
  const error = eligibilityError(computed);
  if (error) return res.status(400).json({ error });

  const shareholders = db
    .prepare('SELECT * FROM shareholders WHERE active = 1 AND ownership_percent > 0 ORDER BY name COLLATE NOCASE')
    .all();
  if (shareholders.length === 0) {
    return res
      .status(400)
      .json({ error: 'No active shareholders have an ownership percentage set — add one on the Shareholders page first.' });
  }

  const today = new Date().toISOString().slice(0, 10);
  const distribute = db.transaction(() => distributeDeal(computed, shareholders, req.user.name, today));
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

// The other half of a deal's real money movement, entirely independent of
// POST /:id/distribute above (see convertDealToUsd()'s own note on why
// the two don't gate each other) — recorded whenever the real USD
// purchase actually happens, at whatever the real rate is that day, not
// the deal's own typed-in estimate. 409s if there's no USD cost to
// convert at all, or if this deal's purchase has already been recorded
// (expense_id set) — a second conversion would just double-count the
// expense. `exchange_rate` in the body is required and validated the
// same way create/update already validate it; it's expected to prefill
// from the deal's own current (estimated) rate on the frontend, but is
// freely overridable — this is the one place that rate becomes real.
router.post('/:id/convert-usd', manage, (req, res) => {
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!deal) return res.status(404).json({ error: 'Deal not found' });
  if (deal.expense_id) return res.status(409).json({ error: "This deal's USD purchase has already been recorded." });

  const computed = withComputedDeal(deal);
  if (!(computed.cost_usd_total > 0)) {
    return res.status(400).json({ error: 'This deal has no USD cost to convert.' });
  }
  const rateNum = Number(req.body.exchange_rate);
  if (!Number.isFinite(rateNum) || rateNum <= 0) {
    return res.status(400).json({ error: 'exchange_rate must be a positive number' });
  }

  const today = new Date().toISOString().slice(0, 10);
  const convert = db.transaction(() => convertDealToUsd(computed, rateNum, today));
  convert();

  const updated = withComputedDeal(db.prepare('SELECT * FROM deals WHERE id = ?').get(deal.id));
  logActivity({
    userName: req.user.name,
    action: 'recorded USD purchase for',
    entityType: 'deal',
    entityId: deal.id,
    entityLabel: `${deal.description} (${updated.cost_mvr.toFixed(2)} at rate ${rateNum})`,
  });
  res.json({ deal: updated });
});

// Bulk sibling of the single-deal action above — distributes every
// eligible draft deal in one go, instead of opening and confirming each
// one individually. "Eligible" is the exact same bar POST /:id/distribute
// enforces (a real exchange rate whenever there's a USD cost, a positive
// net profit); an ineligible draft is skipped with a reason rather than
// failing the whole batch, mirroring routes/import.js's own "partial
// success is normal, not a failure state" convention for bulk operations.
// Registered ahead of POST /:id/distribute purely for readability — the
// two paths don't actually collide (one segment vs. two), unlike
// DELETE /drafts above, which genuinely needs to come first.
router.post('/distribute-all', manage, (req, res) => {
  const shareholders = db
    .prepare('SELECT * FROM shareholders WHERE active = 1 AND ownership_percent > 0 ORDER BY name COLLATE NOCASE')
    .all();
  if (shareholders.length === 0) {
    return res
      .status(400)
      .json({ error: 'No active shareholders have an ownership percentage set — add one on the Shareholders page first.' });
  }

  const drafts = db
    .prepare("SELECT * FROM deals WHERE status = 'draft' ORDER BY created_at, id")
    .all()
    .map(withComputedDeal);
  if (drafts.length === 0) {
    return res.status(400).json({ error: 'There are no draft deals to distribute.' });
  }

  const today = new Date().toISOString().slice(0, 10);
  const distributed = [];
  const skipped = [];

  const runAll = db.transaction(() => {
    for (const deal of drafts) {
      const error = eligibilityError(deal);
      if (error) {
        skipped.push({ id: deal.id, description: deal.description, reason: error });
        continue;
      }
      distributeDeal(deal, shareholders, req.user.name, today);
      distributed.push({ id: deal.id, description: deal.description, net_profit: deal.net_profit });
    }
  });
  runAll();

  if (distributed.length > 0) {
    const totalNet = round2(distributed.reduce((sum, d) => sum + d.net_profit, 0));
    logActivity({
      userName: req.user.name,
      action: 'bulk distributed',
      entityType: 'deal',
      entityId: null,
      entityLabel: `${distributed.length} deal(s) (net total ${totalNet.toFixed(2)})`,
    });
  }

  res.json({ distributed, skipped });
});

module.exports = router;
