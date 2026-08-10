const { Router } = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../lib/activity');
const { toCsv } = require('../lib/csv');

const router = Router();
router.use(requireAuth);
const view = requirePermission('clients', 'view');
const manage = requirePermission('clients', 'manage');

router.get('/', view, (req, res) => {
  const { q } = req.query;
  const clients = q
    ? db
        .prepare(
          `SELECT * FROM clients WHERE name LIKE ? OR email LIKE ? OR company LIKE ? ORDER BY name`,
        )
        .all(`%${q}%`, `%${q}%`, `%${q}%`)
    : db.prepare('SELECT * FROM clients ORDER BY name').all();
  res.json({ clients });
});

router.get('/export.csv', view, (req, res) => {
  const rows = db.prepare('SELECT * FROM clients ORDER BY name').all();
  const csv = toCsv(rows, [
    { label: 'Name', key: 'name' },
    { label: 'Company', key: 'company' },
    { label: 'Email', key: 'email' },
    { label: 'Phone', key: 'phone' },
    { label: 'Address', key: 'address' },
    { label: 'Notes', key: 'notes' },
  ]);
  res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="clients.csv"' });
  res.send(csv);
});

router.post('/', manage, (req, res) => {
  const { name, email, phone = '', company = '', address = '', notes = '' } = req.body || {};
  if (!name || !email) {
    return res.status(400).json({ error: 'name and email are required' });
  }
  const result = db
    .prepare(
      'INSERT INTO clients (name, email, phone, company, address, notes) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(name.trim(), email.trim(), phone, company, address, notes);
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

  const { name, email, phone = '', company = '', address = '', notes = '' } = req.body || {};
  if (!name || !email) {
    return res.status(400).json({ error: 'name and email are required' });
  }

  db.prepare(
    `UPDATE clients SET name = ?, email = ?, phone = ?, company = ?, address = ?, notes = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(name.trim(), email.trim(), phone, company, address, notes, req.params.id);

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  logActivity({ userName: req.user.name, action: 'updated', entityType: 'client', entityId: client.id, entityLabel: client.name });
  res.json({ client });
});

router.delete('/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Client not found' });

  const hasQuotes = db.prepare('SELECT 1 FROM quotes WHERE client_id = ? LIMIT 1').get(req.params.id);
  const hasInvoices = db.prepare('SELECT 1 FROM invoices WHERE client_id = ? LIMIT 1').get(req.params.id);
  if (hasQuotes || hasInvoices) {
    return res.status(409).json({ error: 'This client has quotes or invoices and cannot be deleted' });
  }

  db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
  logActivity({ userName: req.user.name, action: 'deleted', entityType: 'client', entityId: existing.id, entityLabel: existing.name });
  res.status(204).end();
});

module.exports = router;
