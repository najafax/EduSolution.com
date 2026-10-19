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
