const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

let srv, boss;
test.before(async () => {
  srv = await startServer(5600 + Math.floor(Math.random() * 300));
  boss = await srv.login('boss@test.com', 'Test12345');
});
test.after(() => srv.stop());

const ymd = (d) => d.toISOString().slice(0, 10);
const daysFromNow = (n) => ymd(new Date(Date.now() + n * 86400000));
const post = (p, b) => srv.api('POST', p, b, boss);

test('forecast buckets unpaid invoices by due date and reports overdue separately', async () => {
  const client = (await post('/clients', { name: 'Acme', email: 'a@acme.test' })).data.client;
  const mk = async (due, price) => {
    const inv = (await post('/invoices', {
      client_id: client.id, issue_date: daysFromNow(-60), due_date: due,
      items: [{ description: 'Thing', quantity: 1, unit_price: price }],
    })).data.invoice;
    srv.db().prepare("UPDATE invoices SET status = 'sent' WHERE id = ?").run(inv.id);
    return inv;
  };
  await mk(daysFromNow(10), 100);
  await mk(daysFromNow(45), 200);
  await mk(daysFromNow(80), 400);
  await mk(daysFromNow(-5), 50);       // overdue
  await mk(daysFromNow(200), 9999);    // beyond horizon
  const f = (await srv.api('GET', '/financials/cash-forecast', null, boss)).data;
  assert.deepEqual(f.buckets.map((b) => b.invoicesIn), [100, 200, 400]);
  assert.equal(f.overdue.amount, 50);
  assert.equal(f.overdue.count, 1);
  assert.equal(f.buckets[2].projectedBalance, f.openingBalance + 700);
});

test('recurring invoices and licence renewals are included, once per occurrence', async () => {
  const client = (await post('/clients', { name: 'Beta', email: 'b@beta.test' })).data.client;
  const d = srv.db();
  const r = d.prepare("INSERT INTO recurring_invoices (client_id, frequency, due_in_days, next_run_date) VALUES (?, 'monthly', 0, ?)").run(client.id, daysFromNow(5));
  d.prepare('INSERT INTO recurring_invoice_items (recurring_invoice_id, description, quantity, unit_price) VALUES (?, ?, 1, 1000)').run(r.lastInsertRowid, 'Retainer');
  d.prepare("INSERT INTO licenses (client_id, name, billing_cycle, amount, start_date, expiry_date, status) VALUES (?, 'LMS', 'yearly', 300, ?, ?, 'active')").run(client.id, daysFromNow(-300), daysFromNow(20));
  const f = (await srv.api('GET', '/financials/cash-forecast', null, boss)).data;
  // 5, 35 and 65 days out -> one in each bucket.
  assert.deepEqual(f.buckets.map((b) => b.recurringIn), [1000, 1000, 1000]);
  assert.deepEqual(f.buckets.map((b) => b.licensesIn), [300, 0, 0]);
});

test('a licence whose cycle is already on a sent invoice is not counted twice; dashboard carries the forecast', async () => {
  const d = srv.db();
  const lic = d.prepare("SELECT l.id, l.client_id FROM licenses l WHERE name = 'LMS'").get();
  const inv = d.prepare("INSERT INTO invoices (number, client_id, issue_date, due_date, status, subtotal, total, public_token) VALUES ('INV-X', ?, ?, ?, 'sent', 300, 300, 'tok-x')").run(lic.client_id, daysFromNow(-1), daysFromNow(20));
  d.prepare('UPDATE licenses SET renewal_invoice_id = ?, renewal_invoice_for = expiry_date WHERE id = ?').run(inv.lastInsertRowid, lic.id);
  const f = (await srv.api('GET', '/financials/cash-forecast', null, boss)).data;
  assert.equal(f.buckets[0].licensesIn, 0);
  assert.equal(f.buckets[0].invoicesIn >= 300, true);
  const dash = (await srv.api('GET', '/dashboard/overview', null, boss)).data;
  assert.equal(dash.cashForecast.buckets.length, 3);
});

test('supplier cost is estimated on income that is not invoiced yet', async () => {
  const d = srv.db();
  const client = (await post('/clients', { name: 'Gamma', email: 'g@gamma.test' })).data.client;
  // Past sold item: 100 revenue with 10 USD cost (cost snapshot on the line).
  const inv = d.prepare("INSERT INTO invoices (number, client_id, issue_date, due_date, status, subtotal, total, public_token) VALUES ('INV-S', ?, ?, ?, 'paid', 100, 100, 'tok-s')").run(client.id, daysFromNow(-30), daysFromNow(-20));
  d.prepare("INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount, cost_price) VALUES (?, 'Sold thing', 1, 100, 100, 10)").run(inv.lastInsertRowid);
  // A USD buy gives the forecast a rate (19 MVR per USD).
  d.prepare("INSERT INTO usd_transactions (type, txn_date, usd_amount, mvr_amount) VALUES ('buy', ?, 1000, 19000)").run(daysFromNow(-10));
  const f = (await srv.api('GET', '/financials/cash-forecast', null, boss)).data;
  const income = f.buckets[0].recurringIn + f.buckets[0].licensesIn;
  assert.ok(income > 0);
  assert.ok(f.supplier.estimateSharePct > 0);
  assert.ok(f.buckets[0].supplierEstOut > 0);
  assert.ok(Math.abs(f.buckets[0].supplierEstOut - income * f.supplier.estimateSharePct / 100) < 0.05);
});

test('profit payouts are forecast only when automatic sharing is on, and only on income from its start date', async () => {
  const off = (await srv.api('GET', '/financials/cash-forecast', null, boss)).data;
  assert.equal(off.profitSharing.on, false);
  assert.ok(off.buckets.every((b) => b.payoutsOut === 0));

  assert.equal((await post('/shareholders', { name: 'Sh', email: 'sh@x.com', active: true, ownership_percent: 40 })).status, 201);
  assert.equal((await srv.api('PUT', '/deals/auto-settings', { enabled: true }, boss)).status, 200);
  const on0 = (await srv.api('GET', '/financials/cash-forecast', null, boss)).data;
  assert.equal(on0.profitSharing.on, true);
  assert.equal(on0.profitSharing.sharePct, 40);
  const start = on0.profitSharing.from; // never before 2027-01-01

  const client = (await post('/clients', { name: 'Late Ltd', email: 'l@x.com' })).data.client;
  const due = start > daysFromNow(5) ? start : daysFromNow(5);
  const inv = (await post('/invoices', { client_id: client.id, issue_date: daysFromNow(-1), due_date: due, items: [{ description: 'X', quantity: 1, unit_price: 1000 }] })).data;
  const id = (inv.invoice || inv).id;
  await srv.api('POST', `/invoices/${id}/send`, {}, boss).catch(() => {});
  const d = srv.db();
  d.prepare("UPDATE invoices SET status = 'sent' WHERE id = ?").run(id);
  d.close();

  const fc = (await srv.api('GET', '/financials/cash-forecast', null, boss)).data;
  const sum = (f) => f.buckets.reduce((t, bk) => t + bk.payoutsOut, 0);
  // The new 1000 invoice earns a 40% payout if it lands inside the window (no supplier cost here).
  const inWindow = due <= daysFromNow(90);
  assert.equal(Math.round((sum(fc) - sum(on0)) * 100) / 100, inWindow ? 400 : 0);
});
