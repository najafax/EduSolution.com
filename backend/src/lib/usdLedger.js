const db = require('../db');

// The USD account: a running ledger of USD in and out, carried at weighted-
// average cost in MVR. Buying USD is NOT an expense (it just swaps MVR cash
// for USD cash); the expense happens when USD is paid to a supplier, valued
// at the average cost of the USD in the account at that moment. Selling USD
// back to MVR books a gain or loss against that same average cost.
//
//   opening           USD already in the account (usd × rate = MVR book value)
//   buy               MVR paid → USD received
//   supplier_payment  USD paid out to a supplier   → supplier cost (expense)
//   sell              USD converted back to MVR    → FX gain / loss
//
// Everything is derived by replaying the ledger in (date, id) order, so
// editing or backdating a row always yields consistent balances.
const TYPES = ['opening', 'buy', 'supplier_payment', 'sell'];
const EPS = 0.005;
const round2 = (n) => Math.round(n * 100) / 100;

function loadTxns() {
  return db.prepare('SELECT * FROM usd_transactions ORDER BY txn_date ASC, id ASC').all();
}

// Replays txns, returning each row enriched with running balances plus
// `costMvr` (supplier payments / sells: the average-cost MVR value of the USD
// leaving) and `fxMvr` (sells only: proceeds − cost). `error` is set when the
// USD balance would dip below zero at some point.
function replay(txns = loadTxns()) {
  let balUsd = 0;
  let balMvr = 0;
  const rows = [];
  let error = null;
  for (const t of txns) {
    const usd = Number(t.usd_amount) || 0;
    let costMvr = 0;
    let fxMvr = 0;
    if (t.type === 'opening' || t.type === 'buy') {
      balUsd += usd;
      balMvr += Number(t.mvr_amount) || 0;
    } else {
      if (usd > balUsd + EPS && !error) {
        error = { txn: t, shortUsd: round2(usd - balUsd) };
      }
      const avg = balUsd > EPS ? balMvr / balUsd : 0;
      costMvr = usd * avg;
      balUsd -= usd;
      balMvr -= costMvr;
      if (t.type === 'sell') fxMvr = (Number(t.mvr_amount) || 0) - costMvr;
    }
    if (Math.abs(balUsd) < EPS) {
      balUsd = 0;
      balMvr = 0;
    }
    rows.push({
      ...t,
      costMvr: round2(costMvr),
      fxMvr: round2(fxMvr),
      balanceUsd: round2(balUsd),
      balanceMvr: round2(balMvr),
      avgRate: balUsd > EPS ? balMvr / balUsd : null,
    });
  }
  return { rows, error };
}

const inRange = (d, from, to) => (!from || d >= from) && (!to || d <= to);

// Supplier costs expensed in [from, to] (MVR, at average cost).
function supplierCostMvr(from, to, rows = replay().rows) {
  return round2(rows.filter((r) => r.type === 'supplier_payment' && inRange(r.txn_date, from, to)).reduce((s, r) => s + r.costMvr, 0));
}

// Realised FX gain (+) / loss (−) from converting USD back to MVR in [from, to].
function fxResultMvr(from, to, rows = replay().rows) {
  return round2(rows.filter((r) => r.type === 'sell' && inRange(r.txn_date, from, to)).reduce((s, r) => s + r.fxMvr, 0));
}

// Net MVR cash moved by the USD account in [from, to]: buys go out, sells come in.
function mvrCashFlow(from, to, rows = replay().rows) {
  return round2(
    rows.reduce((s, r) => {
      if (!inRange(r.txn_date, from, to)) return s;
      if (r.type === 'buy') return s - r.mvr_amount;
      if (r.type === 'sell') return s + r.mvr_amount;
      return s;
    }, 0),
  );
}

// USD balance, MVR book value and average rate as of a date (inclusive).
function position(asOf, rows = replay().rows) {
  let last = null;
  for (const r of rows) if (!asOf || r.txn_date <= asOf) last = r;
  return {
    balanceUsd: last ? last.balanceUsd : 0,
    bookValueMvr: last ? last.balanceMvr : 0,
    avgRate: last ? last.avgRate : null,
  };
}

// Extra "expense" lines the USD account adds to a profit & loss over [from, to]:
// supplier costs, and any realised FX loss (a gain shows as a negative line).
function profitLossRows(from, to, rows = replay().rows) {
  const out = [];
  const supplier = supplierCostMvr(from, to, rows);
  if (supplier) out.push({ category: 'supplier costs', total: supplier });
  const fx = fxResultMvr(from, to, rows);
  if (fx) out.push({ category: fx < 0 ? 'FX loss' : 'FX gain', total: -fx });
  return out;
}

function negativeMessage(err) {
  return `The USD account can't go below zero: it would be short by $${err.shortUsd.toFixed(2)} on ${err.txn.txn_date}.`;
}

// Runs `mutate` in a transaction, then replays the ledger; if the USD balance
// would go negative anywhere, the whole change is rolled back and the error
// message returned instead.
function applyValidated(mutate) {
  class Rollback extends Error {}
  try {
    return {
      result: db.transaction(() => {
        const result = mutate();
        const { error } = replay();
        if (error) throw Object.assign(new Rollback(negativeMessage(error)), { rollback: true, short: error });
        return result;
      })(),
    };
  } catch (err) {
    if (err.rollback) return { error: err.message, short: err.short };
    throw err;
  }
}

module.exports = {
  applyValidated, negativeMessage,
  profitLossRows, TYPES, loadTxns, replay, supplierCostMvr, fxResultMvr, mvrCashFlow, position, round2 };
