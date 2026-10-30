const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

let srv, boss;
test.before(async () => {
  srv = await startServer(5900 + Math.floor(Math.random() * 300));
  boss = await srv.login('boss@test.com', 'Test12345');
});
test.after(() => srv.stop());

test('deletes invoices and quotes issued before the cutoff, with their payments, keeps the rest', async () => {
  const c = (await srv.api('POST', '/clients', { name: 'Cutoff Ltd', email: 'c@x.com' }, boss)).data;
  const clientId = c.client?.id || c.id;
  const items = [{ description: 'Thing', quantity: 1, unit_price: 100 }];
  const mkInv = async (issue_date, due_date) => {
    const r = await srv.api('POST', '/invoices', { client_id: clientId, issue_date, due_date, items }, boss);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return (r.data.invoice || r.data).id;
  };
  const mkQuote = async (issue_date, expiry_date) => {
    const r = await srv.api('POST', '/quotes', { client_id: clientId, issue_date, expiry_date, items }, boss);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return (r.data.quote || r.data).id;
  };
  const oldInv = await mkInv('2025-06-01', '2025-06-30');
  const newInv = await mkInv('2026-02-01', '2026-02-28');
  const oldQuote = await mkQuote('2025-05-01', '2025-06-01');
  const newQuote = await mkQuote('2026-03-01', '2026-04-01');

  let db = srv.db();
  db.prepare("UPDATE invoices SET status = 'sent' WHERE id IN (?, ?)").run(oldInv, newInv);
  db.close();
  assert.equal((await srv.api('POST', `/invoices/${oldInv}/payments`, { amount: 40, method: 'cash', paid_at: '2025-06-10' }, boss)).status, 201);
  assert.equal((await srv.api('POST', `/invoices/${newInv}/payments`, { amount: 40, method: 'cash', paid_at: '2026-02-10' }, boss)).status, 201);

  assert.equal((await srv.api('POST', '/data-reset/before', { before: '2026-01-01', confirm: 'nope' }, boss)).status, 400);
  assert.equal((await srv.api('POST', '/data-reset/before', { before: 'bad', confirm: 'DELETE' }, boss)).status, 400);

  const dry = await srv.api('POST', '/data-reset/before', { before: '2026-01-01', dryRun: true }, boss);
  assert.equal(dry.status, 200);
  assert.equal(dry.data.invoices, 1);
  assert.equal(dry.data.payments, 1);
  assert.equal(dry.data.quotes, 1);

  const res = await srv.api('POST', '/data-reset/before', { before: '2026-01-01', confirm: 'DELETE' }, boss);
  assert.equal(res.status, 200);

  db = srv.db();
  const ids = (sql) => db.prepare(sql).all().map((r) => r.id);
  assert.deepEqual(ids('SELECT id FROM invoices'), [newInv]);
  assert.deepEqual(ids('SELECT id FROM quotes'), [newQuote]);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM payments').get().c, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM invoice_items WHERE invoice_id = ?').get(oldInv).c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM clients').get().c, 1);
  db.close();
  void oldQuote;
});
