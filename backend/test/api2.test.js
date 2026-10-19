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
  for (const q of [voidQ, declinedQ, expiredQ]) {
    const r = await post(`/quotes/${q.id}/convert-to-invoice`, { due_date: today() });
    assert.equal(r.status, 409, `quote ${q.id} should not convert`);
  }
  const d2 = srv.db();
  assert.equal(d2.prepare('SELECT COUNT(*) AS c FROM invoices').get().c, before);
  d2.close();
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
