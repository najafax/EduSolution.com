const { Router } = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../lib/activity');
const { toCsv } = require('../lib/csv');

const router = Router();
router.use(requireAuth);
const view = requirePermission('clients', 'view');
const manage = requirePermission('clients', 'manage');

const PAGE_SIZE = 20;

router.get('/', view, (req, res) => {
  const { q, page: pageParam } = req.query;
  const where = q ? 'WHERE name LIKE ? OR email LIKE ?' : '';
  const params = q ? [`%${q}%`, `%${q}%`] : [];

  if (!pageParam) {
    const clients = db.prepare(`SELECT * FROM clients ${where} ORDER BY name`).all(...params);
    return res.json({ clients });
  }

  const page = Math.max(1, Number(pageParam) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM clients ${where}`).get(...params);
  const clients = db
    .prepare(`SELECT * FROM clients ${where} ORDER BY name LIMIT ? OFFSET ?`)
    .all(...params, PAGE_SIZE, offset);
  res.json({ clients, page, pageSize: PAGE_SIZE, total, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)) });
});

router.get('/export.csv', view, (req, res) => {
  const rows = db.prepare('SELECT * FROM clients ORDER BY name').all();
  const csv = toCsv(rows, [
    { label: 'Name', key: 'name' },
    { label: 'Email', key: 'email' },
    { label: 'Phone', key: 'phone' },
    { label: 'Address', key: 'address' },
    { label: 'Notes', key: 'notes' },
  ]);
  res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="clients.csv"' });
  res.send(csv);
});

router.post('/', manage, (req, res) => {
  const { name, email, phone = '', address = '', notes = '' } = req.body || {};
  if (!name || !email) {
    return res.status(400).json({ error: 'name and email are required' });
  }
  const result = db
    .prepare('INSERT INTO clients (name, email, phone, address, notes) VALUES (?, ?, ?, ?, ?)')
    .run(name.trim(), email.trim(), phone, address, notes);
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(result.lastInsertRowid);
  logActivity({ userName: req.user.name, action: 'created', entityType: 'client', entityId: client.id, entityLabel: client.name });
  res.status(201).json({ client });
});

router.get('/:id', view, (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  res.json({ client });
});

router.put('/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Client not found' });

  const { name, email, phone = '', address = '', notes = '' } = req.body || {};
  if (!name || !email) {
    return res.status(400).json({ error: 'name and email are required' });
  }

  db.prepare(
    `UPDATE clients SET name = ?, email = ?, phone = ?, address = ?, notes = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(name.trim(), email.trim(), phone, address, notes, req.params.id);

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  logActivity({ userName: req.user.name, action: 'updated', entityType: 'client', entityId: client.id, entityLabel: client.name });
  res.json({ client });
});

router.delete('/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Client not found' });

  // Every one of these four tables has a NOT NULL REFERENCES clients(id)
  // (see db/index.js) with foreign_keys=ON enforced — deleting a client
  // that still has any of them would otherwise fail with an uncaught
  // SQLITE_CONSTRAINT_FOREIGNKEY error (a raw 500) instead of this same
  // friendly 409 the quotes/invoices case already had.
  const hasQuotes = db.prepare('SELECT 1 FROM quotes WHERE client_id = ? LIMIT 1').get(req.params.id);
  const hasInvoices = db.prepare('SELECT 1 FROM invoices WHERE client_id = ? LIMIT 1').get(req.params.id);
  const hasRecurring = db.prepare('SELECT 1 FROM recurring_invoices WHERE client_id = ? LIMIT 1').get(req.params.id);
  const hasLicenses = db.prepare('SELECT 1 FROM licenses WHERE client_id = ? LIMIT 1').get(req.params.id);
  if (hasQuotes || hasInvoices || hasRecurring || hasLicenses) {
    return res.status(409).json({ error: 'This client has quotes, invoices, recurring invoices, or licenses and cannot be deleted' });
  }

  db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
  logActivity({ userName: req.user.name, action: 'deleted', entityType: 'client', entityId: existing.id, entityLabel: existing.name });
  res.status(204).end();
});

module.exports = router;
