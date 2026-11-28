const { Router } = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { computeTotals } = require('../lib/totals');
const { nextInvoiceNumber } = require('../lib/numbering');
const { todayStr } = require('../lib/businessDate');
const { stampItemCosts } = require('../lib/costSnapshot');
const { sendMail, isEmailConfigured } = require('../lib/mailer');
const { logEmail } = require('../lib/emailLog');
const { splitEmails, EMAIL_RE } = require('../lib/emails');
const { renderPromoEmail } = require('../lib/shopPromoEmail');
const {
  STOCK_STATUSES,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  PROMO_THEMES,
  round2,
  saleActive,
  slugify,
  newToken,
  loadStarterCatalogue,
} = require('../lib/shop');

// Staff side of the retail shop. One `shop` module covers everything:
// catalogue, pictures, sales/promotions, orders and shop settings.
const router = Router();
router.use(requireAuth);
const view = requirePermission('shop', 'view');
const manage = requirePermission('shop', 'manage');
const PAGE_SIZE = 30;

const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const bad = (res, message) => res.status(400).json({ error: message });

const IMAGE_RE = /^data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/]+=*)$/;
const MAX_IMAGE_BYTES = 900 * 1024;
const MAX_IMAGES_PER_PRODUCT = 8;

function parseImage(uri) {
  const m = IMAGE_RE.exec(uri || '');
  if (!m) return { error: 'Pictures must be PNG, JPEG or WEBP' };
  const buffer = Buffer.from(m[2], 'base64');
  if (buffer.length > MAX_IMAGE_BYTES) return { error: 'Each picture must be under 900KB (it is shrunk automatically when you upload from the browser)' };
  return { mime: m[1], buffer };
}

function validIso(value, label) {
  if (value == null || value === '') return { value: null };
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return { error: `${label} is not a valid date and time` };
  return { value: new Date(t).toISOString() };
}

// ---- stats --------------------------------------------------------------
router.get('/stats', view, (req, res) => {
  const one = (sql, ...a) => db.prepare(sql).get(...a).n;
  res.json({
    products: one('SELECT COUNT(*) AS n FROM shop_products'),
    visible: one('SELECT COUNT(*) AS n FROM shop_products WHERE visible = 1'),
    withoutPicture: one('SELECT COUNT(*) AS n FROM shop_products p WHERE NOT EXISTS (SELECT 1 FROM shop_product_images i WHERE i.product_id = p.id)'),
    newOrders: one("SELECT COUNT(*) AS n FROM shop_orders WHERE status = 'new'"),
    openOrders: one("SELECT COUNT(*) AS n FROM shop_orders WHERE status NOT IN ('delivered', 'cancelled')"),
    onSale: db.prepare('SELECT * FROM shop_products').all().filter((p) => saleActive(p)).length,
  });
});

// ---- settings -----------------------------------------------------------
router.get('/settings', view, (req, res) => {
  const s = db.prepare('SELECT * FROM shop_settings WHERE id = 1').get();
  res.json({ settings: { ...s, hero_image: s.hero_image ? '[set]' : '', has_hero_image: Boolean(s.hero_image) } });
});

router.put('/settings', manage, (req, res) => {
  const b = req.body || {};
  const cur = db.prepare('SELECT * FROM shop_settings WHERE id = 1').get();
  let hero = cur.hero_image;
  if (b.hero_image === null || b.hero_image === '') hero = '';
  else if (typeof b.hero_image === 'string' && b.hero_image.startsWith('data:')) {
    const parsed = parseImage(b.hero_image);
    if (parsed.error) return bad(res, parsed.error);
    hero = b.hero_image;
  }
  const emails = splitEmails(b.notify_email || '');
  for (const e of emails) if (!EMAIL_RE.test(e)) return bad(res, `"${e}" is not a valid email address`);
  db.prepare(
    `UPDATE shop_settings SET shop_name = ?, tagline = ?, announcement = ?, hero_title = ?, hero_subtitle = ?, hero_image = ?,
       phone = ?, whatsapp = ?, email = ?, delivery_note = ?, warranty_note = ?, bank_details = ?, terms = ?,
       card_enabled = ?, card_provider = ?, notify_email = ? WHERE id = 1`,
  ).run(
    text(b.shop_name, 80) || cur.shop_name,
    text(b.tagline, 160),
    text(b.announcement, 200),
    text(b.hero_title, 100) || cur.hero_title,
    text(b.hero_subtitle, 300),
    hero,
    text(b.phone, 40),
    text(b.whatsapp, 40),
    text(b.email, 200),
    text(b.delivery_note, 500),
    text(b.warranty_note, 300),
    text(b.bank_details, 600),
    text(b.terms, 4000),
    b.card_enabled ? 1 : 0,
    text(b.card_provider, 60),
    emails.join(', '),
  );
  res.json({ ok: true });
});

// ---- categories ---------------------------------------------------------
router.get('/categories', view, (req, res) => {
  const categories = db
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM shop_products p WHERE p.category_id = c.id) AS product_count
       FROM shop_categories c ORDER BY c.display_order, c.name`,
    )
    .all();
  res.json({ categories });
});

function categoryFields(b) {
  const name = text(b.name, 80);
  if (!name) return { error: 'Name is required' };
  return {
    name,
    slug: slugify(b.slug || name),
    description: text(b.description, 300),
    display_order: Number.parseInt(b.display_order, 10) || 0,
    visible: b.visible === false || b.visible === 0 ? 0 : 1,
  };
}

router.post('/categories', manage, (req, res) => {
  const f = categoryFields(req.body || {});
  if (f.error) return bad(res, f.error);
  if (db.prepare('SELECT 1 FROM shop_categories WHERE slug = ?').get(f.slug)) return res.status(409).json({ error: 'A category with that name already exists' });
  const info = db
    .prepare('INSERT INTO shop_categories (slug, name, description, display_order, visible) VALUES (?, ?, ?, ?, ?)')
    .run(f.slug, f.name, f.description, f.display_order, f.visible);
  res.status(201).json({ category: db.prepare('SELECT * FROM shop_categories WHERE id = ?').get(info.lastInsertRowid) });
});

router.put('/categories/:id', manage, (req, res) => {
  const cur = db.prepare('SELECT * FROM shop_categories WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Category not found' });
  const f = categoryFields({ slug: cur.slug, ...(req.body || {}) });
  if (f.error) return bad(res, f.error);
  const clash = db.prepare('SELECT 1 FROM shop_categories WHERE slug = ? AND id != ?').get(f.slug, cur.id);
  if (clash) return res.status(409).json({ error: 'Another category already uses that name' });
  db.prepare('UPDATE shop_categories SET slug = ?, name = ?, description = ?, display_order = ?, visible = ? WHERE id = ?').run(
    f.slug, f.name, f.description, f.display_order, f.visible, cur.id,
  );
  res.json({ category: db.prepare('SELECT * FROM shop_categories WHERE id = ?').get(cur.id) });
});

router.delete('/categories/:id', manage, (req, res) => {
  const n = db.prepare('SELECT COUNT(*) AS n FROM shop_products WHERE category_id = ?').get(req.params.id).n;
  if (n > 0) return res.status(409).json({ error: `This category still has ${n} product(s). Move or delete them first.` });
  db.prepare('DELETE FROM shop_categories WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---- products -----------------------------------------------------------
function adminProduct(p) {
  return {
    ...p,
    sale_active: saleActive(p),
    image_count: db.prepare('SELECT COUNT(*) AS n FROM shop_product_images WHERE product_id = ?').get(p.id).n,
    first_image: (db.prepare('SELECT id FROM shop_product_images WHERE product_id = ? ORDER BY position, id LIMIT 1').get(p.id) || {}).id || null,
  };
}

router.get('/products', view, (req, res) => {
  const q = text(req.query.q, 80);
  const category = text(req.query.category, 40);
  const flag = text(req.query.flag, 20);
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const where = [];
  const params = {};
  if (q) {
    where.push('(p.name LIKE @like OR p.sku LIKE @like OR p.model LIKE @like OR p.brand LIKE @like)');
    params.like = `%${q.replace(/[%_]/g, '')}%`;
  }
  if (category === 'none') where.push('p.category_id IS NULL');
  else if (category) {
    where.push('p.category_id = @category');
    params.category = Number(category);
  }
  if (flag === 'hidden') where.push('p.visible = 0');
  if (flag === 'featured') where.push('p.featured = 1');
  if (flag === 'no_picture') where.push('NOT EXISTS (SELECT 1 FROM shop_product_images i WHERE i.product_id = p.id)');
  if (flag === 'out') where.push("p.stock_status = 'out'");
  if (flag === 'sale') {
    where.push("p.sale_price IS NOT NULL AND p.sale_price > 0 AND p.sale_price < p.retail_price AND (p.sale_ends_at IS NULL OR p.sale_ends_at > @now)");
    params.now = new Date().toISOString();
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM shop_products p ${whereSql}`).get(params).n;
  const rows = db
    .prepare(
      `SELECT p.*, c.name AS category_name FROM shop_products p LEFT JOIN shop_categories c ON c.id = p.category_id
       ${whereSql} ORDER BY p.category_id, p.display_order, p.name COLLATE NOCASE LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
    )
    .all(params);
  res.json({ products: rows.map(adminProduct), total, page, pageSize: PAGE_SIZE, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)) });
});

router.get('/products/:id', view, (req, res) => {
  const p = db.prepare('SELECT p.*, c.name AS category_name FROM shop_products p LEFT JOIN shop_categories c ON c.id = p.category_id WHERE p.id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Product not found' });
  const images = db.prepare('SELECT id, position FROM shop_product_images WHERE product_id = ? ORDER BY position, id').all(p.id);
  res.json({ product: { ...adminProduct(p), images } });
});

function productFields(b, existing) {
  const name = text(b.name, 200);
  if (!name) return { error: 'Name is required' };
  const sku = text(b.sku, 40);
  if (!sku) return { error: 'SKU is required' };
  const retail = Number(b.retail_price);
  if (!Number.isFinite(retail) || retail < 0) return { error: 'Retail price must be a number' };
  let sale = null;
  if (b.sale_price !== null && b.sale_price !== '' && b.sale_price !== undefined) {
    sale = Number(b.sale_price);
    if (!Number.isFinite(sale) || sale <= 0) return { error: 'Sale price must be a positive number (or leave it blank)' };
    if (sale >= retail) return { error: 'Sale price must be lower than the retail price' };
  }
  const ends = validIso(b.sale_ends_at, 'Sale end');
  if (ends.error) return { error: ends.error };
  const stock = STOCK_STATUSES.includes(b.stock_status) ? b.stock_status : existing ? existing.stock_status : 'in_stock';
  const categoryId = b.category_id === null || b.category_id === '' || b.category_id === undefined ? null : Number(b.category_id);
  if (categoryId !== null && !db.prepare('SELECT 1 FROM shop_categories WHERE id = ?').get(categoryId)) return { error: 'Choose a valid category' };
  return {
    sku,
    name,
    brand: text(b.brand, 60),
    model: text(b.model, 80),
    size: text(b.size, 40),
    category_id: categoryId,
    group_label: text(b.group_label, 80),
    description: text(b.description, 4000),
    highlights: String(b.highlights || '').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 12).join('\n').slice(0, 1500),
    warranty_note: text(b.warranty_note, 200),
    retail_price: round2(retail),
    sale_price: sale === null ? null : round2(sale),
    sale_ends_at: sale === null ? null : ends.value,
    stock_status: stock,
    featured: b.featured ? 1 : 0,
    visible: b.visible === false || b.visible === 0 ? 0 : 1,
    display_order: Number.parseInt(b.display_order, 10) || 0,
  };
}

const PRODUCT_COLS = ['sku', 'name', 'brand', 'model', 'size', 'category_id', 'group_label', 'description', 'highlights', 'warranty_note', 'retail_price', 'sale_price', 'sale_ends_at', 'stock_status', 'featured', 'visible', 'display_order'];

router.post('/products', manage, (req, res) => {
  const f = productFields(req.body || {});
  if (f.error) return bad(res, f.error);
  if (db.prepare('SELECT 1 FROM shop_products WHERE sku = ?').get(f.sku)) return res.status(409).json({ error: 'A product with that SKU already exists' });
  const info = db
    .prepare(`INSERT INTO shop_products (${PRODUCT_COLS.join(', ')}) VALUES (${PRODUCT_COLS.map((c) => `@${c}`).join(', ')})`)
    .run(f);
  res.status(201).json({ product: adminProduct(db.prepare('SELECT * FROM shop_products WHERE id = ?').get(info.lastInsertRowid)) });
});

router.put('/products/:id', manage, (req, res) => {
  const cur = db.prepare('SELECT * FROM shop_products WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Product not found' });
  const f = productFields({ ...cur, ...(req.body || {}) }, cur);
  if (f.error) return bad(res, f.error);
  if (db.prepare('SELECT 1 FROM shop_products WHERE sku = ? AND id != ?').get(f.sku, cur.id)) return res.status(409).json({ error: 'Another product already uses that SKU' });
  db.prepare(`UPDATE shop_products SET ${PRODUCT_COLS.map((c) => `${c} = @${c}`).join(', ')}, updated_at = datetime('now') WHERE id = @id`).run({ ...f, id: cur.id });
  res.json({ product: adminProduct(db.prepare('SELECT * FROM shop_products WHERE id = ?').get(cur.id)) });
});

router.delete('/products/:id', manage, (req, res) => {
  const used = db.prepare('SELECT COUNT(*) AS n FROM shop_order_items WHERE product_id = ?').get(req.params.id).n;
  if (used > 0) {
    // Keep order history intact: hide instead of deleting.
    db.prepare("UPDATE shop_products SET visible = 0, updated_at = datetime('now') WHERE id = ?").run(req.params.id);
    return res.json({ ok: true, hidden: true, message: 'This product is on past orders, so it was hidden instead of deleted.' });
  }
  db.prepare('DELETE FROM shop_products WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Pictures: uploaded as data URIs (the browser shrinks them first), stored as
// binary and served from /api/public/shop/images/:id.
router.post('/products/:id/images', manage, (req, res) => {
  const p = db.prepare('SELECT id FROM shop_products WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Product not found' });
  const list = Array.isArray(req.body && req.body.images) ? req.body.images : [];
  if (list.length === 0) return bad(res, 'Choose at least one picture');
  const have = db.prepare('SELECT COUNT(*) AS n FROM shop_product_images WHERE product_id = ?').get(p.id).n;
  if (have + list.length > MAX_IMAGES_PER_PRODUCT) return bad(res, `A product can have at most ${MAX_IMAGES_PER_PRODUCT} pictures`);
  const parsed = [];
  for (const uri of list) {
    const r = parseImage(uri);
    if (r.error) return bad(res, r.error);
    parsed.push(r);
  }
  const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM shop_product_images WHERE product_id = ?').get(p.id).m;
  const ins = db.prepare('INSERT INTO shop_product_images (product_id, mime, data, position) VALUES (?, ?, ?, ?)');
  db.transaction(() => parsed.forEach((r, i) => ins.run(p.id, r.mime, r.buffer, maxPos + 1 + i)))();
  res.status(201).json({ images: db.prepare('SELECT id, position FROM shop_product_images WHERE product_id = ? ORDER BY position, id').all(p.id) });
});

router.put('/products/:id/images/order', manage, (req, res) => {
  const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.map(Number) : [];
  const own = new Set(db.prepare('SELECT id FROM shop_product_images WHERE product_id = ?').all(req.params.id).map((r) => r.id));
  if (ids.length !== own.size || !ids.every((id) => own.has(id))) return bad(res, 'The picture order is not valid');
  const up = db.prepare('UPDATE shop_product_images SET position = ? WHERE id = ?');
  db.transaction(() => ids.forEach((id, i) => up.run(i, id)))();
  res.json({ ok: true });
});

router.delete('/products/:id/images/:imageId', manage, (req, res) => {
  db.prepare('DELETE FROM shop_product_images WHERE id = ? AND product_id = ?').run(req.params.imageId, req.params.id);
  res.json({ ok: true });
});

// Bulk actions on a set of product ids.
router.post('/products-bulk', manage, (req, res) => {
  const b = req.body || {};
  const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Number.isInteger).slice(0, 500);
  if (ids.length === 0) return bad(res, 'Select at least one product');
  const marks = ids.map(() => '?').join(',');
  const action = String(b.action || '');
  if (action === 'sale') {
    const pct = Number(b.percent);
    if (!Number.isFinite(pct) || pct <= 0 || pct >= 90) return bad(res, 'Discount must be between 1% and 89%');
    const ends = validIso(b.ends_at, 'Sale end');
    if (ends.error) return bad(res, ends.error);
    const rows = db.prepare(`SELECT id, retail_price FROM shop_products WHERE id IN (${marks})`).all(...ids);
    const up = db.prepare("UPDATE shop_products SET sale_price = ?, sale_ends_at = ?, updated_at = datetime('now') WHERE id = ?");
    db.transaction(() => rows.forEach((r) => up.run(Math.round(r.retail_price * (1 - pct / 100)), ends.value, r.id)))();
    return res.json({ ok: true, updated: rows.length });
  }
  const simple = {
    clear_sale: "UPDATE shop_products SET sale_price = NULL, sale_ends_at = NULL, updated_at = datetime('now') WHERE id IN",
    hide: "UPDATE shop_products SET visible = 0, updated_at = datetime('now') WHERE id IN",
    show: "UPDATE shop_products SET visible = 1, updated_at = datetime('now') WHERE id IN",
    feature: "UPDATE shop_products SET featured = 1, updated_at = datetime('now') WHERE id IN",
    unfeature: "UPDATE shop_products SET featured = 0, updated_at = datetime('now') WHERE id IN",
  };
  if (simple[action]) {
    const info = db.prepare(`${simple[action]} (${marks})`).run(...ids);
    return res.json({ ok: true, updated: info.changes });
  }
  if (action === 'stock') {
    if (!STOCK_STATUSES.includes(b.stock_status)) return bad(res, 'Choose a stock status');
    const info = db.prepare(`UPDATE shop_products SET stock_status = ?, updated_at = datetime('now') WHERE id IN (${marks})`).run(b.stock_status, ...ids);
    return res.json({ ok: true, updated: info.changes });
  }
  if (action === 'category') {
    const cid = b.category_id === null || b.category_id === '' ? null : Number(b.category_id);
    if (cid !== null && !db.prepare('SELECT 1 FROM shop_categories WHERE id = ?').get(cid)) return bad(res, 'Choose a valid category');
    const info = db.prepare(`UPDATE shop_products SET category_id = ?, updated_at = datetime('now') WHERE id IN (${marks})`).run(cid, ...ids);
    return res.json({ ok: true, updated: info.changes });
  }
  return bad(res, 'Unknown action');
});

router.post('/load-starter', manage, (req, res) => {
  res.json(loadStarterCatalogue());
});

// ---- promotions ---------------------------------------------------------
function promoFields(b, cur) {
  const title = text(b.title, 100);
  if (!title) return { error: 'Title is required' };
  const starts = validIso(b.starts_at, 'Start');
  const ends = validIso(b.ends_at, 'End');
  if (starts.error) return { error: starts.error };
  if (ends.error) return { error: ends.error };
  if (starts.value && ends.value && ends.value <= starts.value) return { error: 'The end must be after the start' };
  let image = cur ? cur.image : '';
  if (b.image === null || b.image === '') image = '';
  else if (typeof b.image === 'string' && b.image.startsWith('data:')) {
    const r = parseImage(b.image);
    if (r.error) return { error: r.error };
    image = b.image;
  }
  const link = text(b.link_path, 200) || '/sale';
  if (!link.startsWith('/')) return { error: 'The link must start with / (for example /sale or /category/air-conditioners)' };
  return {
    title,
    subtitle: text(b.subtitle, 240),
    badge: text(b.badge, 24) || 'FLASH SALE',
    cta_label: text(b.cta_label, 30) || 'Shop the sale',
    link_path: link,
    theme: PROMO_THEMES.includes(b.theme) ? b.theme : 'ember',
    image,
    starts_at: starts.value,
    ends_at: ends.value,
    active: b.active === false || b.active === 0 ? 0 : 1,
    show_on_main_site: b.show_on_main_site === false || b.show_on_main_site === 0 ? 0 : 1,
  };
}

const listPromo = (p) => ({ ...p, image: undefined, has_image: Boolean(p.image) });

router.get('/promotions', view, (req, res) => {
  res.json({ promotions: db.prepare('SELECT * FROM shop_promotions ORDER BY active DESC, COALESCE(ends_at, \'9999\') DESC, id DESC').all().map(listPromo) });
});

router.post('/promotions', manage, (req, res) => {
  const f = promoFields(req.body || {});
  if (f.error) return bad(res, f.error);
  const info = db
    .prepare(
      `INSERT INTO shop_promotions (title, subtitle, badge, cta_label, link_path, theme, image, starts_at, ends_at, active, show_on_main_site)
       VALUES (@title, @subtitle, @badge, @cta_label, @link_path, @theme, @image, @starts_at, @ends_at, @active, @show_on_main_site)`,
    )
    .run(f);
  res.status(201).json({ promotion: listPromo(db.prepare('SELECT * FROM shop_promotions WHERE id = ?').get(info.lastInsertRowid)) });
});

router.put('/promotions/:id', manage, (req, res) => {
  const cur = db.prepare('SELECT * FROM shop_promotions WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Promotion not found' });
  const f = promoFields({ ...cur, ...(req.body || {}), image: req.body && 'image' in req.body ? req.body.image : cur.image }, cur);
  if (f.error) return bad(res, f.error);
  db.prepare(
    `UPDATE shop_promotions SET title=@title, subtitle=@subtitle, badge=@badge, cta_label=@cta_label, link_path=@link_path, theme=@theme,
       image=@image, starts_at=@starts_at, ends_at=@ends_at, active=@active, show_on_main_site=@show_on_main_site, updated_at=datetime('now') WHERE id=@id`,
  ).run({ ...f, id: cur.id });
  res.json({ promotion: listPromo(db.prepare('SELECT * FROM shop_promotions WHERE id = ?').get(cur.id)) });
});

router.delete('/promotions/:id', manage, (req, res) => {
  db.prepare('DELETE FROM shop_promotions WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.get('/promotions/:id/email-preview', view, (req, res) => {
  const promo = db.prepare('SELECT * FROM shop_promotions WHERE id = ?').get(req.params.id);
  if (!promo) return res.status(404).json({ error: 'Promotion not found' });
  const { html, products } = renderPromoEmail(promo);
  res.json({ html, products, subject: `${promo.badge}: ${promo.title}` });
});

// Sends the promotion email. `audience: 'test'` goes only to the sender (or a
// given address); `'clients'` goes to every client with an email on file.
router.post('/promotions/:id/send-email', manage, async (req, res) => {
  const promo = db.prepare('SELECT * FROM shop_promotions WHERE id = ?').get(req.params.id);
  if (!promo) return res.status(404).json({ error: 'Promotion not found' });
  if (!isEmailConfigured()) return res.status(503).json({ error: 'Email is not configured on the server' });
  const audience = req.body && req.body.audience === 'clients' ? 'clients' : 'test';
  const { html } = renderPromoEmail(promo);
  const subject = text(req.body && req.body.subject, 160) || `${promo.badge}: ${promo.title}`;

  let recipients;
  if (audience === 'test') {
    const to = text(req.body && req.body.test_to, 200) || req.user.email;
    if (!EMAIL_RE.test(to)) return bad(res, 'Enter a valid test email address');
    recipients = [{ email: to, name: 'Test' }];
  } else {
    recipients = db
      .prepare("SELECT id, name, email FROM clients WHERE email != ''")
      .all()
      .map((c) => ({ id: c.id, name: c.name, email: splitEmails(c.email)[0] }))
      .filter((c) => c.email && EMAIL_RE.test(c.email));
    if (recipients.length === 0) return bad(res, 'No clients have an email address on file');
  }

  let sent = 0;
  const failures = [];
  for (const r of recipients) {
    try {
      await sendMail({ to: r.email, subject, html });
      sent += 1;
      if (audience === 'clients') {
        try {
          logEmail({ type: 'shop_promo', to: r.email, subject, sentByName: req.user.name, entityType: 'client', entityId: r.id, entityLabel: r.name });
        } catch (err) {
          console.error('email log failed', err.message);
        }
      }
    } catch (err) {
      if (err && err.code === 'EMAIL_NOT_CONFIGURED') return res.status(503).json({ error: 'Email is not configured on the server' });
      failures.push({ email: r.email, error: String(err.message || err).slice(0, 120) });
    }
  }
  res.json({ ok: true, audience, sent, failed: failures.length, failures: failures.slice(0, 10) });
});

// ---- orders -------------------------------------------------------------
router.get('/orders', view, (req, res) => {
  const status = text(req.query.status, 20);
  const q = text(req.query.q, 80);
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const where = [];
  const params = {};
  if (ORDER_STATUSES.includes(status)) {
    where.push('status = @status');
    params.status = status;
  } else if (status === 'open') where.push("status NOT IN ('delivered', 'cancelled')");
  if (q) {
    where.push('(number LIKE @like OR customer_name LIKE @like OR phone LIKE @like OR island LIKE @like)');
    params.like = `%${q.replace(/[%_]/g, '')}%`;
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM shop_orders ${whereSql}`).get(params).n;
  const rows = db
    .prepare(`SELECT * FROM shop_orders ${whereSql} ORDER BY id DESC LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`)
    .all(params);
  const itemCount = db.prepare('SELECT COALESCE(SUM(quantity), 0) AS n FROM shop_order_items WHERE order_id = ?');
  res.json({
    orders: rows.map((o) => ({ ...o, item_count: itemCount.get(o.id).n })),
    total, page, pageSize: PAGE_SIZE, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
});

router.get('/orders/:id', view, (req, res) => {
  const order = db.prepare('SELECT * FROM shop_orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const items = db.prepare('SELECT * FROM shop_order_items WHERE order_id = ? ORDER BY id').all(order.id);
  const invoice = order.invoice_id ? db.prepare('SELECT id, number, status FROM invoices WHERE id = ?').get(order.invoice_id) : null;
  res.json({ order, items, invoice });
});

router.put('/orders/:id', manage, (req, res) => {
  const cur = db.prepare('SELECT * FROM shop_orders WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Order not found' });
  const b = req.body || {};
  const status = b.status === undefined ? cur.status : b.status;
  const pay = b.payment_status === undefined ? cur.payment_status : b.payment_status;
  if (!ORDER_STATUSES.includes(status)) return bad(res, 'Unknown order status');
  if (!PAYMENT_STATUSES.includes(pay)) return bad(res, 'Unknown payment status');
  db.prepare("UPDATE shop_orders SET status = ?, payment_status = ?, staff_notes = ?, updated_at = datetime('now') WHERE id = ?").run(
    status, pay, b.staff_notes === undefined ? cur.staff_notes : text(b.staff_notes, 2000), cur.id,
  );
  res.json({ order: db.prepare('SELECT * FROM shop_orders WHERE id = ?').get(cur.id) });
});

// Turns an order into a real client + draft invoice (so it flows into
// payments, receipts and the financials like any other sale).
router.post('/orders/:id/create-invoice', manage, requirePermission('invoices', 'manage'), requirePermission('clients', 'manage'), (req, res) => {
  const order = db.prepare('SELECT * FROM shop_orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.invoice_id) return res.status(409).json({ error: 'This order already has an invoice' });
  const items = db.prepare('SELECT * FROM shop_order_items WHERE order_id = ? ORDER BY id').all(order.id);
  if (items.length === 0) return bad(res, 'This order has no items');

  const run = db.transaction(() => {
    let client = null;
    if (order.email) client = db.prepare('SELECT * FROM clients WHERE LOWER(email) = ?').get(order.email.toLowerCase());
    if (!client && order.phone) client = db.prepare("SELECT * FROM clients WHERE phone != '' AND phone = ?").get(order.phone);
    if (!client) {
      const info = db
        .prepare('INSERT INTO clients (name, email, phone, address, notes) VALUES (?, ?, ?, ?, ?)')
        .run(order.customer_name, order.email || '', order.phone, [order.island, order.address].filter(Boolean).join(', '), `Shop customer (order ${order.number})`);
      client = db.prepare('SELECT * FROM clients WHERE id = ?').get(info.lastInsertRowid);
    }
    const t = computeTotals(
      items.map((i) => ({ description: i.sku ? `${i.name} (${i.sku})` : i.name, quantity: i.quantity, unit_price: i.unit_price })),
      0, 'percentage', 0,
    );
    const number = nextInvoiceNumber();
    const today = todayStr();
    const inv = db
      .prepare(
        `INSERT INTO invoices (number, client_id, status, issue_date, due_date, notes, discount_type, discount_value,
           subtotal, discount_amount, tax_rate, tax_amount, total, public_token, created_by_name, po_number)
         VALUES (?, ?, 'draft', ?, ?, ?, 'percentage', 0, ?, 0, 0, 0, ?, ?, ?, ?)`,
      )
      .run(number, client.id, today, today, `Shop order ${order.number}. Deliver to ${order.island}${order.boat ? `, boat ${order.boat}` : ''}.`, t.subtotal, t.total, newToken(), req.user.name, order.number);
    const ins = db.prepare('INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount, sort_order, product_id) VALUES (?, ?, ?, ?, ?, ?, NULL)');
    t.items.forEach((i, idx) => ins.run(inv.lastInsertRowid, i.description, i.quantity, i.unit_price, i.amount, idx));
    stampItemCosts(inv.lastInsertRowid);
    db.prepare("UPDATE shop_orders SET client_id = ?, invoice_id = ?, status = CASE WHEN status = 'new' THEN 'confirmed' ELSE status END, updated_at = datetime('now') WHERE id = ?").run(client.id, inv.lastInsertRowid, order.id);
    return { invoice_id: Number(inv.lastInsertRowid), number, client_id: client.id };
  });
  res.status(201).json(run());
});

module.exports = router;
