const { Router } = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../lib/activity');

const router = Router();
router.use(requireAuth);
const view = requirePermission('products', 'view');
const manage = requirePermission('products', 'manage');

router.get('/', view, (req, res) => {
  const { q } = req.query;
  const products = q
    ? db
        .prepare('SELECT * FROM products WHERE name LIKE ? OR description LIKE ? ORDER BY name')
        .all(`%${q}%`, `%${q}%`)
    : db.prepare('SELECT * FROM products ORDER BY name').all();
  res.json({ products });
});

router.post('/', manage, (req, res) => {
  const { name, description = '', unit_price = 0 } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const priceNum = Number(unit_price);
  if (!Number.isFinite(priceNum) || priceNum < 0) {
    return res.status(400).json({ error: 'unit_price must be a non-negative number' });
  }

  const result = db
    .prepare('INSERT INTO products (name, description, unit_price) VALUES (?, ?, ?)')
    .run(name.trim(), description, priceNum);
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid);
  logActivity({ userName: req.user.name, action: 'created', entityType: 'product', entityId: product.id, entityLabel: product.name });
  res.status(201).json({ product });
});

router.put('/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found' });

  const { name, description = '', unit_price = 0 } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const priceNum = Number(unit_price);
  if (!Number.isFinite(priceNum) || priceNum < 0) {
    return res.status(400).json({ error: 'unit_price must be a non-negative number' });
  }

  db.prepare(
    `UPDATE products SET name = ?, description = ?, unit_price = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(name.trim(), description, priceNum, req.params.id);

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
