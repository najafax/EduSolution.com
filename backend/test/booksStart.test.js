const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

let srv, boss;
test.before(async () => {
  srv = await startServer(0);
  boss = await srv.login('boss@test.com', 'Test12345');
});
test.after(() => srv.stop());

const summary = async () => (await srv.api('GET', '/financials/summary', null, boss)).data;
const setBooksStart = async (value) => {
  const cur = (await srv.api('GET', '/settings', null, boss)).data.settings;
  return srv.api('PUT', '/settings', { ...cur, books_start: value }, boss);
};

test('the books start date leaves older records out of the finance figures, and nothing is deleted', async () => {
  const today = new Date().toISOString().slice(0, 10);
  await srv.api('POST', '/expenses', { category: 'rent', description: 'Old rent', amount: 300, expense_date: '2025-06-01' }, boss);
  await srv.api('POST', '/expenses', { category: 'rent', description: 'New rent', amount: 100, expense_date: today }, boss);

  // Default: everything from 2025-01-01 counts.
  let s = await summary();
  assert.equal(s.booksStart, '2025-01-01');
  assert.equal(s.totalExpenses, 400);
  assert.equal(s.bankBalance, -400);

  // Bad dates are refused.
  assert.equal((await setBooksStart('soon')).status, 400);
  assert.equal((await setBooksStart('2026-02-30')).status, 400);

  // Move the start after the old expense: it stops counting, but is still on file.
  assert.equal((await setBooksStart('2025-07-01')).status, 200);
  s = await summary();
  assert.equal(s.booksStart, '2025-07-01');
  assert.equal(s.totalExpenses, 100);
  assert.equal(s.bankBalance, -100);
  const list = (await srv.api('GET', '/expenses', null, boss)).data.expenses;
  assert.equal(list.filter((e) => e.description.endsWith('rent')).length, 2);

  // Even an explicit period that reaches back before the start is clamped to it.
  const wide = (await srv.api('GET', '/financials/summary?from=2025-01-01&to=' + today, null, boss)).data;
  assert.equal(wide.totalExpenses, 100);

  // An explicit starting-balance date wins over the books start for the bank balance.
  await srv.api('POST', '/financials/bank-balance/calibrate', { actual_balance: 4250 }, boss);
  assert.equal((await summary()).bankBalance, 4250);

  // Blank goes back to the default.
  assert.equal((await setBooksStart('')).status, 200);
  assert.equal((await summary()).booksStart, '2025-01-01');
  // Omitting it leaves the saved value alone.
  await setBooksStart('2025-07-01');
  const cur = (await srv.api('GET', '/settings', null, boss)).data.settings;
  const { books_start, ...rest } = cur;
  assert.equal((await srv.api('PUT', '/settings', rest, boss)).status, 200);
  assert.equal((await summary()).booksStart, '2025-07-01');
});

test('supplier cut-off never goes earlier than the books start', async () => {
  await setBooksStart('2025-07-01');
  const o = (await srv.api('GET', '/supplier-costs', null, boss)).data;
  assert.ok(o.trackFrom >= '2025-07-01');
});
