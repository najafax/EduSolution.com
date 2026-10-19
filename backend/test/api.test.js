const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

let srv;
let boss;
let ctx = {};

test.before(async () => {
  srv = await startServer(4600 + Math.floor(Math.random() * 300));
  boss = await srv.login('boss@test.com', 'Test12345');
});
test.after(() => srv.stop());

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Indian/Maldives' }).format(new Date());
const post = (p, b, t = boss) => srv.api('POST', p, b, t);
const get = (p, t = boss) => srv.api('GET', p, null, t);

function setStatus(invoiceId, status) {
  const d = srv.db();
  d.prepare('UPDATE invoices SET status = ? WHERE id = ?').run(status, invoiceId);
  d.close();
}

test('setup: client, product with cost, sent invoice', async () => {
  const client = (await post('/clients', { name: 'Acme', email: 'a@acme.test' })).data.client;
  const product = (await post('/products', { name: 'Widget', unit_price: 100, cost_price: 10 })).data.product;
  const res = await post('/invoices', {
    client_id: client.id, issue_date: today(), due_date: today(),
    items: [{ description: 'Widget', quantity: 2, unit_price: 100, product_id: product.id }],
  });
  assert.equal(res.status, 201);
  assert.equal(res.data.invoice.total, 200);
  setStatus(res.data.invoice.id, 'sent');
  ctx = { client, product, invoice: res.data.invoice };
});

test('security: supplier cost never reaches public link or staff without financials', async () => {
  // Public link
  const pub = await srv.api('GET', `/public/invoices/${ctx.invoice.public_token}`);
  assert.equal(pub.status, 200);
  assert.ok(pub.data.items.length > 0);
  for (const item of pub.data.items) assert.equal('cost_price' in item, false);
  // Super admin sees it
  const full = await get(`/invoices/${ctx.invoice.id}`);
  assert.equal(full.data.items[0].cost_price, 10);
  // Staff with invoices access but no financials does not
  const staff = await post('/users', {
    name: 'Staff', email: 'staff@test.com', password: 'Staff12345', role: 'staff',
    permissions: { invoices: { can_view: true, can_manage: true } },
  });
  assert.equal(staff.status, 201);
  const st = await srv.login('staff@test.com', 'Staff12345');
  const seen = await get(`/invoices/${ctx.invoice.id}`, st);
  assert.equal(seen.status, 200);
  assert.equal('cost_price' in seen.data.items[0], false);
  assert.equal((await get('/financials/summary', st)).status, 403);
});

test('payments: validation, cents rounding, no future dates', async () => {
  const id = ctx.invoice.id;
  assert.equal((await post(`/invoices/${id}/payments`, { amount: 10, paid_at: 'not-a-date' })).status, 400);
  assert.equal((await post(`/invoices/${id}/payments`, { amount: 10, paid_at: '2999-01-01' })).status, 400);
  assert.equal((await post(`/invoices/${id}/payments`, { amount: 0 })).status, 400);
  assert.equal((await post(`/invoices/${id}/payments`, { amount: 999 })).status, 400);
  const ok = await post(`/invoices/${id}/payments`, { amount: 33.335, paid_at: today() });
  assert.equal(ok.status, 201);
  assert.equal(ok.data.payment.amount, 33.34); // stored in whole cents
  assert.equal(ok.data.invoice.amount_paid, 33.34); // and matches the invoice
  ctx.p1 = ok.data.payment;
});

test('payments: reversal restores balance, is permanent, and cannot be repeated', async () => {
  const id = ctx.invoice.id;
  assert.equal((await post(`/invoices/${id}/payments/${ctx.p1.id}/reverse`, {})).status, 400); // reason required
  const rev = await post(`/invoices/${id}/payments/${ctx.p1.id}/reverse`, { reason: 'wrong invoice' });
  assert.equal(rev.status, 200);
  assert.equal(rev.data.invoice.amount_paid, 0);
  assert.equal(rev.data.invoice.balance_due, 200);
  const negative = rev.data.payments.find((p) => p.reverses_payment_id === ctx.p1.id);
  assert.equal(negative.amount, -33.34);
  assert.equal((await post(`/invoices/${id}/payments/${ctx.p1.id}/reverse`, { reason: 'again' })).status, 409);
  assert.equal((await post(`/invoices/${id}/payments/${negative.id}/reverse`, { reason: 'x' })).status, 409);
  assert.equal((await get(`/invoices/${id}/payments/${negative.id}/pdf`)).status, 400); // no receipt for a reversal
  // Net cash for the period is zero again.
  const s = (await get(`/financials/summary?from=${today()}&to=${today()}`)).data;
  assert.equal(s.cashRevenue, 0);
});

test('payments: a fully paid invoice goes back to sent when a payment is reversed', async () => {
  const id = ctx.invoice.id;
  const full = await post(`/invoices/${id}/payments`, { amount: 200 });
  assert.equal(full.data.invoice.status, 'paid');
  const rev = await post(`/invoices/${id}/payments/${full.data.payment.id}/reverse`, { reason: 'bounced' });
  assert.equal(rev.data.invoice.status, 'sent');
  assert.equal(rev.data.invoice.amount_paid, 0);
});

test('dates and amounts: expenses/contributions/draws reject bad dates and round to cents', async () => {
  assert.equal((await post('/expenses', { description: 'x', amount: 5, expense_date: 'tomorrow', category: 'other' })).status, 400);
  assert.equal((await post('/expenses', { description: 'x', amount: 5, expense_date: '2026-02-31', category: 'other' })).status, 400);
  const e = await post('/expenses', { description: 'rent', amount: 5.555, expense_date: today(), category: 'rent' });
  assert.equal(e.status, 201);
  assert.equal(e.data.expense.amount, 5.56);
  assert.equal((await post('/capital-contributions', { contributor_name: 'A', amount: 1, contribution_date: 'abc' })).status, 400);
  assert.equal((await post('/owner-draws', { taken_by_name: 'A', amount: 1, draw_date: 'abc' })).status, 400);
  assert.equal((await post('/invoices', { client_id: ctx.client.id, issue_date: 'x', due_date: today(), items: [{ description: 'a', quantity: 1, unit_price: 1 }] })).status, 400);
  assert.equal((await post('/quotes', { client_id: ctx.client.id, issue_date: today(), expiry_date: 'nope', items: [{ description: 'a', quantity: 1, unit_price: 1 }] })).status, 400);
});

test('bank balance reconciles with an independent calculation', async () => {
  const d = srv.db();
  d.prepare("UPDATE business_settings SET starting_balance = 1000, starting_balance_date = '' WHERE id = 1").run();
  d.close();
  assert.equal((await post('/invoices/' + ctx.invoice.id + '/payments', { amount: 80 })).status, 201);
  assert.equal((await post('/capital-contributions', { contributor_name: 'Owner', amount: 500, contribution_date: today() })).status, 201);
  assert.equal((await post('/owner-draws', { taken_by_name: 'Owner', amount: 120, draw_date: today() })).status, 201);
  const s = (await get('/financials/summary')).data;
  // 1000 start + 80 paid + 500 contributed - 5.56 expense - 120 drawn
  assert.equal(s.bankBalance, 1000 + 80 + 500 - 5.56 - 120);
  // Profit excludes owner money: 80 received - 5.56 expenses
  assert.equal(s.netProfit, 74.44);
  // Same figure through the dashboard's in-process call
  const dash = (await get('/dashboard/overview')).data;
  assert.equal(dash.financials.bankBalance, s.bankBalance);
});

test('deals: one invoice per deal, ownership capped at 100%, no double distribution', async () => {
  assert.equal((await post('/shareholders', { name: 'S1', email: 's1@x.test', ownership_percent: 60 })).status, 201);
  assert.equal((await post('/shareholders', { name: 'S2', email: 's2@x.test', ownership_percent: 41 })).status, 400); // 101%
  const s2 = await post('/shareholders', { name: 'S2', email: 's2@x.test', ownership_percent: 40 });
  assert.equal(s2.status, 201);
  const edit = await srv.api('PUT', `/shareholders/${s2.data.shareholder.id}`, { ownership_percent: 41 }, boss);
  assert.equal(edit.status, 400);

  const mk = () => post('/deals', { description: 'deal', invoice_id: ctx.invoice.id, revenue_amount: 80, items: [] });
  const d1 = await mk();
  assert.equal(d1.status, 201);
  assert.equal((await mk()).status, 409); // same invoice twice
  const dist = await post(`/deals/${d1.data.deal.id}/distribute`, {});
  assert.equal(dist.status, 200, JSON.stringify(dist.data));
  const total = dist.data.distributions.reduce((s, r) => s + r.amount, 0);
  assert.equal(Math.round(total * 100) / 100, 80); // 60% + 40% of net profit 80
  assert.equal((await post(`/deals/${d1.data.deal.id}/distribute`, {})).status, 409);
});

test('receivables aging: a past snapshot is not rewritten by later payments', async () => {
  const client = ctx.client;
  const inv = (await post('/invoices', {
    client_id: client.id, issue_date: '2026-01-01', due_date: '2026-01-31',
    items: [{ description: 'Old job', quantity: 1, unit_price: 100 }],
  })).data.invoice;
  setStatus(inv.id, 'sent');
  const d = srv.db();
  d.prepare("INSERT INTO payments (receipt_number, invoice_id, amount, method, paid_at) VALUES ('R-T-1', ?, 100, 'cash', '2026-03-01')").run(inv.id);
  d.prepare("UPDATE invoices SET amount_paid = 100, status = 'paid' WHERE id = ?").run(inv.id);
  d.close();
  const before = (await get('/reports/receivables-aging?asOf=2026-02-15')).data;
  const mine = (a) => a.clients.flatMap((c) => c.invoices).find((i) => i.id === inv.id);
  assert.equal(mine(before).balance, 100); // still owed on 15 Feb
  const after = (await get('/reports/receivables-aging?asOf=2026-03-15')).data;
  assert.equal(mine(after), undefined); // paid by 15 Mar
});

test('USD account: supplier payment books expense at average cost; cannot overdraw', async () => {
  assert.equal((await post('/usd-account', { type: 'buy', usd_amount: 100, mvr_amount: 1550, txn_date: today() })).status, 201);
  assert.equal((await post('/usd-account', { type: 'supplier_payment', usd_amount: 40, txn_date: today() })).status, 201);
  assert.equal((await post('/usd-account', { type: 'supplier_payment', usd_amount: 61, txn_date: today() })).status, 400);
  const s = (await get(`/financials/summary?from=${today()}&to=${today()}`)).data;
  assert.equal(s.supplierCosts, 620); // 40 x 15.50
  assert.equal(s.usdBalance, 60);
});
