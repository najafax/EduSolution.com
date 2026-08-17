const { Router } = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../lib/activity');
const { toCsv } = require('../lib/csv');

const router = Router();
router.use(requireAuth);
const view = requirePermission('expenses', 'view');
const manage = requirePermission('expenses', 'manage');

const CATEGORIES = ['rent', 'utilities', 'supplies', 'salaries', 'shareholder payments', 'marketing', 'software', 'travel', 'currency exchange', 'other'];

const PAGE_SIZE = 20;

// `payees` mirrors the existing `categories` convention: served alongside
// the list itself, independent of whatever `q`/`category`/`payee` filter is
// currently applied, so the payee filter's own dropdown always offers every
// payee ever used rather than just whoever survived the current filter.
function distinctPayees() {
  return db
    .prepare("SELECT DISTINCT payee FROM expenses WHERE payee != '' ORDER BY payee COLLATE NOCASE")
    .all()
    .map((r) => r.payee);
}

router.get('/', view, (req, res) => {
  const { q, category, payee, page: pageParam } = req.query;
  const conditions = [];
  const params = [];
  if (q) {
    conditions.push('(description LIKE ? OR category LIKE ? OR payee LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (category) {
    conditions.push('category = ?');
    params.push(category);
  }
  if (payee) {
    conditions.push('payee = ?');
    params.push(payee);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  // Sum reflects every matching row, not just the current page, so the
  // "Total" row on the Expenses page stays accurate once pagination hides
  // rows from the client-side array it used to sum directly.
  const { totalAmount } = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS totalAmount FROM expenses ${where}`).get(...params);

  if (!pageParam) {
    const rows = db.prepare(`SELECT * FROM expenses ${where} ORDER BY expense_date DESC, id DESC`).all(...params);
    return res.json({ expenses: rows, categories: CATEGORIES, payees: distinctPayees(), totalAmount });
  }

  const page = Math.max(1, Number(pageParam) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM expenses ${where}`).get(...params);
  const rows = db
    .prepare(`SELECT * FROM expenses ${where} ORDER BY expense_date DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...params, PAGE_SIZE, offset);
  res.json({
    expenses: rows,
    categories: CATEGORIES,
    payees: distinctPayees(),
    totalAmount,
    page,
    pageSize: PAGE_SIZE,
    total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
});

router.get('/export.csv', view, (req, res) => {
  const rows = db.prepare('SELECT * FROM expenses ORDER BY expense_date DESC, id DESC').all();
  const csv = toCsv(rows, [
    { label: 'Date', key: 'expense_date' },
    { label: 'Category', key: 'category' },
    { label: 'Description', key: 'description' },
    { label: 'Amount', key: 'amount' },
    { label: 'Payee', key: 'payee' },
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

  const { category = 'other', description, amount, expense_date, payee = '', notes = '' } = req.body;
  const result = db
    .prepare('INSERT INTO expenses (category, description, amount, expense_date, payee, notes) VALUES (?, ?, ?, ?, ?, ?)')
    .run(category, description.trim(), Number(amount), expense_date, payee.trim(), notes);

  const expense = db.prepare('SELECT * FROM expenses WHERE id = ?').get(result.lastInsertRowid);
  logActivity({ userName: req.user.name, action: 'created', entityType: 'expense', entityId: expense.id, entityLabel: expense.description });
  res.status(201).json({ expense });
});

router.put('/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Expense not found' });

  const error = validate(req.body);
  if (error) return res.status(400).json({ error });

  const { category = 'other', description, amount, expense_date, payee = '', notes = '' } = req.body;
  db.prepare(
    `UPDATE expenses SET category = ?, description = ?, amount = ?, expense_date = ?, payee = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(category, description.trim(), Number(amount), expense_date, payee.trim(), notes, req.params.id);

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
