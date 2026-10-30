const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

let srv, boss;
test.before(async () => {
  srv = await startServer(5600 + Math.floor(Math.random() * 300));
  boss = await srv.login('boss@test.com', 'Test12345');
});
test.after(() => srv.stop());

test('Finance reset clears finance data and the starting balance, keeps clients and invoices', async () => {
  const c = (await srv.api('POST', '/clients', { name: 'Keep Ltd', email: 'k@x.com' }, boss)).data;
  assert.ok(c);
  assert.equal((await srv.api('POST', '/expenses', { category: 'rent', description: 'Rent', amount: 100, expense_date: '2026-01-05' }, boss)).status, 201);
  assert.equal((await srv.api('POST', '/shareholders', { name: 'Sh', email: 'sh@x.com', active: true, ownership_percent: 50 }, boss)).status, 201);
  const db = srv.db();
  db.prepare('UPDATE business_settings SET starting_balance = 500, starting_balance_date = ? WHERE id = 1').run('2025-01-01');
  db.close();

  assert.equal((await srv.api('POST', '/data-reset', { confirm: 'nope', categories: ['finance'] }, boss)).status, 400);
  assert.equal((await srv.api('POST', '/data-reset', { confirm: 'DELETE', categories: ['finance'] }, boss)).status, 200);

  const d = srv.db();
  assert.equal(d.prepare('SELECT COUNT(*) c FROM expenses').get().c, 0);
  assert.equal(d.prepare('SELECT COUNT(*) c FROM shareholders').get().c, 0);
  assert.equal(d.prepare('SELECT COUNT(*) c FROM clients').get().c, 1);
  const s = d.prepare('SELECT starting_balance, starting_balance_date FROM business_settings WHERE id = 1').get();
  assert.equal(s.starting_balance, 0);
  assert.equal(s.starting_balance_date, '');
  d.close();
});
