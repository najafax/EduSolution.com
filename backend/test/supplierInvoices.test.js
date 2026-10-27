const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

let srv, boss;
test.before(async () => {
  srv = await startServer(6100 + Math.floor(Math.random() * 300));
  boss = await srv.login('boss@test.com', 'Test12345');
});
test.after(() => srv.stop());

const today = () => new Date().toISOString().slice(0, 10);
const daysFromNow = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const post = (p, b) => srv.api('POST', p, b, boss);
const put = (p, b) => srv.api('PUT', p, b, boss);
const get = (p) => srv.api('GET', p, null, boss);
const del = (p) => srv.api('DELETE', p, null, boss);

async function soldInvoice(name, price, qty, cost) {
  const client = (await post('/clients', { name: `C-${name}`, email: `${name}@x.test` })).data.client;
  const product = (await post('/products', { name, unit_price: price, cost_price: cost })).data.product;
  const inv = (await post('/invoices', {
    client_id: client.id, issue_date: today(), due_date: daysFromNow(14),
    items: [{ description: name, quantity: qty, unit_price: price, product_id: product.id }],
  })).data.invoice;
  srv.db().prepare("UPDATE invoices SET status = 'sent' WHERE id = ?").run(inv.id);
  return inv;
}

test('supplier invoice: paid in full from the USD account, shortfall shown, undo works', async () => {
  const si = (await post('/supplier-invoices', { supplier: 'Edupage', number: 'E-1', invoice_date: today(), due_date: daysFromNow(5), usd_amount: 300 })).data;
  assert.ok(si.id);
  let o = (await get('/supplier-costs')).data;
  assert.equal(o.toPayUsd, 300);
  assert.equal(o.shortfallUsd, 300);

  // Nothing in the USD account yet: cannot pay.
  const fail = await post(`/supplier-invoices/${si.id}/pay`, {});
  assert.equal(fail.status, 400);
  assert.match(fail.data.error, /Not enough USD/);

  await post('/usd-account', { type: 'buy', usd_amount: 500, mvr_amount: 7750, txn_date: today() });
  o = (await get('/supplier-costs')).data;
  assert.equal(o.shortfallUsd, 0);
  assert.equal(o.coverUsd, 200);

  const ok = await post(`/supplier-invoices/${si.id}/pay`, {});
  assert.equal(ok.status, 200);
  assert.equal((await post(`/supplier-invoices/${si.id}/pay`, {})).status, 409); // already paid
  const s = (await get(`/financials/summary?from=${today()}&to=${today()}`)).data;
  assert.equal(s.supplierCosts, 4650); // 300 x 15.50
  assert.equal(s.usdBalance, 200);

  // The ledger row is owned by the invoice.
  const acct = (await get('/usd-account')).data;
  const row = acct.transactions.find((t) => t.type === 'supplier_payment');
  assert.equal((await del(`/usd-account/${row.id}`)).status, 409);
  assert.equal((await put(`/supplier-invoices/${si.id}`, { supplier: 'Edupage', usd_amount: 10, invoice_date: today() })).status, 409);
  assert.equal((await del(`/supplier-invoices/${si.id}`)).status, 409);

  assert.equal((await post(`/supplier-invoices/${si.id}/unpay`, {})).status, 200);
  assert.equal((await get('/financials/summary')).data.usdBalance, 500);
  assert.equal((await del(`/supplier-invoices/${si.id}`)).status, 200);
});

test('one supplier invoice funds several client invoices; awaiting list shrinks', async () => {
  const a = await soldInvoice('Alpha', 1000, 2, 40); // estimate $80
  const b = await soldInvoice('Beta', 500, 1, 30); // estimate $30
  let o = (await get('/supplier-costs')).data;
  const mine = (list, id) => list.find((x) => x.invoice_id === id);
  assert.equal(mine(o.awaiting, a.id).remainingUsd, 80);
  assert.equal(mine(o.awaiting, b.id).remainingUsd, 30);

  // A $100 supplier invoice: $80 for Alpha, $20 for Beta.
  const r = await post('/supplier-invoices', {
    supplier: 'Edupage', number: 'E-2', invoice_date: today(), usd_amount: 100,
    links: [{ invoice_id: a.id, usd_amount: 80 }, { invoice_id: b.id, usd_amount: 20 }],
  });
  assert.equal(r.status, 201);
  o = (await get('/supplier-costs')).data;
  assert.equal(mine(o.awaiting, a.id), undefined);
  assert.equal(mine(o.awaiting, b.id).remainingUsd, 10);

  // Over-allocating is refused; a void invoice cannot be linked.
  const over = await put(`/supplier-invoices/${r.data.id}/links`, { links: [{ invoice_id: a.id, usd_amount: 150 }] });
  assert.equal(over.status, 400);
  const list = (await get('/supplier-invoices?status=unpaid')).data.supplierInvoices;
  const si = list.find((x) => x.id === r.data.id);
  assert.equal(si.links.length, 2);
  assert.equal(si.unassigned_usd, 0);

  // "No supplier invoice needed" hides a sale; bringing it back restores it.
  assert.equal((await post(`/supplier-costs/awaiting/${b.id}/done`, {})).status, 200);
  assert.equal(mine((await get('/supplier-costs')).data.awaiting, b.id), undefined);
  await post(`/supplier-costs/awaiting/${b.id}/done`, { done: false });
  assert.ok(mine((await get('/supplier-costs')).data.awaiting, b.id));
});

test('sales before the tracking date are ignored; validation; permissions', async () => {
  const c = await soldInvoice('Gamma', 400, 1, 25);
  srv.db().prepare("UPDATE invoices SET issue_date = '2020-01-01' WHERE id = ?").run(c.id);
  const o = (await get('/supplier-costs')).data;
  assert.equal(o.awaiting.find((x) => x.invoice_id === c.id), undefined);
  assert.equal((await put('/supplier-costs/track-from', { track_from: 'soon' })).status, 400);

  assert.equal((await post('/supplier-invoices', { supplier: '', usd_amount: 5 })).status, 400);
  assert.equal((await post('/supplier-invoices', { supplier: 'X', usd_amount: -5 })).status, 400);
  assert.equal((await post('/supplier-invoices', { supplier: 'X', usd_amount: 5, file_data: 'data:text/plain;base64,aGk=' })).status, 400);
  const withFile = await post('/supplier-invoices', { supplier: 'X', usd_amount: 5, file_name: 'a.png', file_data: 'data:image/png;base64,iVBORw0KGgo=' });
  assert.equal(withFile.status, 201);
  const f = await srv.api('GET', `/supplier-invoices/${withFile.data.id}/file`, null, boss);
  assert.equal(f.status, 200);
  assert.equal((await srv.api('GET', '/supplier-invoices')).status, 401);
});

test('cash forecast uses real supplier invoices by due date', async () => {
  srv.db().prepare('DELETE FROM supplier_invoices').run();
  const before = (await get('/financials/cash-forecast')).data;
  await post('/supplier-invoices', { supplier: 'Soon', invoice_date: today(), due_date: daysFromNow(10), usd_amount: 100 });
  await post('/supplier-invoices', { supplier: 'Later', invoice_date: today(), due_date: daysFromNow(45), usd_amount: 200 });
  const f = (await get('/financials/cash-forecast')).data;
  const rate = f.supplier.rate;
  assert.ok(rate > 0);
  const d0 = f.buckets[0].supplierOut - before.buckets[0].supplierOut;
  const d1 = f.buckets[1].supplierOut - before.buckets[1].supplierOut;
  assert.ok(Math.abs(d0 - 100 * rate) < 0.05, `bucket0 ${d0}`);
  assert.ok(Math.abs(d1 - 200 * rate) < 0.05, `bucket1 ${d1}`);
});
