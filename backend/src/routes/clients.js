const { Router } = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
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

router.post('/', (req, res) => {
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
  res.status(201).json({ client });
});

router.get('/:id', (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  res.json({ client });
});

router.put('/:id', (req, res) => {
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
  res.json({ client });
});

router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Client not found' });

  const hasQuotes = db.prepare('SELECT 1 FROM quotes WHERE client_id = ? LIMIT 1').get(req.params.id);
  const hasInvoices = db.prepare('SELECT 1 FROM invoices WHERE client_id = ? LIMIT 1').get(req.params.id);
  if (hasQuotes || hasInvoices) {
    return res.status(409).json({ error: 'This client has quotes or invoices and cannot be deleted' });
  }

  db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
