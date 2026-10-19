// Loading lib code opens the database module — point it at a throwaway file.
process.env.DB_PATH = require('path').join(require('os').tmpdir(), `edu-units-${process.pid}.sqlite3`);
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeTotals } = require('../src/lib/totals');
const { replay, supplierCostMvr, fxResultMvr, mvrCashFlow, position } = require('../src/lib/usdLedger');
const { isValidDate, round2 } = require('../src/lib/validate');
const { addDays, recentMonthKeys, previousMonthRange, todayStr } = require('../src/lib/businessDate');

test('computeTotals: discount before tax, rounded to cents', () => {
  const t = computeTotals([{ description: 'a', quantity: 3, unit_price: 33.33 }], 6, 'percentage', 10);
  assert.equal(t.subtotal, 99.99);
  assert.equal(t.discountAmount, 10);
  assert.equal(t.taxAmount, 5.4); // 89.99 * 6% = 5.3994
  assert.equal(t.total, 95.39);
});

test('computeTotals: fixed discount cannot exceed subtotal; bad input rejected', () => {
  assert.throws(() => computeTotals([{ description: 'a', quantity: 1, unit_price: 10 }], 0, 'fixed', 11), /exceed/);
  assert.throws(() => computeTotals([], 0), /At least one/);
  assert.throws(() => computeTotals([{ description: 'a', quantity: 0, unit_price: 1 }], 0), /quantity/);
  assert.throws(() => computeTotals([{ description: 'a', quantity: 1, unit_price: 1 }], 101), /Tax rate/);
});

test('validate: real calendar dates only', () => {
  assert.equal(isValidDate('2026-02-28'), true);
  assert.equal(isValidDate('2026-02-31'), false);
  assert.equal(isValidDate('tomorrow'), false);
  assert.equal(isValidDate('2026-2-3'), false);
  assert.equal(isValidDate(undefined), false);
  assert.equal(round2(33.335), 33.34);
  assert.equal(round2(5.555), 5.56);
});

const T = (txn_date, type, usd_amount, mvr_amount = 0, id) => ({ id, txn_date, type, usd_amount, mvr_amount });

test('USD ledger: weighted-average cost, supplier cost and FX', () => {
  const { rows, error } = replay([
    T('2026-01-01', 'buy', 100, 1500, 1), // 15.00
    T('2026-01-02', 'buy', 100, 1600, 2), // 16.00 -> avg 15.5
    T('2026-01-03', 'supplier_payment', 50, 0, 3), // cost 775
    T('2026-01-04', 'sell', 50, 900, 4), // cost 775, proceeds 900 -> fx +125
  ]);
  assert.equal(error, null);
  assert.equal(rows[2].costMvr, 775);
  assert.equal(rows[3].fxMvr, 125);
  assert.equal(rows[3].balanceUsd, 100);
  assert.equal(rows[3].balanceMvr, 1550);
  assert.equal(supplierCostMvr(null, null, rows), 775);
  assert.equal(fxResultMvr(null, null, rows), 125);
  assert.equal(mvrCashFlow(null, null, rows), -3100 + 900);
  assert.equal(position('2026-01-02', rows).balanceUsd, 200);
});

test('USD ledger: opening balance counts, buying is not an expense, negative balance is flagged', () => {
  const { rows, error } = replay([T('2026-01-01', 'opening', 10, 150, 1), T('2026-01-02', 'buy', 10, 160, 2)]);
  assert.equal(error, null);
  assert.equal(supplierCostMvr(null, null, rows), 0);
  assert.equal(rows[1].avgRate, 15.5);
  const bad = replay([T('2026-01-01', 'buy', 10, 150, 1), T('2026-01-02', 'supplier_payment', 11, 0, 2)]);
  assert.equal(bad.error.shortUsd, 1);
});

test('USD ledger: backdated entries are replayed in date order', () => {
  const { error } = replay([T('2026-01-05', 'supplier_payment', 5, 0, 2), T('2026-01-01', 'buy', 10, 150, 1)].sort((a, b) => a.txn_date.localeCompare(b.txn_date)));
  assert.equal(error, null);
});

test('businessDate: pure calendar helpers', () => {
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  const noon = new Date('2026-03-15T12:00:00Z');
  assert.deepEqual(recentMonthKeys(3, noon), ['2026-01', '2026-02', '2026-03']);
  const r = previousMonthRange(noon);
  assert.equal(r.from, '2026-02-01');
  assert.equal(r.to, '2026-02-28');
  // 20:00 UTC on 31 Dec is already 1 Jan in the Maldives (UTC+5).
  assert.equal(todayStr(new Date('2026-12-31T20:00:00Z')), '2027-01-01');
  assert.deepEqual(recentMonthKeys(2, new Date('2026-12-31T20:00:00Z')), ['2026-12', '2027-01']);
});
