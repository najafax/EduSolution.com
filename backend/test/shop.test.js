const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

let srv, boss;
test.before(async () => {
  srv = await startServer();
  boss = await srv.login('boss@test.com', 'Test12345');
});
test.after(() => srv.stop());

const long = () => Date.now() - 10000;
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('starter catalogue loads with retail prices only, and the public storefront serves it', async () => {
  const load = await srv.api('POST', '/shop/load-starter', {}, boss);
  assert.equal(load.status, 200);
  assert.equal(load.data.created, 112);
  // idempotent
  assert.equal((await srv.api('POST', '/shop/load-starter', {}, boss)).data.created, 0);

  const cfg = await srv.api('GET', '/public/shop/config');
  assert.equal(cfg.status, 200);
  assert.ok(cfg.data.categories.length >= 7);

  const list = await srv.api('GET', '/public/shop/products?sort=price_asc');
  assert.equal(list.status, 200);
  assert.ok(list.data.total >= 100);
  assert.ok(list.data.products[0].price <= list.data.products[1].price);
  // nothing resembling a wholesale figure leaks
  assert.ok(!/agent/i.test(JSON.stringify(list.data)));

  const tv = await srv.api('GET', '/public/shop/products?category=televisions&q=hisense');
  assert.equal(tv.status, 200);
  assert.ok(tv.data.products.every((p) => p.category_slug === 'televisions'));
});

test('orders are priced on the server, spam traps hold, card needs enabling', async () => {
  const p = (await srv.api('GET', '/public/shop/products')).data.products[0];
  const base = { name: 'Ali', phone: '7771234', island: 'Maafushi', boat: 'Speedboat 3', items: [{ product_id: p.id, quantity: 2, unit_price: 1 }], t: long() };

  assert.equal((await srv.api('POST', '/public/shop/orders', { ...base, website: 'x' })).data.number, undefined); // honeypot
  assert.equal((await srv.api('POST', '/public/shop/orders', { ...base, t: Date.now() })).data.number, undefined); // too fast
  assert.equal((await srv.api('POST', '/public/shop/orders', { ...base, name: '' })).status, 400);
  assert.equal((await srv.api('POST', '/public/shop/orders', { ...base, payment_method: 'card' })).status, 400);

  const ok = await srv.api('POST', '/public/shop/orders', base);
  assert.equal(ok.status, 200);
  assert.equal(ok.data.total, p.price * 2); // client-sent unit_price ignored
  assert.match(ok.data.number, /^S-\d{4}-0001$/);

  const track = await srv.api('GET', `/public/shop/orders/${ok.data.token}`);
  assert.equal(track.status, 200);

  // staff: list, turn into an invoice, only once
  const orders = await srv.api('GET', '/shop/orders', null, boss);
  assert.equal(orders.data.total, 1);
  const id = orders.data.orders[0].id;
  const inv = await srv.api('POST', `/shop/orders/${id}/create-invoice`, {}, boss);
  assert.equal(inv.status, 201);
  assert.equal((await srv.api('POST', `/shop/orders/${id}/create-invoice`, {}, boss)).status, 409);
});

test('staff catalogue: sale prices, pictures, bulk sale, permissions', async () => {
  const created = await srv.api('POST', '/shop/products', { sku: 'T-1', name: 'Test fridge', retail_price: 1000, category_id: null }, boss);
  assert.equal(created.status, 201);
  const id = created.data.product.id;

  assert.equal((await srv.api('PUT', `/shop/products/${id}`, { sale_price: 1200 }, boss)).status, 400); // must be lower
  const sale = await srv.api('PUT', `/shop/products/${id}`, { sale_price: 800, sale_ends_at: new Date(Date.now() + 86400000).toISOString() }, boss);
  assert.equal(sale.data.product.sale_active, true);
  const pub = (await srv.api('GET', `/public/shop/products/${id}`)).data;
  assert.equal(pub.product.price, 800);
  assert.equal(pub.product.discount_percent, 20);

  // an expired sale falls back to retail
  await srv.api('PUT', `/shop/products/${id}`, { sale_price: 800, sale_ends_at: new Date(Date.now() - 1000).toISOString() }, boss);
  assert.equal((await srv.api('GET', `/public/shop/products/${id}`)).data.product.price, 1000);

  const img = await srv.api('POST', `/shop/products/${id}/images`, { images: [png] }, boss);
  assert.equal(img.status, 201);
  assert.equal((await srv.api('POST', `/shop/products/${id}/images`, { images: ['data:text/html;base64,AAAA'] }, boss)).status, 400);
  const res = await fetch(`${srv.base}/public/shop/images/${img.data.images[0].id}`);
  assert.equal(res.headers.get('content-type'), 'image/png');

  const bulk = await srv.api('POST', '/shop/products-bulk', { action: 'sale', ids: [id], percent: 10 }, boss);
  assert.equal(bulk.data.updated, 1);
  assert.equal((await srv.api('GET', `/public/shop/products/${id}`)).data.product.price, 900);

  // a user with no shop grant is refused
  const mk = await srv.api('POST', '/users', { name: 'Sam', email: 'sam@test.com', password: 'Test12345', role: 'staff', permissions: {} }, boss);
  assert.equal(mk.status, 201);
  const sam = await srv.login('sam@test.com', 'Test12345');
  assert.equal((await srv.api('GET', '/shop/products', null, sam)).status, 403);
});

test('promotions show on the main site only while live, and render an email', async () => {
  const promo = await srv.api('POST', '/shop/promotions', { title: 'Big AC sale', theme: 'ember', ends_at: new Date(Date.now() + 86400000).toISOString() }, boss);
  assert.equal(promo.status, 201);
  assert.equal((await srv.api('GET', '/public/shop/promotions?main=1')).data.promotions.length, 1);

  await srv.api('PUT', `/shop/promotions/${promo.data.promotion.id}`, { active: false }, boss);
  assert.equal((await srv.api('GET', '/public/shop/promotions?main=1')).data.promotions.length, 0);

  const prev = await srv.api('GET', `/shop/promotions/${promo.data.promotion.id}/email-preview`, null, boss);
  assert.equal(prev.status, 200);
  assert.match(prev.data.html, /Big AC sale/);
  assert.equal((await srv.api('POST', `/shop/promotions/${promo.data.promotion.id}/send-email`, { audience: 'test' }, boss)).status, 503); // no email configured in tests
});
