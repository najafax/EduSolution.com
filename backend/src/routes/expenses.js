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

// `amount` is always the local-currency figure actually spent; for a
// 'currency exchange' row with a real (>0) `exchange_rate`, the USD the
// business actually received is derived from those two — never stored
// itself, so it can never drift from the two numbers it's computed from
// (same don't-store-what-you-can-compute approach `invoices.js`'s
// `withComputed()` takes for `is_overdue`). Every other row gets `null`.
// Rounded to 2dp — an unrounded division (e.g. 599.9987068993386) would
// otherwise leak floating-point noise into the list, CSV/Excel export, and
// the analytics transaction table below, all of which just display this
// value as-is rather than reformatting it themselves.
function withComputedUsd(row) {
  const amountUsd = row.category === 'currency exchange' && row.exchange_rate > 0 ? round2(row.amount / row.exchange_rate) : null;
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
    // Every label here doubles as this row's import column name once
    // lib/csv.js's parseCsv() lowercases and underscores it — "Expense
    // date" (not the shorter, more report-like "Date") specifically so a
    // downloaded export re-uploaded to this same page's "Import CSV"
    // resolves to `expense_date`, matching routes/import.js's
    // validateExpenseRow(). Every other label here already round-trips
    // correctly this way ("Exchange rate" → `exchange_rate`, "Payee
    // account number" → `payee_account_number`, "USD destination" →
    // `usd_destination`) without needing a rename.
    columns: [
      { label: 'Expense date', key: 'expense_date' },
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

// Historical, year-over-year view — distinct from the plain totals `GET /`
// already returns for the current filtered page. Same "fetch every row
// once, loop in JS" approach `routes/licenses.js`'s own `GET /analytics`
// takes, rather than a per-year SQL query — fine at this app's scale, and
// simpler than a GROUP BY strftime('%Y', ...) for every metric below. Not
// gated behind `?category=`/`?q=` — this is a whole-history report, not a
// filtered list.
//
// The yearly chart pairs `total` (every category) against
// `currencyExchangeSpent` (currency-exchange rows only) — both in local
// currency, so they're directly comparable on one axis, unlike
// `currencyExchangeUsd` which is a different currency entirely and would
// misrepresent scale if plotted alongside either. USD figures are reported
// separately instead, in `totals` and per year in `byYear`, for the
// currency-exchange-specific panel to render on its own.
router.get('/analytics', view, (req, res) => {
  try {
    const rows = db.prepare('SELECT category, amount, expense_date, exchange_rate FROM expenses').all();
    const currentYear = new Date().getFullYear();
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
      const exchangeRows = yearRows.filter((r) => r.category === 'currency exchange');
      byYear.push({
        year,
        total: round2(yearRows.reduce((sum, r) => sum + r.amount, 0)),
        count: yearRows.length,
        currencyExchangeSpent: round2(exchangeRows.reduce((sum, r) => sum + r.amount, 0)),
        currencyExchangeUsd: round2(exchangeRows.reduce((sum, r) => sum + (r.exchange_rate > 0 ? r.amount / r.exchange_rate : 0), 0)),
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

    // The individual currency-exchange records themselves, in full — the
    // whole reason this analytics page exists alongside the yearly/category
    // rollups above (see the frontend page). This category's row count is
    // expected to stay small at this app's scale (an occasional MVR→USD
    // conversion, not a high-volume transaction type), so no pagination —
    // same "don't build it until needed" call `routes/licenses.js`'s own
    // `GET /:id/renewals` already makes for a comparably small per-entity list.
    const currencyExchangeTransactions = db
      .prepare("SELECT * FROM expenses WHERE category = 'currency exchange' ORDER BY expense_date DESC, id DESC")
      .all()
      .map(withComputedUsd);

    const exchangeRows = rows.filter((r) => r.category === 'currency exchange');
    const totalCurrencyExchangeSpent = round2(exchangeRows.reduce((sum, r) => sum + r.amount, 0));
    const totalCurrencyExchangeUsd = round2(
      exchangeRows.reduce((sum, r) => sum + (r.exchange_rate > 0 ? r.amount / r.exchange_rate : 0), 0),
    );

    res.json({
      byYear,
      byCategory,
      topPayees,
      currencyExchangeTransactions,
      totals: {
        totalAmount: round2(rows.reduce((sum, r) => sum + r.amount, 0)),
        totalCount: rows.length,
        totalCurrencyExchangeSpent,
        totalCurrencyExchangeUsd,
        exchangeTransactionCount: exchangeRows.length,
        // The true blended rate across every exchange, not an average of the
        // individual rates (which would weight a tiny exchange the same as a
        // huge one) — total local currency spent divided by total USD
        // actually received, `null` when nothing's been exchanged yet rather
        // than a division-by-zero.
        averageExchangeRate: totalCurrencyExchangeUsd > 0 ? round2(totalCurrencyExchangeSpent / totalCurrencyExchangeUsd) : null,
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
