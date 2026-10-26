const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

let srv;
let boss;
test.before(async () => {
  srv = await startServer(5100 + Math.floor(Math.random() * 90));
  boss = await srv.login('boss@test.com', 'Test12345');
});
test.after(() => srv.stop());

const post = (p, b) => srv.api('POST', p, b, boss);
const get = (p) => srv.api('GET', p, null, boss);
const todayStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Indian/Maldives' }).format(new Date());
const plusDays = (d, n) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

test('renewal invoices: off by default, then drafts one per license per cycle, named so payment auto-renews', async () => {
  const client = (await post('/clients', { name: 'Atoll School', email: 'a@school.test' })).data.client;
  await post('/products', { name: 'Edupage Pro License', unit_price: 500, tax_rate: 8, cost_price: 120 });
  const mk = async (name, expiryOffset, amount, extra = {}) =>
    (await post('/licenses', {
      client_id: client.id, name, billing_cycle: 'yearly', amount,
      start_date: plusDays(todayStr(), -300), expiry_date: plusDays(todayStr(), expiryOffset), ...extra,
    })).data.license;
  const soon = await mk('Edupage Pro License', 10, 500);
  const far = await mk('Timetable Software', 200, 300);
  const free = await mk('Free Tier', 5, 0);
  const longLapsed = await mk('Old Lapsed Thing', -90, 100);

  // Off by default.
  assert.equal((await post('/licenses/renewal-invoices/run', {})).status, 409);

  // Switch on: 21 days ahead.
  const s = (await get('/settings')).data.settings;
  assert.equal((await srv.api('PUT', '/settings', { ...s, license_invoice_lead_days: 21 }, boss)).status, 200);
  assert.equal((await srv.api('PUT', '/settings', { ...s, license_invoice_lead_days: 500 }, boss)).status, 400);

  const run = await post('/licenses/renewal-invoices/run', {});
  assert.equal(run.status, 200);
  assert.equal(run.data.created.length, 1);
  assert.equal(run.data.created[0].name, 'Edupage Pro License');
  assert.ok(run.data.notBilled.some((n) => n.name === 'Free Tier'));

  // Only the license inside the window, not the far one or the long-lapsed one.
  const lic = (await get('/licenses')).data.licenses;
  const byName = (n) => lic.find((l) => l.name === n);
  assert.ok(byName('Edupage Pro License').renewal_invoice_number);
  assert.equal(byName('Timetable Software').renewal_invoice_number, null);
  assert.equal(byName('Old Lapsed Thing').renewal_invoice_number, null);
  void soon; void far; void free; void longLapsed;

  // The draft: one line named like the license, product tax applied, cost stamped, NOT sent.
  const full = (await get(`/invoices/${run.data.created[0].invoice_id}`)).data;
  const inv = { ...full.invoice, items: full.items };
  assert.equal(inv.status, 'draft');
  assert.equal(inv.items.length, 1);
  assert.equal(inv.items[0].description, 'Edupage Pro License');
  assert.equal(inv.subtotal, 500);
  assert.equal(inv.total, 540); // 8% tax from the matching product
  assert.equal(inv.due_date, byName('Edupage Pro License').expiry_date);

  // Running again the same cycle creates nothing new.
  const again = await post('/licenses/renewal-invoices/run', {});
  assert.equal(again.data.created.length, 0);

  // Paying it (send first, then pay in full) renews the license through the existing auto-renewal.
  const d = srv.db();
  d.prepare("UPDATE invoices SET status = 'sent' WHERE id = ?").run(inv.id);
  d.close();
  const paid = await post(`/invoices/${inv.id}/payments`, { amount: 540, method: 'cash' });
  assert.equal(paid.status, 201);
  assert.equal(paid.data.autoRenewedLicenses.length, 1);
  const after = (await get('/licenses')).data.licenses.find((l) => l.name === 'Edupage Pro License');
  assert.ok(after.expiry_date > plusDays(todayStr(), 300)); // moved a year on
  assert.equal(after.renewal_invoice_number, null); // old cycle's draft no longer shown
});

test('renewal invoices: skips a license whose renewal is already on an unpaid invoice', async () => {
  const client = (await post('/clients', { name: 'Billed Already', email: 'b@x.test' })).data.client;
  const lic = (await post('/licenses', {
    client_id: client.id, name: 'Moodle Hosting', billing_cycle: 'yearly', amount: 250,
    start_date: plusDays(todayStr(), -350), expiry_date: plusDays(todayStr(), 7),
  })).data.license;
  const prod = (await post('/products', { name: 'Moodle Hosting', unit_price: 250 })).data.product;
  const manual = await post('/invoices', {
    client_id: client.id, issue_date: todayStr(), due_date: plusDays(todayStr(), 7),
    items: [{ description: 'Moodle Hosting', quantity: 1, unit_price: 250, product_id: prod.id }],
  });
  assert.equal(manual.status, 201);
  const run = await post('/licenses/renewal-invoices/run', {});
  assert.equal(run.status, 200);
  assert.ok(run.data.notBilled.some((n) => n.license_id === lic.id && /already on unpaid invoice/.test(n.reason)));
  assert.ok(!run.data.created.some((c) => c.license_id === lic.id));
});
