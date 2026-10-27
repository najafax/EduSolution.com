const db = require('../db');
const { replay, position } = require('./usdLedger');

const round2 = (n) => Math.round(n * 100) / 100;

// Profit per sale (client invoice): revenue before tax minus the real
// supplier cost.
//   Supplier invoices linked to the sale: cost = linked USD x MVR per USD.
//     Paid supplier invoice  -> the MVR cost the ledger booked for that
//                               payment (average cost at the time).
//     Unpaid                 -> the latest USD buy rate (else the average).
//   Anything the linked invoices don't cover yet is an estimate from product
//   cost prices, unless the sale is marked "no supplier invoice needed".
// `basis` says how much to trust the figure:
//   actual     fully covered by paid supplier invoices
//   invoiced   covered by supplier invoices, some not paid yet
//   partly     some supplier invoices linked, the rest estimated
//   estimated  nothing linked; cost is the product cost-price estimate
//   none       no cost data at all (profit equals revenue)
function computeSaleProfits({ from, to, invoiceId } = {}) {
  const { estimatedByInvoice } = require('../routes/supplierCosts');
  const where = ["i.status IN ('sent', 'paid')"];
  const params = [];
  if (invoiceId) { where.push('i.id = ?'); params.push(invoiceId); }
  if (from) { where.push('i.issue_date >= ?'); params.push(from); }
  if (to) { where.push('i.issue_date <= ?'); params.push(to); }
  const whereSql = where.join(' AND ');

  const invoices = db
    .prepare(
      `SELECT i.id, i.number, i.issue_date, i.subtotal, i.discount_amount, i.supplier_cost_done, c.name AS client_name
         FROM invoices i LEFT JOIN clients c ON c.id = i.client_id
        WHERE ${whereSql} ORDER BY i.issue_date DESC, i.id DESC`,
    )
    .all(...params);
  const estimates = estimatedByInvoice(whereSql, params);

  const ledger = replay().rows;
  const pos = position(null, ledger);
  const buys = ledger.filter((r) => r.type === 'buy' && r.usd_amount > 0);
  const lastBuy = buys.length ? buys[buys.length - 1] : null;
  const fallbackRate = (lastBuy ? lastBuy.mvr_amount / lastBuy.usd_amount : null) || pos.avgRate || 0;
  const mvrPerUsdByTxn = new Map(ledger.filter((r) => r.type === 'supplier_payment' && r.usd_amount > 0).map((r) => [r.id, r.costMvr / r.usd_amount]));

  const linkRows = db
    .prepare(
      `SELECT l.invoice_id, l.usd_amount AS share, si.status, si.paid_txn_id, si.usd_amount AS si_usd
         FROM supplier_invoice_links l JOIN supplier_invoices si ON si.id = l.supplier_invoice_id
        WHERE l.invoice_id IN (${invoices.length ? invoices.map(() => '?').join(',') : 'NULL'})`,
    )
    .all(...invoices.map((i) => i.id));
  const linksByInvoice = new Map();
  for (const l of linkRows) {
    if (!linksByInvoice.has(l.invoice_id)) linksByInvoice.set(l.invoice_id, []);
    linksByInvoice.get(l.invoice_id).push(l);
  }

  const sales = invoices.map((inv) => {
    const revenue = round2(inv.subtotal - inv.discount_amount);
    const links = linksByInvoice.get(inv.id) || [];
    let linkedUsd = 0;
    let linkedCost = 0;
    let anyUnpaid = false;
    for (const l of links) {
      linkedUsd += l.share;
      if (l.status === 'paid' && mvrPerUsdByTxn.has(l.paid_txn_id)) linkedCost += l.share * mvrPerUsdByTxn.get(l.paid_txn_id);
      else {
        anyUnpaid = true;
        linkedCost += l.share * fallbackRate;
      }
    }
    const est = estimates.get(inv.id);
    const remainingUsd = est && !inv.supplier_cost_done ? Math.max(est.estimatedUsd - linkedUsd, 0) : 0;
    const estimatedCost = remainingUsd * fallbackRate;
    const cost = round2(linkedCost + estimatedCost);
    let basis = 'none';
    if (links.length && remainingUsd <= 0.005) basis = anyUnpaid ? 'invoiced' : 'actual';
    else if (links.length) basis = 'partly';
    else if (est && remainingUsd > 0.005) basis = 'estimated';
    else if (inv.supplier_cost_done) basis = 'actual';
    const profit = round2(revenue - cost);
    return {
      invoice_id: inv.id,
      number: inv.number,
      client_name: inv.client_name,
      issue_date: inv.issue_date,
      revenue,
      costMvr: cost,
      linkedCostMvr: round2(linkedCost),
      estimatedCostMvr: round2(estimatedCost),
      profit,
      marginPct: revenue > 0 ? round2((profit / revenue) * 100) : null,
      basis,
    };
  });

  const total = (k) => round2(sales.reduce((s, x) => s + x[k], 0));
  const revenue = total('revenue');
  const profit = total('profit');
  return {
    sales,
    totals: { revenue, costMvr: total('costMvr'), profit, marginPct: revenue > 0 ? round2((profit / revenue) * 100) : null, count: sales.length },
  };
}

module.exports = { computeSaleProfits };
