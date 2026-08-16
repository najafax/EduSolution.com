const { Router } = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { computeTotals } = require('../lib/totals');
const { logActivity } = require('../lib/activity');

const router = Router();
router.use(requireAuth);
const view = requirePermission('recurring_invoices', 'view');
const manage = requirePermission('recurring_invoices', 'manage');

const FREQUENCIES = ['weekly', 'monthly', 'yearly'];

function getWithItems(id) {
  const recurring = db.prepare('SELECT * FROM recurring_invoices WHERE id = ?').get(id);
  if (!recurring) return null;
  const items = db
    .prepare('SELECT * FROM recurring_invoice_items WHERE recurring_invoice_id = ? ORDER BY sort_order')
    .all(id);
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(recurring.client_id);
  return { recurring, items, client };
}

function saveItems(recurringId, items) {
  db.prepare('DELETE FROM recurring_invoice_items WHERE recurring_invoice_id = ?').run(recurringId);
  const insert = db.prepare(
    'INSERT INTO recurring_invoice_items (recurring_invoice_id, description, quantity, unit_price, sort_order) VALUES (?, ?, ?, ?, ?)',
  );
  items.forEach((item, index) => {
    insert.run(recurringId, item.description, item.quantity, item.unit_price, index);
  });
}

function validateAndComputePreview(body) {
  const { tax_rate = 0, discount_type = 'percentage', discount_value = 0, items } = body;
  // Reuses computeTotals purely for validation/normalization of items+tax+discount;
  // amounts aren't persisted here since the real total is computed fresh each
  // time an invoice is generated (unit prices could still change meanwhile).
  return computeTotals(items, tax_rate, discount_type, discount_value);
}

const PAGE_SIZE = 20;

router.get('/', view, (req, res) => {
  const { q, page: pageParam } = req.query;
  const where = q ? 'WHERE clients.name LIKE ? OR recurring_invoices.frequency LIKE ?' : '';
  const params = q ? [`%${q}%`, `%${q}%`] : [];
  const baseFrom = 'FROM recurring_invoices JOIN clients ON clients.id = recurring_invoices.client_id';

  if (!pageParam) {
    const rows = db
      .prepare(`SELECT recurring_invoices.*, clients.name AS client_name ${baseFrom} ${where} ORDER BY recurring_invoices.next_run_date`)
      .all(...params);
    return res.json({ recurringInvoices: rows });
  }

  const page = Math.max(1, Number(pageParam) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const { total } = db.prepare(`SELECT COUNT(*) AS total ${baseFrom} ${where}`).get(...params);
  const rows = db
    .prepare(
      `SELECT recurring_invoices.*, clients.name AS client_name ${baseFrom} ${where}
       ORDER BY recurring_invoices.next_run_date LIMIT ? OFFSET ?`,
    )
    .all(...params, PAGE_SIZE, offset);
  res.json({
    recurringInvoices: rows,
    page,
    pageSize: PAGE_SIZE,
    total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
});

router.get('/:id', view, (req, res) => {
  const data = getWithItems(req.params.id);
  if (!data) return res.status(404).json({ error: 'Recurring invoice not found' });
  res.json(data);
});

router.post('/', manage, (req, res) => {
  const {
    client_id,
    frequency = 'monthly',
    tax_rate = 0,
    discount_type = 'percentage',
    discount_value = 0,
    due_in_days = 14,
    next_run_date,
    notes = '',
    items,
  } = req.body || {};

  if (!client_id || !next_run_date) {
    return res.status(400).json({ error: 'client_id and next_run_date are required' });
  }
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(client_id);
  if (!client) return res.status(400).json({ error: 'Unknown client_id' });
  if (!FREQUENCIES.includes(frequency)) {
    return res.status(400).json({ error: `frequency must be one of: ${FREQUENCIES.join(', ')}` });
  }

  let totals;
  try {
    totals = validateAndComputePreview({ tax_rate, discount_type, discount_value, items });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const result = db
    .prepare(
      `INSERT INTO recurring_invoices (client_id, frequency, notes, discount_type, discount_value, tax_rate, due_in_days, next_run_date, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    )
    .run(client_id, frequency, notes, totals.discountType, totals.discountValue, totals.taxRate, Number(due_in_days), next_run_date);

  saveItems(result.lastInsertRowid, totals.items);
  logActivity({
    userName: req.user.name,
    action: 'created',
    entityType: 'recurring invoice',
    entityId: result.lastInsertRowid,
    entityLabel: `${client.name} (${frequency})`,
  });

  res.status(201).json(getWithItems(result.lastInsertRowid));
});

router.put('/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM recurring_invoices WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Recurring invoice not found' });

  const {
    client_id,
    frequency = 'monthly',
    tax_rate = 0,
    discount_type = 'percentage',
    discount_value = 0,
    due_in_days = 14,
    next_run_date,
    notes = '',
    active,
    items,
  } = req.body || {};

  if (!client_id || !next_run_date) {
    return res.status(400).json({ error: 'client_id and next_run_date are required' });
  }
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(client_id);
  if (!client) return res.status(400).json({ error: 'Unknown client_id' });
  if (!FREQUENCIES.includes(frequency)) {
    return res.status(400).json({ error: `frequency must be one of: ${FREQUENCIES.join(', ')}` });
  }

  let totals;
  try {
    totals = validateAndComputePreview({ tax_rate, discount_type, discount_value, items });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  db.prepare(
    `UPDATE recurring_invoices SET client_id = ?, frequency = ?, notes = ?, discount_type = ?, discount_value = ?,
       tax_rate = ?, due_in_days = ?, next_run_date = ?, active = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(
    client_id,
    frequency,
    notes,
    totals.discountType,
    totals.discountValue,
    totals.taxRate,
    Number(due_in_days),
    next_run_date,
    active === false ? 0 : 1,
    req.params.id,
  );

  saveItems(req.params.id, totals.items);
  logActivity({ userName: req.user.name, action: 'updated', entityType: 'recurring invoice', entityId: Number(req.params.id), entityLabel: client.name });

  res.json(getWithItems(req.params.id));
});

router.delete('/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM recurring_invoices WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Recurring invoice not found' });

  db.prepare('DELETE FROM recurring_invoices WHERE id = ?').run(req.params.id);
  logActivity({ userName: req.user.name, action: 'deleted', entityType: 'recurring invoice', entityId: existing.id, entityLabel: '' });
  res.status(204).end();
});

module.exports = router;
