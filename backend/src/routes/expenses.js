const { Router } = require('express');
const { round2: roundCents, dateError } = require('../lib/validate');
const db = require('../db');
const { businessYear } = require('../lib/businessDate');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../lib/activity');
const { toCsv } = require('../lib/csv');
const { toXlsxBuffer } = require('../lib/xlsx');

const router = Router();
router.use(requireAuth);
const view = requirePermission('expenses', 'view');
const manage = requirePermission('expenses', 'manage');

const CATEGORIES = ['rent', 'utilities', 'supplies', 'salaries', 'shareholder payments', 'marketing', 'software', 'travel', 'other'];

const PAGE_SIZE = 20;
const round2 = (n) => Math.round(n * 100) / 100;

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

// Shared by GET / and both export routes below, so a filtered export can
// never drift from what the list page itself is actually showing when the
// download button is clicked. Mirrors routes/invoices.js's own
// buildInvoiceWhere().
function buildExpenseWhere({ q, category, payee }) {
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
  return { where, params };
}

router.get('/', view, (req, res) => {
  const { q, category, payee, page: pageParam } = req.query;
  const { where, params } = buildExpenseWhere({ q, category, payee });
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

// Shared by both export routes below so the CSV and XLSX downloads can
// never drift apart — one row query, one column list, two serializers.
// **Filtered export**: accepts an optional `{ q, category, payee }` and
// reuses buildExpenseWhere() — the same WHERE clause GET / itself builds —
// so a download matches whatever's currently filtered on Expenses.jsx,
// mirroring routes/invoices.js's own loadInvoiceExport(). Called with no
// argument, behaves exactly as before this existed — every expense,
// unfiltered.
function loadExpenseExport({ q, category, payee } = {}) {
  const { where, params } = buildExpenseWhere({ q, category, payee });
  return {
    rows: db.prepare(`SELECT * FROM expenses ${where} ORDER BY expense_date DESC, id DESC`).all(...params),
    // Every label here doubles as this row's import column name once
    // lib/csv.js's parseCsv() lowercases and underscores it — "Expense
    // date" (not the shorter, more report-like "Date") specifically so a
    // downloaded export re-uploaded to this same page's "Import CSV"
    // resolves to `expense_date`, matching routes/import.js's
    // validateExpenseRow(). Every other label here already round-trips
    // correctly this way without needing a rename.
    columns: [
      { label: 'Expense date', key: 'expense_date' },
      { label: 'Category', key: 'category' },
      { label: 'Description', key: 'description' },
      { label: 'Amount', key: 'amount' },
      { label: 'Payee', key: 'payee' },
      { label: 'Notes', key: 'notes' },
    ],
  };
}

// A category-specific filename (e.g. "expenses-rent.csv") when the
// download is actually filtered by category, plain "expenses.csv"
// otherwise — same convention routes/invoices.js's own exportFilename()
// establishes. Not keyed on `payee`/`q` too — those are free text, not a
// clean filename slug the way a fixed category value already is.
function exportFilename(category, ext) {
  return category ? `expenses-${category.replace(/\s+/g, '-')}.${ext}` : `expenses.${ext}`;
}

router.get('/export.csv', view, (req, res) => {
  const { q, category, payee } = req.query;
  const { rows, columns } = loadExpenseExport({ q, category, payee });
  const csv = toCsv(rows, columns);
  res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="${exportFilename(category, 'csv')}"` });
  res.send(csv);
});

router.get('/export.xlsx', view, async (req, res) => {
  const { q, category, payee } = req.query;
  const { rows, columns } = loadExpenseExport({ q, category, payee });
  const buffer = await toXlsxBuffer(rows, columns, 'Expenses');
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${exportFilename(category, 'xlsx')}"`,
  });
  res.send(buffer);
});

// Historical, year-over-year view — distinct from the plain totals `GET /`
// already returns for the current filtered page. Same "fetch every row
// once, loop in JS" approach `routes/licenses.js`'s own `GET /analytics`
// takes, rather than a per-year SQL query — fine at this app's scale, and
// simpler than a GROUP BY strftime('%Y', ...) for every metric below. Not
// gated behind `?category=`/`?q=` — this is a whole-history report, not a
// filtered list.
router.get('/analytics', view, (req, res) => {
  try {
    const rows = db.prepare('SELECT category, amount, expense_date FROM expenses').all();
    const currentYear = businessYear();
    // expense_date is required and validated non-blank on every write path
    // (create/update, CSV import), but a row written before that validation
    // existed, or edited directly against the database, can still carry a
    // blank or malformed value. `''.slice(0, 4)` used to compute as year 0
    // (`Number('') === 0`), which pushed minYear down to 0 and made the loop
    // below iterate ~2000 times instead of the handful of real years — a
    // response with that many empty byYear entries, not an error, which is
    // what actually made this page unusable rather than throwing an obvious
    // exception. yearOf() now returns null for anything that isn't a
    // plausible year; a row with no derivable year is simply left out of the
    // yearly breakdown (byCategory/topPayees/totals below don't need a date,
    // so it's still fully counted everywhere else).
    const yearOf = (d) => {
      if (typeof d !== 'string' || d.length < 4) return null;
      const y = Number(d.slice(0, 4));
      return Number.isInteger(y) && y >= 1990 && y <= currentYear + 1 ? y : null;
    };

    const validYears = rows.map((r) => yearOf(r.expense_date)).filter((y) => y !== null);
    const minYear = validYears.length ? Math.min(currentYear, ...validYears) : currentYear;

    const byYear = [];
    for (let year = currentYear; year >= minYear; year--) {
      const yearRows = rows.filter((r) => yearOf(r.expense_date) === year);
      byYear.push({
        year,
        total: round2(yearRows.reduce((sum, r) => sum + r.amount, 0)),
        count: yearRows.length,
      });
    }

    const byCategory = {};
    for (const cat of CATEGORIES) byCategory[cat] = 0;
    rows.forEach((r) => {
      byCategory[r.category] = round2((byCategory[r.category] || 0) + r.amount);
    });

    const topPayees = db
      .prepare(
        `SELECT payee, COUNT(*) AS expense_count, COALESCE(SUM(amount), 0) AS total_amount
         FROM expenses WHERE payee != ''
         GROUP BY payee
         ORDER BY total_amount DESC
         LIMIT 5`,
      )
      .all();

    res.json({
      byYear,
      byCategory,
      topPayees,
      totals: {
        totalAmount: round2(rows.reduce((sum, r) => sum + r.amount, 0)),
        totalCount: rows.length,
      },
    });
  } catch (err) {
    // Belt-and-suspenders on top of the yearOf() hardening above — guarantees
    // a proper JSON error response (which the frontend can show as an inline
    // message) instead of an unhandled exception, for any failure mode this
    // route didn't anticipate.
    console.error('GET /api/expenses/analytics failed:', err);
    res.status(500).json({ error: 'Failed to load expense analytics' });
  }
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
  const badDate = dateError(expense_date, 'expense_date');
  if (badDate) return badDate;
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
    .prepare(
      `INSERT INTO expenses (category, description, amount, expense_date, payee, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(category, description.trim(), roundCents(amount), expense_date, payee.trim(), notes);

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
    `UPDATE expenses SET category = ?, description = ?, amount = ?, expense_date = ?, payee = ?, notes = ?,
       updated_at = datetime('now') WHERE id = ?`,
  ).run(
    category,
    description.trim(),
    roundCents(amount),
    expense_date,
    payee.trim(),
    notes,
    req.params.id,
  );

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
