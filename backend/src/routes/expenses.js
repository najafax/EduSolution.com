const { Router } = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../lib/activity');
const { toCsv } = require('../lib/csv');

const router = Router();
router.use(requireAuth);
const view = requirePermission('expenses', 'view');
const manage = requirePermission('expenses', 'manage');

const CATEGORIES = ['rent', 'utilities', 'supplies', 'salaries', 'marketing', 'software', 'travel', 'other'];

router.get('/', view, (req, res) => {
  const { q } = req.query;
  const rows = q
    ? db
        .prepare('SELECT * FROM expenses WHERE description LIKE ? OR category LIKE ? ORDER BY expense_date DESC, id DESC')
        .all(`%${q}%`, `%${q}%`)
    : db.prepare('SELECT * FROM expenses ORDER BY expense_date DESC, id DESC').all();
  res.json({ expenses: rows, categories: CATEGORIES });
});

router.get('/export.csv', view, (req, res) => {
  const rows = db.prepare('SELECT * FROM expenses ORDER BY expense_date DESC, id DESC').all();
  const csv = toCsv(rows, [
    { label: 'Date', key: 'expense_date' },
    { label: 'Category', key: 'category' },
    { label: 'Description', key: 'description' },
    { label: 'Amount', key: 'amount' },
    { label: 'Notes', key: 'notes' },
  ]);
  res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="expenses.csv"' });
  res.send(csv);
});

function validate(body) {
  const { category = 'other', description, amount, expense_date } = body || {};
  if (!description || !amount || !expense_date) {
    return 'description, amount and expense_date are required';
  }
  const amountNum = Number(amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    return 'amount must be a positive number';
  }
  if (!CATEGORIES.includes(category)) {
    return `category must be one of: ${CATEGORIES.join(', ')}`;
  }
  return null;
}

router.post('/', manage, (req, res) => {
  const error = validate(req.body);
  if (error) return res.status(400).json({ error });

  const { category = 'other', description, amount, expense_date, notes = '' } = req.body;
  const result = db
    .prepare('INSERT INTO expenses (category, description, amount, expense_date, notes) VALUES (?, ?, ?, ?, ?)')
    .run(category, description.trim(), Number(amount), expense_date, notes);

  const expense = db.prepare('SELECT * FROM expenses WHERE id = ?').get(result.lastInsertRowid);
  logActivity({ userName: req.user.name, action: 'created', entityType: 'expense', entityId: expense.id, entityLabel: expense.description });
  res.status(201).json({ expense });
});

router.put('/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Expense not found' });

  const error = validate(req.body);
  if (error) return res.status(400).json({ error });

  const { category = 'other', description, amount, expense_date, notes = '' } = req.body;
  db.prepare(
    `UPDATE expenses SET category = ?, description = ?, amount = ?, expense_date = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(category, description.trim(), Number(amount), expense_date, notes, req.params.id);

  const expense = db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
  logActivity({ userName: req.user.name, action: 'updated', entityType: 'expense', entityId: expense.id, entityLabel: expense.description });
  res.json({ expense });
});

router.delete('/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Expense not found' });

  db.prepare('DELETE FROM expenses WHERE id = ?').run(req.params.id);
  logActivity({ userName: req.user.name, action: 'deleted', entityType: 'expense', entityId: existing.id, entityLabel: existing.description });
  res.status(204).end();
});

module.exports = router;
