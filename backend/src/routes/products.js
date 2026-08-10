const { Router } = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../lib/activity');

const router = Router();
router.use(requireAuth);
const view = requirePermission('products', 'view');
const manage = requirePermission('products', 'manage');

const PAGE_SIZE = 20;

router.get('/', view, (req, res) => {
  const { q, page: pageParam } = req.query;
  const where = q ? 'WHERE name LIKE ? OR description LIKE ?' : '';
  const params = q ? [`%${q}%`, `%${q}%`] : [];

  if (!pageParam) {
    const products = db.prepare(`SELECT * FROM products ${where} ORDER BY name`).all(...params);
    return res.json({ products });
  }

  const page = Math.max(1, Number(pageParam) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM products ${where}`).get(...params);
  const products = db
    .prepare(`SELECT * FROM products ${where} ORDER BY name LIMIT ? OFFSET ?`)
    .all(...params, PAGE_SIZE, offset);
  res.json({ products, page, pageSize: PAGE_SIZE, total, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)) });
});

router.post('/', manage, (req, res) => {
  const { name, description = '', unit_price = 0, tax_rate = 0 } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const priceNum = Number(unit_price);
  if (!Number.isFinite(priceNum) || priceNum < 0) {
    return res.status(400).json({ error: 'unit_price must be a non-negative number' });
  }
  const taxNum = Number(tax_rate);
  if (!Number.isFinite(taxNum) || taxNum < 0 || taxNum > 100) {
    return res.status(400).json({ error: 'tax_rate must be a number between 0 and 100' });
  }

  const result = db
    .prepare('INSERT INTO products (name, description, unit_price, tax_rate) VALUES (?, ?, ?, ?)')
    .run(name.trim(), description, priceNum, taxNum);
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid);
  logActivity({ userName: req.user.name, action: 'created', entityType: 'product', entityId: product.id, entityLabel: product.name });
  res.status(201).json({ product });
});

router.put('/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found' });

  const { name, description = '', unit_price = 0, tax_rate = 0 } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const priceNum = Number(unit_price);
  if (!Number.isFinite(priceNum) || priceNum < 0) {
    return res.status(400).json({ error: 'unit_price must be a non-negative number' });
  }
  const taxNum = Number(tax_rate);
  if (!Number.isFinite(taxNum) || taxNum < 0 || taxNum > 100) {
    return res.status(400).json({ error: 'tax_rate must be a number between 0 and 100' });
  }

  db.prepare(
    `UPDATE products SET name = ?, description = ?, unit_price = ?, tax_rate = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(name.trim(), description, priceNum, taxNum, req.params.id);

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  logActivity({ userName: req.user.name, action: 'updated', entityType: 'product', entityId: product.id, entityLabel: product.name });
  res.json({ product });
});

router.delete('/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found' });

  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  logActivity({ userName: req.user.name, action: 'deleted', entityType: 'product', entityId: existing.id, entityLabel: existing.name });
  res.status(204).end();
});

module.exports = router;
