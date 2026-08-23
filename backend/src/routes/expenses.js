const { Router } = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../lib/activity');
const { toCsv } = require('../lib/csv');
const { toXlsxBuffer } = require('../lib/xlsx');

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

// `amount` is always the local-currency figure actually spent; for a
// 'currency exchange' row with a real (>0) `exchange_rate`, the USD the
// business actually received is derived from those two — never stored
// itself, so it can never drift from the two numbers it's computed from
// (same don't-store-what-you-can-compute approach `invoices.js`'s
// `withComputed()` takes for `is_overdue`). Every other row gets `null`.
function withComputedUsd(row) {
  const amountUsd = row.category === 'currency exchange' && row.exchange_rate > 0 ? row.amount / row.exchange_rate : null;
  return { ...row, amount_usd: amountUsd };
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
    const rows = db.prepare(`SELECT * FROM expenses ${where} ORDER BY expense_date DESC, id DESC`).all(...params).map(withComputedUsd);
    return res.json({ expenses: rows, categories: CATEGORIES, payees: distinctPayees(), totalAmount });
  }

  const page = Math.max(1, Number(pageParam) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM expenses ${where}`).get(...params);
  const rows = db
    .prepare(`SELECT * FROM expenses ${where} ORDER BY expense_date DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...params, PAGE_SIZE, offset)
    .map(withComputedUsd);
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

// Shared by both export routes below so the CSV and XLSX downloads can
// never drift apart — one row query, one column list, two serializers.
// The four currency-exchange columns are blank for every other category's
// row, same as `Payee`/`Notes` already are for rows that never set them.
function loadExpenseExport() {
  return {
    rows: db.prepare('SELECT * FROM expenses ORDER BY expense_date DESC, id DESC').all().map(withComputedUsd),
    columns: [
      { label: 'Date', key: 'expense_date' },
      { label: 'Category', key: 'category' },
      { label: 'Description', key: 'description' },
      { label: 'Amount', key: 'amount' },
      { label: 'Payee', key: 'payee' },
      { label: 'Exchange rate', value: (r) => r.exchange_rate ?? '' },
      { label: 'Amount (USD)', value: (r) => r.amount_usd ?? '' },
      { label: 'Payee account number', key: 'payee_account_number' },
      { label: 'USD destination', key: 'usd_destination' },
      { label: 'Notes', key: 'notes' },
    ],
  };
}

router.get('/export.csv', view, (req, res) => {
  const { rows, columns } = loadExpenseExport();
  const csv = toCsv(rows, columns);
  res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="expenses.csv"' });
  res.send(csv);
});

router.get('/export.xlsx', view, async (req, res) => {
  const { rows, columns } = loadExpenseExport();
  const buffer = await toXlsxBuffer(rows, columns, 'Expenses');
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': 'attachment; filename="expenses.xlsx"',
  });
  res.send(buffer);
});

function validate(body) {
  const { category = 'other', description, amount, expense_date, exchange_rate } = body || {};
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
  // The rate is only meaningful (and only ever shown on the form) for this
  // one category — required there so `amount_usd` never silently computes
  // against a missing rate, ignored everywhere else regardless of what a
  // stray value in the body claims.
  if (category === 'currency exchange') {
    const rateNum = Number(exchange_rate);
    if (!exchange_rate || !Number.isFinite(rateNum) || rateNum <= 0) {
      return 'exchange rate must be a positive number for a currency exchange expense';
    }
  }
  return null;
}

// Extracted so POST/PUT can't disagree on what actually gets written —
// `exchange_rate`/`payee_account_number`/`usd_destination` only ever
// persist for a 'currency exchange' row; anything submitted for another
// category (e.g. a leftover value from switching the dropdown back and
// forth on the form) is discarded rather than stored.
function currencyExchangeFields(body) {
  const { category = 'other', exchange_rate, payee_account_number = '', usd_destination = '' } = body || {};
  if (category !== 'currency exchange') {
    return { exchangeRate: null, payeeAccountNumber: '', usdDestination: '' };
  }
  return {
    exchangeRate: Number(exchange_rate),
    payeeAccountNumber: payee_account_number.trim(),
    usdDestination: usd_destination.trim(),
  };
}

router.post('/', manage, (req, res) => {
  const error = validate(req.body);
  if (error) return res.status(400).json({ error });

  const { category = 'other', description, amount, expense_date, payee = '', notes = '' } = req.body;
  const { exchangeRate, payeeAccountNumber, usdDestination } = currencyExchangeFields(req.body);
  const result = db
    .prepare(
      `INSERT INTO expenses (category, description, amount, expense_date, payee, notes, exchange_rate, payee_account_number, usd_destination)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(category, description.trim(), Number(amount), expense_date, payee.trim(), notes, exchangeRate, payeeAccountNumber, usdDestination);

  const expense = withComputedUsd(db.prepare('SELECT * FROM expenses WHERE id = ?').get(result.lastInsertRowid));
  logActivity({ userName: req.user.name, action: 'created', entityType: 'expense', entityId: expense.id, entityLabel: expense.description });
  res.status(201).json({ expense });
});

router.put('/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Expense not found' });

  const error = validate(req.body);
  if (error) return res.status(400).json({ error });

  const { category = 'other', description, amount, expense_date, payee = '', notes = '' } = req.body;
  const { exchangeRate, payeeAccountNumber, usdDestination } = currencyExchangeFields(req.body);
  db.prepare(
    `UPDATE expenses SET category = ?, description = ?, amount = ?, expense_date = ?, payee = ?, notes = ?,
       exchange_rate = ?, payee_account_number = ?, usd_destination = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(
    category,
    description.trim(),
    Number(amount),
    expense_date,
    payee.trim(),
    notes,
    exchangeRate,
    payeeAccountNumber,
    usdDestination,
    req.params.id,
  );

  const expense = withComputedUsd(db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id));
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
