const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { startServer } = require('./helpers');

let srv;
let boss;
const ctx = {};

test.before(async () => {
  srv = await startServer(4900 + Math.floor(Math.random() * 300));
  boss = await srv.login('boss@test.com', 'Test12345');
});
test.after(() => srv.stop());

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Indian/Maldives' }).format(new Date());
const post = (p, b, t = boss) => srv.api('POST', p, b, t);
const get = (p, t = boss) => srv.api('GET', p, null, t);

test('setup: client with internal note, draft + sent invoice, quote', async () => {
  const client = (await post('/clients', { name: 'Acme', email: 'a@acme.test', notes: 'SLOW PAYER - internal' })).data.client;
  const mkInv = async () =>
    (await post('/invoices', {
      client_id: client.id, issue_date: today(), due_date: today(),
      items: [{ description: 'Thing', quantity: 1, unit_price: 100 }],
    })).data.invoice;
  const draft = await mkInv();
  const sent = await mkInv();
  const quote = (await post('/quotes', {
    client_id: client.id, issue_date: today(), expiry_date: today(),
    items: [{ description: 'Thing', quantity: 1, unit_price: 50 }],
  })).data.quote;
  const d = srv.db();
  d.prepare("UPDATE invoices SET status = 'sent', void_reason = 'secret reason', reminder_hold_note = 'internal hold' WHERE id = ?").run(sent.id);
  d.prepare("UPDATE quotes SET status = 'sent' WHERE id = ?").run(quote.id);
  d.prepare("INSERT INTO client_portal_accounts (client_id, email, password_hash) VALUES (?, ?, ?)").run(client.id, 'a@acme.test', bcrypt.hashSync('Portal1234', 4));
  d.close();
  Object.assign(ctx, { client, draft, sent, quote });
});

test('security: public links hide internal fields and draft invoices', async () => {
  const inv = await srv.api('GET', `/public/invoices/${ctx.sent.public_token}`);
  assert.equal(inv.status, 200);
  const text = JSON.stringify(inv.data);
  for (const s of ['SLOW PAYER', 'secret reason', 'internal hold']) assert.ok(!text.includes(s), `leaked: ${s}`);
  assert.equal((await srv.api('GET', `/public/invoices/${ctx.draft.public_token}`)).status, 404);
  const q = await srv.api('GET', `/public/quotes/${ctx.quote.public_token}`);
  assert.ok(!JSON.stringify(q.data).includes('SLOW PAYER'));
});

test('security: portal hides internal fields and draft invoices', async () => {
  const login = await srv.api('POST', '/portal/login', { email: 'a@acme.test', password: 'Portal1234' });
  assert.equal(login.status, 200);
  const t = login.data.token;
  const list = await get('/portal/invoices', t);
  assert.deepEqual(list.data.invoices.map((i) => i.id), [ctx.sent.id]);
  assert.ok(!JSON.stringify(list.data).includes('secret reason'));
  assert.equal((await get(`/portal/invoices/${ctx.draft.id}`, t)).status, 404);
  const one = await get(`/portal/invoices/${ctx.sent.id}`, t);
  const text = JSON.stringify(one.data);
  for (const s of ['SLOW PAYER', 'secret reason', 'internal hold']) assert.ok(!text.includes(s), `leaked: ${s}`);
  const q = await get('/portal/quotes', t);
  assert.equal(q.data.quotes.length, 1);
});

test('quotes: only draft/sent/accepted quotes convert, once, atomically', async () => {
  const mkQuote = async () =>
    (await post('/quotes', {
      client_id: ctx.client.id, issue_date: today(), expiry_date: today(),
      items: [{ description: 'Thing', quantity: 1, unit_price: 50 }],
    })).data.quote;
  const voidQ = await mkQuote();
  assert.equal((await post(`/quotes/${voidQ.id}/void`, { reason: 'test' })).status, 200);
  const declinedQ = await mkQuote();
  const expiredQ = await mkQuote();
  const d = srv.db();
  d.prepare("UPDATE quotes SET status = 'declined' WHERE id = ?").run(declinedQ.id);
  d.prepare("UPDATE quotes SET status = 'expired' WHERE id = ?").run(expiredQ.id);
  const before = d.prepare('SELECT COUNT(*) AS c FROM invoices').get().c;
  d.close();
  for (const q of [voidQ, declinedQ]) {
    const r = await post(`/quotes/${q.id}/convert-to-invoice`, { due_date: today() });
    assert.equal(r.status, 409, `quote ${q.id} should not convert`);
  }
  const d2 = srv.db();
  assert.equal(d2.prepare('SELECT COUNT(*) AS c FROM invoices').get().c, before);
  d2.close();
  // An expired quote can still be converted (the client may still want it).
  assert.equal((await post(`/quotes/${expiredQ.id}/convert-to-invoice`, { due_date: today() })).status, 201);
  const ok = await post(`/quotes/${ctx.quote.id}/convert-to-invoice`, { due_date: today() });
  assert.equal(ok.status, 201);
  assert.equal((await post(`/quotes/${ctx.quote.id}/convert-to-invoice`, { due_date: today() })).status, 409);
});

test('import: calendar-invalid dates and bare years are rejected, amounts rounded to cents', async () => {
  const csv = [
    'description,category,amount,expense_date',
    'Bad calendar day,rent,10,2026-02-31',
    'Bare year,rent,10,2026',
    'Good,rent,"10.005",2026-02-28',
  ].join('\n');
  const r = await post('/import/expenses', { csv, commit: false });
  assert.equal(r.status, 200);
  const status = r.data.results.map((x) => x.status);
  assert.deepEqual(status, ['error', 'error', 'ok']);
  const commit = await post('/import/expenses', { csv, commit: true });
  assert.equal(commit.data.imported, 1);
  const d = srv.db();
  const row = d.prepare("SELECT amount FROM expenses WHERE description = 'Good'").get();
  d.close();
  assert.equal(row.amount, 10.01);
});

test('invoices/quotes: date order enforced; PUT cannot change status', async () => {
  const items = [{ description: 'Thing', quantity: 1, unit_price: 10 }];
  const bad = await post('/invoices', { client_id: ctx.client.id, issue_date: '2026-05-10', due_date: '2026-05-01', items });
  assert.equal(bad.status, 400);
  const badQ = await post('/quotes', { client_id: ctx.client.id, issue_date: '2026-05-10', expiry_date: '2026-05-01', items });
  assert.equal(badQ.status, 400);
  const inv = (await post('/invoices', { client_id: ctx.client.id, issue_date: today(), due_date: today(), items })).data.invoice;
  const put = await srv.api('PUT', `/invoices/${inv.id}`, { client_id: ctx.client.id, issue_date: today(), due_date: today(), items, status: 'sent' }, boss);
  assert.equal(put.status, 200);
  assert.equal(put.data.invoice.status, 'draft');
});

test('public quote: cannot be accepted after expiry', async () => {
  const q = (await post('/quotes', {
    client_id: ctx.client.id, issue_date: '2020-01-01', expiry_date: '2020-02-01',
    items: [{ description: 'Thing', quantity: 1, unit_price: 5 }],
  })).data.quote;
  const d = srv.db();
  d.prepare("UPDATE quotes SET status = 'sent' WHERE id = ?").run(q.id);
  d.close();
  const r = await srv.api('POST', `/public/quotes/${q.public_token}/respond`, { response: 'accepted' });
  assert.equal(r.status, 409);
});

test('csv: negative numbers stay numeric, text starting with = is guarded', () => {
  const { toCsv } = require('../src/lib/csv');
  const out = toCsv([{ a: -5, b: '=SUM(A1)' }], [{ label: 'A', key: 'a' }, { label: 'B', key: 'b' }]);
  assert.equal(out.split('\r\n')[1], "-5,'=SUM(A1)");
});

test('profit: nightly auto-distribution by share %, then payout adjusted to the actual rate', async () => {
  const sh1 = (await post('/shareholders', { name: 'Auto A', email: 'a@auto.test', ownership_percent: 60 })).data.shareholder;
  const sh2 = (await post('/shareholders', { name: 'Auto B', email: 'b@auto.test', ownership_percent: 40 })).data.shareholder;
  assert.ok(sh1 && sh2);
  assert.equal((await post('/usd-account', { type: 'buy', usd_amount: 1000, mvr_amount: 15000, txn_date: today() })).status, 201);
  const product = (await post('/products', { name: 'AutoWidget', unit_price: 1000, cost_price: 10 })).data.product;
  const inv = (await post('/invoices', {
    client_id: ctx.client.id, issue_date: today(), due_date: today(),
    items: [{ description: 'AutoWidget', quantity: 5, unit_price: 1000, product_id: product.id }],
  })).data.invoice; // total 5000, supplier cost 5 x $10 = $50
  const d = srv.db();
  d.prepare("UPDATE invoices SET status = 'sent' WHERE id = ?").run(inv.id);
  d.close();
  assert.equal((await post(`/invoices/${inv.id}/payments`, { amount: 5000 })).status, 201);

  // Off by default: nothing is distributed.
  assert.equal((await get('/deals/auto-settings')).data.enabled, false);
  assert.equal((await post('/deals/auto-run', {})).data.skipped, 'off');
  assert.equal((await srv.api('PUT', '/deals/auto-settings', { enabled: true }, boss)).data.enabled, true);

  // Invoices paid before the switch-on date are never back-filled.
  const d2 = srv.db();
  d2.prepare('UPDATE business_settings SET auto_profit_from = ?').run('2999-01-01');
  d2.close();
  let run = (await post('/deals/auto-run', {})).data;
  assert.equal(run.distributed.length, 0);
  const d3 = srv.db();
  d3.prepare('UPDATE business_settings SET auto_profit_from = ?').run('2000-01-01');
  d3.close();

  // Company rule: nothing paid before 1 Jan 2027 is ever distributed, however early the switch date.
  assert.equal((await get('/deals/auto-settings')).data.from, '2027-01-01');
  assert.equal((await post('/deals/auto-run', {})).data.distributed.length, 0);
  const d4 = srv.db();
  d4.prepare('UPDATE payments SET paid_at = ? WHERE invoice_id = ?').run('2027-01-05', inv.id);
  d4.close();

  // Now: revenue 5000 (no tax), cost $50 x avg 15 = 750 -> net 4250, split 60/40.
  run = (await post('/deals/auto-run', {})).data;
  assert.equal(run.distributed.length, 1);
  const dealId = run.distributed[0].deal_id;
  const split = (await get(`/deals/${dealId}`)).data.distributions;
  const byName = Object.fromEntries(split.map((x) => [x.taken_by_name, x.amount]));
  assert.equal(byName['Auto A'], 2550);
  assert.equal(byName['Auto B'], 1700);
  // Running again does nothing (one deal per invoice).
  assert.equal((await post('/deals/auto-run', {})).data.distributed.length, 0);

  // Actual rate turned out to be 16: cost 800 -> net 4200 -> 2520 / 1680.
  const preview = (await get(`/deals/${dealId}/true-up-preview?exchange_rate=16`)).data;
  assert.equal(preview.newNet, 4200);
  assert.equal(preview.total_adjustment, -50);
  assert.equal((await post(`/deals/${dealId}/true-up`, { exchange_rate: 16 })).status, 200);
  const after = (await get(`/deals/${dealId}`)).data.distributions;
  const totals = {};
  for (const x of after) totals[x.taken_by_name] = Math.round((totals[x.taken_by_name] || 0) * 100 + x.amount * 100) / 100;
  assert.equal(totals['Auto A'], 2520);
  assert.equal(totals['Auto B'], 1680);
  // Repeating at the same rate changes nothing.
  assert.equal((await get(`/deals/${dealId}/true-up-preview?exchange_rate=16`)).data.total_adjustment, 0);
  // A rate that wipes out the profit is refused.
  assert.equal((await post(`/deals/${dealId}/true-up`, { exchange_rate: 200 })).status, 400);
});

test('profit: distribution uses the real supplier cost and can be adjusted once it is final', async () => {
  const product = (await post('/products', { name: 'RealWidget', unit_price: 1000, cost_price: 10 })).data.product;
  const inv = (await post('/invoices', {
    client_id: ctx.client.id, issue_date: today(), due_date: today(),
    items: [{ description: 'RealWidget', quantity: 5, unit_price: 1000, product_id: product.id }],
  })).data.invoice; // revenue 5000, estimated cost $50
  const d = srv.db();
  d.prepare("UPDATE invoices SET status = 'sent' WHERE id = ?").run(inv.id);
  d.close();
  assert.equal((await post(`/invoices/${inv.id}/payments`, { amount: 5000 })).status, 201);
  const d2 = srv.db();
  d2.prepare('UPDATE payments SET paid_at = ? WHERE invoice_id = ?').run('2027-01-06', inv.id);
  d2.close();

  // The supplier billed $60 for this sale (more than the $50 estimate); not paid yet.
  const si = (await post('/supplier-invoices', {
    supplier: 'Edupage', number: 'R-1', invoice_date: today(), usd_amount: 60, links: [{ invoice_id: inv.id, usd_amount: 60 }],
  })).data;

  // The deal is created at the real (invoiced) cost: last buy rate 15 -> 900, net 4100, split 60/40.
  const run = (await post('/deals/auto-run', {})).data;
  const made = run.distributed.find((x) => x.net_profit === 4100);
  assert.ok(made, JSON.stringify(run));
  let deal = (await get(`/deals/${made.deal_id}`)).data.deal;
  assert.equal(deal.cost_is_real, true);
  assert.equal(deal.cost_basis, 'invoiced');
  assert.equal(deal.cost_mvr, 900);
  // Not final yet: no adjustment offered, and the rate adjustment is refused.
  assert.equal((await get(`/deals/${made.deal_id}/real-cost-preview`)).status, 400);
  assert.equal((await post(`/deals/${made.deal_id}/true-up`, { exchange_rate: 16 })).status, 400);

  // Buy at a different rate, then pay: the ledger books $60 at the new average (15.5) = 930.
  assert.equal((await post('/usd-account', { type: 'buy', usd_amount: 1000, mvr_amount: 16000, txn_date: today() })).status, 201);
  assert.equal((await post(`/supplier-invoices/${si.id}/pay`, {})).status, 200);
  const list = (await get('/deals?page=1')).data.deals;
  const hint = list.find((x) => x.id === made.deal_id).real_cost;
  assert.equal(hint.newCost, 930);
  assert.equal(hint.total_adjustment, -30);

  const preview = (await get(`/deals/${made.deal_id}/real-cost-preview`)).data;
  assert.equal(preview.newNet, 4070);
  assert.equal((await post(`/deals/${made.deal_id}/true-up-real`, {})).status, 200);
  const totals = {};
  for (const x of (await get(`/deals/${made.deal_id}`)).data.distributions) totals[x.taken_by_name] = Math.round((totals[x.taken_by_name] || 0) * 100 + x.amount * 100) / 100;
  assert.equal(totals['Auto A'], 2442);
  assert.equal(totals['Auto B'], 1628);
  // Done: no further adjustment is offered.
  assert.equal((await post(`/deals/${made.deal_id}/true-up-real`, {})).status, 400);
  deal = (await get(`/deals/${made.deal_id}`)).data.deal;
  assert.equal(deal.cost_basis, 'actual');
  assert.equal(deal.cost_mvr, 930);
});
