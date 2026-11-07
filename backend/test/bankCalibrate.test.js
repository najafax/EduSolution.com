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

test('bank balance breakdown adds up, and calibrating sets it to the real balance', async () => {
  const today = new Date().toISOString().slice(0, 10);
  assert.equal((await srv.api('POST', '/expenses', { category: 'rent', description: 'Rent', amount: 700, expense_date: today }, boss)).status, 201);
  assert.equal((await srv.api('POST', '/capital-contributions', { contributor_name: 'Owner', amount: 200, contribution_date: today }, boss)).status, 201);

  const s = await summary();
  const b = s.bankBreakdown;
  assert.equal(b.expenses, 700);
  assert.equal(b.contributions, 200);
  assert.equal(s.bankBalance, b.total);
  assert.equal(b.total, b.startingBalance + b.paymentsIn + b.contributions + b.returns + b.usdSells - b.expenses - b.draws - b.distributions - b.usdBuys);
  assert.equal(s.bankBalance, -500);

  const bad = await srv.api('POST', '/financials/bank-balance/calibrate', { actual_balance: 'abc' }, boss);
  assert.equal(bad.status, 400);
  const future = await srv.api('POST', '/financials/bank-balance/calibrate', { actual_balance: 1, as_of: '2999-01-01' }, boss);
  assert.equal(future.status, 400);

  const r = await srv.api('POST', '/financials/bank-balance/calibrate', { actual_balance: 4250 }, boss);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.bankBalance, 4250);
  assert.equal((await summary()).bankBalance, 4250);

  // Later activity adds on top of the calibrated figure.
  assert.equal((await srv.api('POST', '/expenses', { category: 'rent', description: 'More', amount: 50, expense_date: today }, boss)).status, 201);
  assert.equal((await summary()).bankBalance, 4200);
});
