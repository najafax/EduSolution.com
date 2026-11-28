const crypto = require('crypto');
const db = require('../db');
const { businessYear } = require('./businessDate');

// Shared pieces of the retail shop: pricing rules, product shaping for the
// public storefront, order numbers, and the starter catalogue loader.

const STOCK_STATUSES = ['in_stock', 'low', 'on_request', 'out'];
const ORDER_STATUSES = ['new', 'confirmed', 'packed', 'dispatched', 'delivered', 'cancelled'];
const PAYMENT_METHODS = ['cod', 'bank_transfer', 'card'];
const PAYMENT_STATUSES = ['unpaid', 'paid', 'refunded'];
const PROMO_THEMES = ['ember', 'ocean', 'forest', 'ink'];

const round2 = (n) => Math.round(n * 100) / 100;

function nowIso() {
  return new Date().toISOString();
}

// SQLite stores ends_at as given by the admin form (an ISO-like string). A
// sale price only counts while its end time (if any) is in the future.
function saleActive(p, now = Date.now()) {
  if (p.sale_price == null || !(Number(p.sale_price) > 0)) return false;
  if (!(Number(p.sale_price) < Number(p.retail_price))) return false;
  if (!p.sale_ends_at) return true;
  const t = Date.parse(p.sale_ends_at);
  return Number.isFinite(t) ? t > now : true;
}

function effectivePrice(p, now) {
  return saleActive(p, now) ? Number(p.sale_price) : Number(p.retail_price);
}

// What the public storefront sees. Never exposes anything but retail/sale
// pricing — there is no wholesale figure anywhere in these tables.
function publicProduct(p, imageIds = [], now) {
  const onSale = saleActive(p, now);
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    brand: p.brand,
    model: p.model,
    size: p.size,
    category_id: p.category_id,
    category_slug: p.category_slug || null,
    category_name: p.category_name || null,
    group_label: p.group_label,
    description: p.description,
    highlights: String(p.highlights || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
    warranty_note: p.warranty_note,
    retail_price: Number(p.retail_price),
    price: effectivePrice(p, now),
    on_sale: onSale,
    discount_percent: onSale ? Math.round((1 - Number(p.sale_price) / Number(p.retail_price)) * 100) : 0,
    sale_ends_at: onSale ? p.sale_ends_at : null,
    stock_status: p.stock_status,
    featured: Boolean(p.featured),
    images: imageIds,
    created_at: p.created_at,
  };
}

function imageIdsFor(productIds) {
  if (productIds.length === 0) return new Map();
  const rows = db
    .prepare(
      `SELECT id, product_id FROM shop_product_images
       WHERE product_id IN (${productIds.map(() => '?').join(',')})
       ORDER BY position, id`,
    )
    .all(...productIds);
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.product_id)) map.set(r.product_id, []);
    map.get(r.product_id).push(r.id);
  }
  return map;
}

function nextOrderNumber() {
  const base = `S-${businessYear()}-`;
  const { maxSeq } = db
    .prepare('SELECT MAX(CAST(SUBSTR(number, ?) AS INTEGER)) AS maxSeq FROM shop_orders WHERE number LIKE ?')
    .get(base.length + 1, `${base}%`);
  return `${base}${String((maxSeq || 0) + 1).padStart(4, '0')}`;
}

const newToken = () => crypto.randomBytes(16).toString('hex');

function slugify(text) {
  return (
    String(text || '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'category'
  );
}

// Loads backend/data/shop-seed.json (retail prices only) idempotently by SKU:
// existing products keep their photos, descriptions and stock settings; only
// brand/model/size/category are filled in when blank and the retail price is
// refreshed from the file. Returns counts.
function loadStarterCatalogue() {
  const seed = require('../../data/shop-seed.json');
  let created = 0;
  let updated = 0;
  db.transaction(() => {
    const catId = new Map();
    seed.categories.forEach((c, i) => {
      db.prepare('INSERT OR IGNORE INTO shop_categories (slug, name, display_order) VALUES (?, ?, ?)').run(c.slug, c.name, i);
      catId.set(c.slug, db.prepare('SELECT id FROM shop_categories WHERE slug = ?').get(c.slug).id);
    });
    for (const p of seed.products) {
      const existing = db.prepare('SELECT id FROM shop_products WHERE sku = ?').get(p.sku);
      if (existing) {
        db.prepare(
          `UPDATE shop_products SET retail_price = ?, updated_at = datetime('now'),
             brand = CASE WHEN brand = '' THEN ? ELSE brand END,
             model = CASE WHEN model = '' THEN ? ELSE model END,
             size = CASE WHEN size = '' THEN ? ELSE size END,
             group_label = CASE WHEN group_label = '' THEN ? ELSE group_label END
           WHERE id = ?`,
        ).run(p.retail_price, p.brand || '', p.model || '', p.size || '', p.group || '', existing.id);
        updated += 1;
      } else {
        db.prepare(
          `INSERT INTO shop_products (sku, name, brand, model, size, category_id, group_label, retail_price)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(p.sku, p.name, p.brand || '', p.model || '', p.size || '', catId.get(p.category) || null, p.group || '', p.retail_price);
        created += 1;
      }
    }
  })();
  return { created, updated, total: seed.products.length };
}

module.exports = {
  STOCK_STATUSES,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PROMO_THEMES,
  round2,
  nowIso,
  saleActive,
  effectivePrice,
  publicProduct,
  imageIdsFor,
  nextOrderNumber,
  newToken,
  slugify,
  loadStarterCatalogue,
};
