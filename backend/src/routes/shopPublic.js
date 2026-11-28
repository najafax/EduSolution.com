const { Router } = require('express');
const db = require('../db');
const { shopOrderLimiter } = require('../middleware/rateLimit');
const { EMAIL_RE } = require('../lib/emails');
const { notifyNewOrder } = require('../lib/shopNotify');
const {
  publicProduct,
  imageIdsFor,
  effectivePrice,
  round2,
  nextOrderNumber,
  newToken,
} = require('../lib/shop');

// Unauthenticated storefront API (mounted at /api/public/shop). Read-only
// except POST /orders, which is rate limited, honeypotted, and builds the
// order entirely from live server-side prices.
const unsubscribe = require('../lib/unsubscribe');
const router = Router();
const PAGE_SIZE = 24;

const nowIso = () => new Date().toISOString();

// SQL for "price a customer pays right now" — mirrors lib/shop.js effectivePrice().
const PRICE_SQL = `CASE WHEN p.sale_price IS NOT NULL AND p.sale_price > 0 AND p.sale_price < p.retail_price
  AND (p.sale_ends_at IS NULL OR p.sale_ends_at > @now) THEN p.sale_price ELSE p.retail_price END`;
const ONSALE_SQL = `(p.sale_price IS NOT NULL AND p.sale_price > 0 AND p.sale_price < p.retail_price
  AND (p.sale_ends_at IS NULL OR p.sale_ends_at > @now))`;

const SELECT_PRODUCT = `SELECT p.*, c.slug AS category_slug, c.name AS category_name
  FROM shop_products p LEFT JOIN shop_categories c ON c.id = p.category_id`;

function shopSettings() {
  const s = db.prepare('SELECT * FROM shop_settings WHERE id = 1').get();
  const biz = db.prepare('SELECT business_name, phone, email, currency_symbol, bank_details FROM business_settings WHERE id = 1').get() || {};
  return {
    shop_name: s.shop_name,
    tagline: s.tagline,
    announcement: s.announcement,
    hero_title: s.hero_title,
    hero_subtitle: s.hero_subtitle,
    has_hero_image: Boolean(s.hero_image),
    phone: s.phone || biz.phone || '',
    whatsapp: s.whatsapp || s.phone || biz.phone || '',
    email: s.email || biz.email || '',
    delivery_note: s.delivery_note,
    warranty_note: s.warranty_note,
    terms: s.terms,
    card_enabled: Boolean(s.card_enabled),
    has_bank_details: Boolean(s.bank_details || (biz && biz.bank_details)),
    currency: String(biz.currency_symbol || 'MVR').trim() || 'MVR',
  };
}

function activePromotions() {
  const now = nowIso();
  return db
    .prepare(
      `SELECT id, title, subtitle, badge, cta_label, link_path, theme, ends_at, starts_at, show_on_main_site,
              (image != '') AS has_image
       FROM shop_promotions
       WHERE active = 1 AND (starts_at IS NULL OR starts_at <= ?) AND (ends_at IS NULL OR ends_at > ?)
       ORDER BY COALESCE(ends_at, '9999') ASC, id DESC`,
    )
    .all(now, now)
    .map((p) => ({ ...p, has_image: Boolean(p.has_image), show_on_main_site: Boolean(p.show_on_main_site) }));
}

router.get('/config', (req, res) => {
  const categories = db
    .prepare(
      `SELECT c.id, c.slug, c.name, c.description,
        (SELECT COUNT(*) FROM shop_products p WHERE p.category_id = c.id AND p.visible = 1) AS product_count,
        (SELECT pi.id FROM shop_products p JOIN shop_product_images pi ON pi.product_id = p.id
           WHERE p.category_id = c.id AND p.visible = 1 ORDER BY p.featured DESC, pi.position, pi.id LIMIT 1) AS image_id
       FROM shop_categories c WHERE c.visible = 1 ORDER BY c.display_order, c.name`,
    )
    .all()
    .filter((c) => c.product_count > 0);
  res.json({ settings: shopSettings(), categories, promotions: activePromotions() });
});

// Banner data for the main marketing site: only promotions flagged for it.
router.get('/promotions', (req, res) => {
  const all = activePromotions();
  res.json({ promotions: req.query.main === '1' ? all.filter((p) => p.show_on_main_site) : all });
});

router.get('/products', (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 80);
  const category = String(req.query.category || '').trim();
  const brand = String(req.query.brand || '').trim();
  const sale = req.query.sale === '1';
  const featured = req.query.featured === '1';
  const sort = String(req.query.sort || 'featured');
  const min = Number(req.query.min);
  const max = Number(req.query.max);
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const params = { now: nowIso() };

  const where = ['p.visible = 1', '(c.id IS NULL OR c.visible = 1)'];
  if (category) {
    where.push('c.slug = @category');
    params.category = category;
  }
  if (q) {
    where.push('(p.name LIKE @like OR p.brand LIKE @like OR p.model LIKE @like OR p.sku LIKE @like OR p.size LIKE @like)');
    params.like = `%${q.replace(/[%_]/g, '')}%`;
  }
  if (sale) where.push(ONSALE_SQL);
  if (featured) where.push('p.featured = 1');
  const base = where.join(' AND ');

  const facetBrands = db
    .prepare(
      `SELECT p.brand AS brand, COUNT(*) AS n FROM shop_products p LEFT JOIN shop_categories c ON c.id = p.category_id
       WHERE ${base} AND p.brand != '' GROUP BY p.brand ORDER BY p.brand`,
    )
    .all(params);

  if (brand) {
    where.push('p.brand = @brand');
    params.brand = brand;
  }
  if (Number.isFinite(min) && min > 0) {
    where.push(`${PRICE_SQL} >= @min`);
    params.min = min;
  }
  if (Number.isFinite(max) && max > 0) {
    where.push(`${PRICE_SQL} <= @max`);
    params.max = max;
  }
  const whereSql = where.join(' AND ');

  const ORDER = {
    featured: 'p.featured DESC, p.display_order ASC, p.id DESC',
    newest: 'p.id DESC',
    price_asc: `${PRICE_SQL} ASC, p.id`,
    price_desc: `${PRICE_SQL} DESC, p.id`,
    name: 'p.name COLLATE NOCASE ASC',
  };
  const orderBy = ORDER[sort] || ORDER.featured;

  const total = db
    .prepare(`SELECT COUNT(*) AS n FROM shop_products p LEFT JOIN shop_categories c ON c.id = p.category_id WHERE ${whereSql}`)
    .get(params).n;
  const rows = db
    .prepare(
      `SELECT p.*, c.slug AS category_slug, c.name AS category_name
       FROM shop_products p LEFT JOIN shop_categories c ON c.id = p.category_id
       WHERE ${whereSql} ORDER BY ${orderBy} LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
    )
    .all(params);
  const images = imageIdsFor(rows.map((r) => r.id));
  const now = Date.now();
  res.json({
    products: rows.map((r) => publicProduct(r, images.get(r.id) || [], now)),
    brands: facetBrands,
    total,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
});

router.get('/products/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db
    .prepare(`${SELECT_PRODUCT} WHERE p.id = ? AND p.visible = 1`)
    .get(Number.isInteger(id) ? id : -1);
  if (!row) return res.status(404).json({ error: 'Product not found' });
  const images = imageIdsFor([row.id]);
  const related = db
    .prepare(
      `${SELECT_PRODUCT} WHERE p.visible = 1 AND p.id != ? AND p.category_id IS ?
       ORDER BY ABS(p.retail_price - ?) ASC LIMIT 4`,
    )
    .all(row.id, row.category_id, row.retail_price);
  const relImages = imageIdsFor(related.map((r) => r.id));
  const now = Date.now();
  res.json({
    product: publicProduct(row, images.get(row.id) || [], now),
    related: related.map((r) => publicProduct(r, relImages.get(r.id) || [], now)),
  });
});

function sendBinary(res, mime, buffer) {
  res.set('Content-Type', mime);
  res.set('Cache-Control', 'public, max-age=86400');
  res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  res.send(buffer);
}

router.get('/images/:id', (req, res) => {
  const row = db.prepare('SELECT mime, data FROM shop_product_images WHERE id = ?').get(Number(req.params.id) || -1);
  if (!row) return res.status(404).end();
  sendBinary(res, row.mime, row.data);
});

function dataUriToBinary(uri) {
  const m = /^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/.exec(uri || '');
  return m ? { mime: m[1], buffer: Buffer.from(m[2], 'base64') } : null;
}

router.get('/promotions/:id/image', (req, res) => {
  const row = db.prepare('SELECT image FROM shop_promotions WHERE id = ?').get(Number(req.params.id) || -1);
  const bin = row && dataUriToBinary(row.image);
  if (!bin) return res.status(404).end();
  sendBinary(res, bin.mime, bin.buffer);
});

router.get('/hero-image', (req, res) => {
  const row = db.prepare('SELECT hero_image FROM shop_settings WHERE id = 1').get();
  const bin = row && dataUriToBinary(row.hero_image);
  if (!bin) return res.status(404).end();
  sendBinary(res, bin.mime, bin.buffer);
});

// ---- checkout ---------------------------------------------------------------
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

router.post('/orders', shopOrderLimiter, (req, res) => {
  const b = req.body || {};
  if (text(b.website, 200)) return res.json({ ok: true }); // honeypot
  const filledFor = Date.now() - Number(b.t);
  if (!Number.isFinite(filledFor) || filledFor < 4000) return res.json({ ok: true });

  const name = text(b.name, 120);
  const phone = text(b.phone, 40);
  const email = text(b.email, 200).toLowerCase();
  const island = text(b.island, 120);
  const address = text(b.address, 400);
  const boat = text(b.boat, 160);
  const notes = text(b.notes, 1000);
  if (!name) return res.status(400).json({ error: 'Please enter your name.' });
  if (phone.replace(/\D/g, '').length < 6) return res.status(400).json({ error: 'Please enter a phone number we can reach you on.' });
  if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: 'That email address does not look right.' });
  if (!island) return res.status(400).json({ error: 'Please tell us which island to deliver to.' });

  const settings = db.prepare('SELECT * FROM shop_settings WHERE id = 1').get();
  const method = String(b.payment_method || 'bank_transfer');
  if (!['bank_transfer', 'purchase_order', 'card'].includes(method)) return res.status(400).json({ error: 'Choose how you would like to pay.' });
  if (method === 'card' && !settings.card_enabled) return res.status(400).json({ error: 'Card payment is not available right now.' });

  const lines = Array.isArray(b.items) ? b.items.slice(0, 30) : [];
  if (lines.length === 0) return res.status(400).json({ error: 'Your cart is empty.' });

  const merged = new Map();
  for (const l of lines) {
    const id = Number(l && l.product_id);
    const qty = Math.floor(Number(l && l.quantity));
    if (!Number.isInteger(id) || !Number.isFinite(qty) || qty < 1) return res.status(400).json({ error: 'Something in your cart is not valid.' });
    merged.set(id, Math.min(20, (merged.get(id) || 0) + qty));
  }

  const now = Date.now();
  const items = [];
  for (const [id, quantity] of merged) {
    const p = db.prepare('SELECT * FROM shop_products WHERE id = ? AND visible = 1').get(id);
    if (!p) return res.status(400).json({ error: 'One of the items in your cart is no longer available.' });
    if (p.stock_status === 'out') return res.status(400).json({ error: `${p.name} is out of stock.` });
    const unit = effectivePrice(p, now);
    items.push({ product_id: p.id, sku: p.sku, name: p.name, unit_price: unit, quantity, amount: round2(unit * quantity) });
  }
  const subtotal = round2(items.reduce((s, i) => s + i.amount, 0));

  const create = db.transaction(() => {
    const number = nextOrderNumber();
    const token = newToken();
    const info = db
      .prepare(
        `INSERT INTO shop_orders (number, public_token, customer_name, phone, email, island, address, boat, notes,
           payment_method, po_number, subtotal, total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(number, token, name, phone, email, island, address, boat, notes, method, method === 'purchase_order' ? text(b.po_number, 60) : '', subtotal, subtotal);
    const ins = db.prepare(
      'INSERT INTO shop_order_items (order_id, product_id, sku, name, unit_price, quantity, amount) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    for (const i of items) ins.run(info.lastInsertRowid, i.product_id, i.sku, i.name, i.unit_price, i.quantity, i.amount);
    return db.prepare('SELECT * FROM shop_orders WHERE id = ?').get(info.lastInsertRowid);
  });
  const order = create();

  const biz = db.prepare('SELECT bank_details FROM business_settings WHERE id = 1').get() || {};
  res.json({
    ok: true,
    number: order.number,
    token: order.public_token,
    total: order.total,
    payment_method: order.payment_method,
    bank_details: method === 'bank_transfer' ? settings.bank_details || biz.bank_details || '' : '',
  });
  notifyNewOrder(order, items).catch((err) => console.error('shop order notify failed', err.message));
});

router.get('/orders/:token', (req, res) => {
  const order = db.prepare('SELECT * FROM shop_orders WHERE public_token = ?').get(String(req.params.token || ''));
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const items = db.prepare('SELECT name, sku, unit_price, quantity, amount FROM shop_order_items WHERE order_id = ?').all(order.id);
  const settings = db.prepare('SELECT bank_details FROM shop_settings WHERE id = 1').get();
  const biz = db.prepare('SELECT bank_details FROM business_settings WHERE id = 1').get() || {};
  res.json({
    order: {
      number: order.number,
      status: order.status,
      payment_method: order.payment_method,
      po_number: order.po_number,
      payment_status: order.payment_status,
      customer_name: order.customer_name,
      island: order.island,
      boat: order.boat,
      total: order.total,
      created_at: order.created_at,
      bank_details: order.payment_method === 'bank_transfer' ? settings.bank_details || biz.bank_details || '' : '',
      payment_link: order.payment_method === 'card' && order.payment_status === 'unpaid' ? order.payment_link : '',
    },
    items,
  });
});

// Unsubscribe from shop sale emails. Called by the /unsubscribe page (JSON body
// { c, t, undo? }) and by mail apps' one-click List-Unsubscribe (POST with c/t in
// the query string). The token is an HMAC of the client id (lib/unsubscribe.js).
router.post('/unsubscribe', (req, res) => {
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const c = b.c ?? req.query.c;
  const t = b.t ?? req.query.t;
  if (!unsubscribe.verify(c, t)) return res.status(400).json({ error: 'This unsubscribe link is not valid.' });
  const client = db.prepare('SELECT id FROM clients WHERE id = ?').get(Number(c));
  if (!client) return res.status(400).json({ error: 'This unsubscribe link is not valid.' });
  db.prepare('UPDATE clients SET promo_unsubscribed = ? WHERE id = ?').run(b.undo ? 0 : 1, client.id);
  res.json({ ok: true, unsubscribed: !b.undo });
});

module.exports = router;
