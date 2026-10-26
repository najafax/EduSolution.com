const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

let srv, boss, client;
test.before(async () => {
  srv = await startServer(5900 + Math.floor(Math.random() * 300));
  boss = await srv.login('boss@test.com', 'Test12345');
  client = (await srv.api('POST', '/clients', { name: 'Acme Ltd', email: 'a@acme.test' }, boss)).data.client;
});
test.after(() => srv.stop());

const pdf = async (path, token = boss) => {
  const res = await fetch(srv.base + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: res.status, type: res.headers.get('content-type'), body: Buffer.from(await res.arrayBuffer()) };
};

test('statement ledger: opening balance, charges, payments, reversal, running balance', () => {
  const d = srv.db();
  const mk = (num, issue, total, status = 'sent') =>
    d.prepare("INSERT INTO invoices (number, client_id, issue_date, due_date, status, subtotal, total, amount_paid, public_token) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)")
      .run(num, client.id, issue, issue, status, total, total, `tok-${num}`).lastInsertRowid;
  const pay = (inv, amount, date, rc) =>
    d.prepare('INSERT INTO payments (receipt_number, invoice_id, amount, paid_at) VALUES (?, ?, ?, ?)').run(rc, inv, amount, date);
  const a = mk('INV-A', '2026-01-10', 1000);
  mk('INV-DRAFT', '2026-01-11', 5000, 'draft');
  mk('INV-VOID', '2026-01-12', 5000, 'void');
  const b = mk('INV-B', '2026-03-05', 500);
  pay(a, 1000, '2026-02-01', 'R-1');
  pay(b, 200, '2026-03-20', 'R-2');
  pay(b, -50, '2026-03-25', 'R-3'); // reversal
  d.prepare('UPDATE invoices SET amount_paid = 1000 WHERE id = ?').run(a);
  d.prepare('UPDATE invoices SET amount_paid = 150 WHERE id = ?').run(b);
  d.close();

});

test('ledger numbers: opening balance, charges, payments, reversal, running balance', async () => {
  const all = (await srv.api('GET', `/clients/${client.id}/statement?from=all&to=2026-12-31`, null, boss)).data.statement;
  assert.deepEqual(all.entries.map((e) => [e.ref, e.charge, e.payment, e.balance]), [
    ['INV-A', 1000, 0, 1000],
    ['R-1', 0, 1000, 0],
    ['INV-B', 500, 0, 500],
    ['R-2', 0, 200, 300],
    ['R-3', 50, 0, 350],
  ]);
  assert.equal(all.closingBalance, 350);
  assert.equal(all.openingBalance, 0);

  const march = (await srv.api('GET', `/clients/${client.id}/statement?from=2026-03-01&to=2026-12-31`, null, boss)).data.statement;
  assert.equal(march.openingBalance, 0); // A was billed and fully paid before March
  assert.equal(march.entries.length, 3);
  assert.equal(march.totalCharges, 550);
  assert.equal(march.totalPayments, 200);
  assert.equal(march.closingBalance, 350);

  const feb = (await srv.api('GET', `/clients/${client.id}/statement?from=2026-02-15&to=2026-02-28`, null, boss)).data.statement;
  assert.equal(feb.openingBalance, 0);
  assert.equal(feb.entries.length, 0);
  const jan = (await srv.api('GET', `/clients/${client.id}/statement?from=2026-01-20&to=2026-01-31`, null, boss)).data.statement;
  assert.equal(jan.openingBalance, 1000);
  assert.deepEqual(all.openInvoices.map((o) => [o.number, o.balance]), [['INV-B', 350]]);
});

test('PDF downloads, validates input and is permission gated', async () => {
  const ok = await pdf(`/clients/${client.id}/statement/pdf?from=all`);
  assert.equal(ok.status, 200);
  assert.match(ok.type, /pdf/);
  assert.equal(ok.body.subarray(0, 4).toString(), '%PDF');
  assert.equal((await pdf(`/clients/${client.id}/statement/pdf?from=2026-13-99x`)).status, 400);
  assert.equal((await pdf(`/clients/${client.id}/statement/pdf?from=2026-05-01&to=2026-01-01`)).status, 400);
  assert.equal((await pdf('/clients/9999/statement/pdf')).status, 404);
  assert.equal((await pdf(`/clients/${client.id}/statement/pdf`, null)).status, 401);
  // staff with clients:view but not invoices:view is refused
  await srv.api('POST', '/users', { name: 'S', email: 's@test.com', password: 'Staff12345', role: 'staff', permissions: { clients: { can_view: true, can_manage: false } } }, boss);
  const t = await srv.login('s@test.com', 'Staff12345');
  assert.equal((await pdf(`/clients/${client.id}/statement/pdf`, t)).status, 403);
});
