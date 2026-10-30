const { Router } = require('express');
const { todayStr } = require('../lib/businessDate');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { position } = require('../lib/usdLedger');

// Internal profit-distribution calculator — never surfaced to a client, not
// even when a deal links back to a real invoice (see db/index.js's own
// CREATE TABLE comment for the full reasoning). A deal computes:
//   net profit (MVR) = revenue_amount - (Σ item.cost_price × qty, in USD) × exchange_rate
// and, once distributed, splits that net profit among active shareholders
// by their own `ownership_percent`. A draft deal is purely a calculator —
// no owner_draws row exists until POST /:id/distribute commits it, which
// pays shareholders their share off the deal's own typed-in exchange rate.
// Gated on 'financials', same as Capital contributions/Owner draws/
// Shareholders/Reports — this is exactly that level of sensitive cash
// data, not a reason to declare a new MODULES entry of its own.
//
// **This module deliberately does not write or track the real USD
// purchase itself** — an earlier version of this feature had its own
// per-deal POST /:id/convert-usd action for that, but it was removed at
// explicit request: recording an actual currency-exchange purchase
// already has a real, single home on the Expenses page (the
// `category: 'currency exchange'` rows routes/expenses.js already
// supports), and duplicating that as a second, deal-scoped mechanism was
// the wrong shape — a deal's `cost_price`/`exchange_rate` here exist only
// to size *how much* USD a sale is expected to need, not to record when
// or at what rate it was actually bought. See routes/supplierCosts.js for
// the automatic, month/year rollup of that same USD-owed-to-suppliers
// figure (computed straight from sold invoice line items, independent of
// this `deals` table entirely) and its own "Record as expense" action,
// which is what now feeds the real Expenses currency-exchange category.

const { computeSaleProfits } = require('../lib/saleProfit');

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
  // A real cost (from linked supplier invoices) replaces the items x rate estimate.
  const costIsReal = deal.actual_cost_mvr !== null && deal.actual_cost_mvr !== undefined;
  const costMvr = costIsReal ? round2(deal.actual_cost_mvr) : deal.exchange_rate ? round2(costUsdTotal * deal.exchange_rate) : 0;
  const netProfit = round2(deal.revenue_amount - costMvr);
  // Tax collected on the linked invoice is owed to the tax authority, not
  // profit to split — surfaced so the UI can warn when the revenue figure
  // still includes it (revenue above the invoice's pre-tax amount).
  const inv = deal.invoice_id ? db.prepare('SELECT total, tax_amount FROM invoices WHERE id = ?').get(deal.invoice_id) : null;
  const invoiceTax = inv ? round2(inv.tax_amount || 0) : 0;
  const invoicePretax = inv ? round2(inv.total - invoiceTax) : null;
  const revenueIncludesTax = Boolean(inv) && invoiceTax > 0 && deal.revenue_amount > invoicePretax + 0.01;
  return {
    ...deal,
    items,
    cost_usd_total: costUsdTotal,
    cost_mvr: costMvr,
    cost_is_real: costIsReal,
    net_profit: netProfit,
    invoice_tax_amount: invoiceTax,
    invoice_pretax_total: invoicePretax,
    revenue_includes_tax: revenueIncludesTax,
  };
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

// One paid invoice's revenue can only be split once: no two deals may link
// the same invoice.
function invoiceTakenBy(invoiceId, exceptDealId = 0) {
  return db.prepare('SELECT id, description FROM deals WHERE invoice_id = ? AND id != ?').get(invoiceId, exceptDealId);
}

// Shareholder percentages that add up past 100% would pay out more than the
// profit being split.
function ownershipError(shareholders) {
  const total = shareholders.reduce((sum, sh) => sum + sh.ownership_percent, 0);
  return total > 100.0001
    ? `Active shareholders' ownership adds up to ${round2(total)}% — it must not exceed 100% before profit can be distributed.`
    : null;
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

// Company rule: profit distribution officially starts on 1 January 2027, so
// automatic distribution never picks up an invoice paid before this date, even
// if it was switched on earlier or is switched on before then.
const AUTO_PROFIT_EARLIEST = '2027-01-01';
const effectiveAutoFrom = (stored) => (stored ? (stored < AUTO_PROFIT_EARLIEST ? AUTO_PROFIT_EARLIEST : stored) : '');

// Automatic distribution switch (see autoDistribute() below). Registered
// before GET /:id so 'auto-settings' is never taken for an id.
router.get('/auto-settings', view, (req, res) => {
  const row = db.prepare('SELECT auto_profit_from AS from_date FROM business_settings WHERE id = 1').get();
  const rate = position(todayStr()).avgRate;
  const from = effectiveAutoFrom(row.from_date);
  res.json({ enabled: Boolean(from), from: from || null, usdAverageRate: rate ? Math.round(rate * 10000) / 10000 : null });
});

router.put('/auto-settings', manage, (req, res) => {
  const enabled = Boolean(req.body && req.body.enabled);
  const current = db.prepare('SELECT auto_profit_from AS from_date FROM business_settings WHERE id = 1').get().from_date;
  // Turning it on starts from today, but never before AUTO_PROFIT_EARLIEST;
  // switching it on again while already on keeps the original start date.
  const next = enabled ? effectiveAutoFrom(current || todayStr()) : '';
  db.prepare('UPDATE business_settings SET auto_profit_from = ? WHERE id = 1').run(next);
  res.json({ enabled: Boolean(next), from: next || null });
});

// Same job as the nightly cron run, on demand.
router.post('/auto-run', manage, (req, res) => {
  res.json(autoDistribute(req.user.name));
});

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
    return res.json({ deals: rows.map((r) => ({ ...withComputedDeal(r), real_cost: realCostHint(r) })) });
  }

  const page = Math.max(1, Number(pageParam) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM deals ${where}`).get(...params);
  const rows = db.prepare(`SELECT * FROM deals ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`).all(...params, PAGE_SIZE, offset);
  res.json({
    deals: rows.map((r) => ({ ...withComputedDeal(r), real_cost: realCostHint(r) })),
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
  const takenPost = invoiceIdNum && invoiceTakenBy(invoiceIdNum);
  if (takenPost) return res.status(409).json({ error: `That invoice is already linked to another record ("${takenPost.description}").` });

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
  const takenPut = invoiceIdNum && invoiceTakenBy(invoiceIdNum, Number(req.params.id));
  if (takenPut) return res.status(409).json({ error: `That invoice is already linked to another record ("${takenPut.description}").` });

  const updateDeal = db.transaction(() => {
    db.prepare(
      `UPDATE deals SET description = ?, invoice_id = ?, payee = ?, revenue_amount = ?, exchange_rate = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(description.trim(), invoiceIdNum, (payee || '').trim(), Number(revenue_amount), exchange_rate ? Number(exchange_rate) : null, req.params.id);
    saveDealItems(req.params.id, items);
  });
  updateDeal();

  const deal = withComputedDeal(db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id));
  res.json({ deal });
});

router.delete('/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Deal not found' });
  if (existing.status === 'distributed') {
    return res.status(409).json({ error: 'This deal has already been distributed and cannot be deleted.' });
  }

  db.prepare('DELETE FROM deals WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// The real work behind both POST /:id/distribute and POST /distribute-all
// below — writes one real owner_draws row per active, >0%-owned
// shareholder, the same primitive a human would create by hand elsewhere
// in this app. `computedDeal` is a withComputedDeal() result (raw row +
// cost_usd_total/cost_mvr/net_profit, cost_mvr computed from the deal's own
// typed-in exchange_rate); the caller is responsible for eligibility
// checks (a positive net profit, a real exchange rate whenever there's a
// USD cost, a real linked+paid invoice) and for wrapping this in its own
// db.transaction() — a bulk caller distributing several deals at once
// wraps them all in one transaction, not one each.
//
// Deliberately does **not** write a 'currency exchange' expense for the
// USD cost — that side of the ledger is no longer this module's job at
// all (see the top-of-file note): the actual USD purchase is recorded on
// the Expenses page directly, or via routes/supplierCosts.js's own
// automatic month/year rollup and its "Record as expense" action, neither
// of which this deal's own exchange_rate feeds into. Distributing only
// ever pays shareholders their share of net profit as this deal
// currently computes it.
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

// Distributing a deal pays shareholders their share of net profit as
// currently computed (revenue minus the deal's own typed-in exchange-rate
// conversion of the USD cost — it never writes the cost itself as an
// expense, see distributeDeal()'s own note) — it never adds the deal's own
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
  const alreadyDistributed = db
    .prepare("SELECT description FROM deals WHERE invoice_id = ? AND id != ? AND status = 'distributed'")
    .get(computedDeal.invoice_id, computedDeal.id);
  if (alreadyDistributed) {
    return `This invoice's revenue was already distributed through another record ("${alreadyDistributed.description}").`;
  }
  if (!computedDeal.cost_is_real && computedDeal.cost_usd_total > 0 && !(computedDeal.exchange_rate > 0)) {
    return 'Set an exchange rate before distributing — this deal has a supplier cost in USD to convert.';
  }
  if (computedDeal.net_profit <= 0) {
    return `This deal has no profit to distribute (net profit is ${computedDeal.net_profit.toFixed(2)}). Review the cost and revenue first.`;
  }
  return null;
}

// There is deliberately no manual distribute route: profit is only ever
// distributed by autoDistribute() below, which honours AUTO_PROFIT_EARLIEST.

// ---------------------------------------------------------------------------
// Automatic distribution (nightly, lib/scheduler.js) — off until someone turns
// it on (business_settings.auto_profit_from). For every invoice that is fully
// paid on/after that date and not yet linked to a deal, it creates a deal
// (revenue = invoice total minus the tax collected; supplier cost = the
// invoice's own stamped USD cost per line; estimated rate = the USD account's
// average rate today) and distributes it by shareholder ownership %, using the
// exact same eligibility rules and payout code as the manual button. Anything
// ineligible (no USD rate yet, no profit, no shareholders) creates nothing and
// is simply retried the next night. Later, trueUp() corrects the payout to the
// actual rate.
function autoDistribute(userName = 'Automated') {
  const from = effectiveAutoFrom(db.prepare('SELECT auto_profit_from AS f FROM business_settings WHERE id = 1').get().f);
  if (!from) return { skipped: 'off', distributed: [], waiting: [] };

  const shareholders = db
    .prepare('SELECT * FROM shareholders WHERE active = 1 AND ownership_percent > 0 ORDER BY name COLLATE NOCASE')
    .all();
  if (shareholders.length === 0 || ownershipError(shareholders)) {
    return { skipped: 'shareholders', distributed: [], waiting: [] };
  }

  const today = todayStr();
  const rate = position(today).avgRate || null;
  const candidates = db
    .prepare(
      `SELECT i.*, c.name AS client_name,
              (SELECT MAX(substr(paid_at, 1, 10)) FROM payments WHERE invoice_id = i.id AND amount > 0) AS paid_on
       FROM invoices i JOIN clients c ON c.id = i.client_id
       WHERE i.status = 'paid' AND NOT EXISTS (SELECT 1 FROM deals d WHERE d.invoice_id = i.id)
       ORDER BY i.id`,
    )
    .all()
    .filter((i) => i.paid_on && i.paid_on >= from);

  const distributed = [];
  const waiting = [];
  const ROLLBACK = new Error('rollback');
  for (const inv of candidates) {
    const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order, id').all(inv.id);
    const costItems = items.filter((it) => it.cost_price > 0);
    let result = null;
    try {
      db.transaction(() => {
        // Real cost when supplier invoices are already linked to this sale.
        const sale = computeSaleProfits({ invoiceId: inv.id }).sales[0];
        const real = sale && sale.linkedCostMvr > 0 && (sale.basis === 'actual' || sale.basis === 'invoiced') ? sale : null;
        const info = db
          .prepare(
            `INSERT INTO deals (description, invoice_id, revenue_amount, exchange_rate, actual_cost_mvr, cost_basis, created_by_name) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            `${inv.number} — ${inv.client_name} (auto)`,
            inv.id,
            round2(inv.total - (inv.tax_amount || 0)),
            costItems.length ? rate : null,
            real ? real.costMvr : null,
            real ? real.basis : 'estimate',
            userName,
          );
        saveDealItems(
          info.lastInsertRowid,
          costItems.map((it) => ({ product_id: it.product_id, description: it.description || 'Item', quantity: it.quantity, cost_price: it.cost_price })),
        );
        const computed = withComputedDeal(db.prepare('SELECT * FROM deals WHERE id = ?').get(info.lastInsertRowid));
        const error = eligibilityError(computed);
        if (error) {
          result = { invoice: inv.number, reason: error };
          throw ROLLBACK;
        }
        distributeDeal(computed, shareholders, userName, today);
        result = { invoice: inv.number, deal_id: computed.id, net_profit: computed.net_profit };
      })();
      distributed.push(result);
    } catch (err) {
      if (err !== ROLLBACK) throw err;
      waiting.push(result);
    }
  }

  if (distributed.length > 0) {
  }
  return { distributed, waiting };
}

// Adjusting a distributed deal's payout to the actual USD rate. Each
// shareholder's payout is scaled by (net profit at the actual rate) ÷ (net
// profit at the rate currently on the deal), then the difference to what was
// already paid is booked as another 'profit_distribution' row (positive = pay
// more, negative = pay back). Using what was actually paid — not today's
// ownership % — keeps this correct even if shareholdings changed since, and
// makes it safe to repeat.
function planTrueUp(deal, newRate) {
  if (deal.status !== 'distributed') return { error: 'Only a distributed record can be adjusted.' };
  const computed = withComputedDeal(deal);
  if (computed.cost_is_real) return { error: 'This record already uses the real supplier cost, so there is no rate to adjust.' };
  if (!(computed.cost_usd_total > 0)) return { error: 'This record has no USD supplier cost, so there is no rate to adjust.' };
  if (!(newRate > 0)) return { error: 'exchange_rate must be a positive number' };
  if (!(computed.net_profit > 0)) return { error: 'This record has no profit to scale.' };
  const newCostMvr = round2(computed.cost_usd_total * newRate);
  const newNet = round2(computed.revenue_amount - newCostMvr);
  if (!(newNet > 0)) return { error: `At rate ${newRate} the cost (${newCostMvr.toFixed(2)}) leaves no profit to distribute. Check the rate.` };
  return {
    oldRate: deal.exchange_rate,
    newRate,
    oldNet: computed.net_profit,
    newNet,
    ...scaledRows(deal.id, computed.net_profit, newNet),
  };
}

// Each shareholder's payout so far, scaled by newNet / oldNet.
function scaledRows(dealId, oldNet, newNet) {
  const scale = newNet / oldNet;
  const paid = db
    .prepare(
      `SELECT taken_by_name AS name, ROUND(SUM(amount), 2) AS paid FROM owner_draws
       WHERE deal_id = ? AND type = 'profit_distribution' GROUP BY taken_by_name ORDER BY name COLLATE NOCASE`,
    )
    .all(dealId);
  const rows = paid.map((p) => {
    const target = round2(p.paid * scale);
    return { name: p.name, paid: p.paid, target, adjustment: round2(target - p.paid) };
  });
  return { rows, total_adjustment: round2(rows.reduce((s, r) => s + r.adjustment, 0)) };
}

// Adjusting to the REAL supplier cost (lib/saleProfit.js): possible once every
// supplier invoice for the sale is linked and paid (basis "actual"). Same
// scaling as the rate adjustment, but the new cost is a known figure, not a
// guess about a rate.
function planRealCost(deal) {
  if (deal.status !== 'distributed') return { error: 'Only a distributed record can be adjusted.' };
  if (!deal.invoice_id) return { error: 'This record is not linked to an invoice.' };
  const computed = withComputedDeal(deal);
  const sale = computeSaleProfits({ invoiceId: deal.invoice_id }).sales[0];
  if (!sale || !(sale.linkedCostMvr > 0)) return { error: 'No supplier invoice is linked to this sale yet. Link one on USD & suppliers first.' };
  if (sale.basis !== 'actual') return { error: 'The real cost is not final yet: every supplier invoice for this sale must be linked and paid.' };
  if (!(computed.net_profit > 0)) return { error: 'This record has no profit to scale.' };
  const newCost = round2(sale.costMvr);
  const newNet = round2(computed.revenue_amount - newCost);
  if (!(newNet > 0)) return { error: `At the real cost (${newCost.toFixed(2)}) there is no profit to distribute.` };
  if (Math.abs(newCost - computed.cost_mvr) < 0.5 && deal.cost_basis === 'actual') return { error: 'The payout already matches the real cost.' };
  return {
    kind: 'real_cost',
    oldCost: computed.cost_mvr,
    newCost,
    oldNet: computed.net_profit,
    newNet,
    ...scaledRows(deal.id, computed.net_profit, newNet),
  };
}

// Attached to each distributed deal in the list: is a real-cost adjustment
// available, and what would it change.
function realCostHint(deal) {
  if (deal.status !== 'distributed') return null;
  const plan = planRealCost(deal);
  if (plan.error) return null;
  return { newCost: plan.newCost, oldCost: plan.oldCost, newNet: plan.newNet, oldNet: plan.oldNet, total_adjustment: plan.total_adjustment };
}

router.get('/:id/true-up-preview', view, (req, res) => {
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!deal) return res.status(404).json({ error: 'Deal not found' });
  const plan = planTrueUp(deal, Number(req.query.exchange_rate));
  if (plan.error) return res.status(400).json({ error: plan.error });
  res.json(plan);
});

router.post('/:id/true-up', manage, (req, res) => {
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!deal) return res.status(404).json({ error: 'Deal not found' });
  const plan = planTrueUp(deal, Number(req.body && req.body.exchange_rate));
  if (plan.error) return res.status(400).json({ error: plan.error });

  const today = todayStr();
  const note = `True-up to actual rate ${plan.newRate} (was ${plan.oldRate}) — ${deal.description}`;
  db.transaction(() => {
    for (const r of plan.rows) {
      if (Math.abs(r.adjustment) < 0.005) continue;
      db.prepare(
        `INSERT INTO owner_draws (type, deal_id, taken_by_name, amount, draw_date, notes, created_by_name) VALUES ('profit_distribution', ?, ?, ?, ?, ?, ?)`,
      ).run(deal.id, r.name, r.adjustment, today, note, req.user.name);
    }
    db.prepare(`UPDATE deals SET exchange_rate = ?, updated_at = datetime('now') WHERE id = ?`).run(plan.newRate, deal.id);
  })();
  res.json({ plan, deal: withComputedDeal(db.prepare('SELECT * FROM deals WHERE id = ?').get(deal.id)) });
});

router.get('/:id/real-cost-preview', view, (req, res) => {
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!deal) return res.status(404).json({ error: 'Deal not found' });
  const plan = planRealCost(deal);
  if (plan.error) return res.status(400).json({ error: plan.error });
  res.json(plan);
});

router.post('/:id/true-up-real', manage, (req, res) => {
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!deal) return res.status(404).json({ error: 'Deal not found' });
  const plan = planRealCost(deal);
  if (plan.error) return res.status(400).json({ error: plan.error });
  const today = todayStr();
  const note = `True-up to real supplier cost ${plan.newCost.toFixed(2)} (was ${plan.oldCost.toFixed(2)}) — ${deal.description}`;
  db.transaction(() => {
    for (const r of plan.rows) {
      if (Math.abs(r.adjustment) < 0.005) continue;
      db.prepare(
        `INSERT INTO owner_draws (type, deal_id, taken_by_name, amount, draw_date, notes, created_by_name) VALUES ('profit_distribution', ?, ?, ?, ?, ?, ?)`,
      ).run(deal.id, r.name, r.adjustment, today, note, req.user.name);
    }
    db.prepare(`UPDATE deals SET actual_cost_mvr = ?, cost_basis = 'actual', updated_at = datetime('now') WHERE id = ?`).run(plan.newCost, deal.id);
  })();
  res.json({ plan, deal: withComputedDeal(db.prepare('SELECT * FROM deals WHERE id = ?').get(deal.id)) });
});

router.autoDistribute = autoDistribute;
module.exports = router;
