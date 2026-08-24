const { Router } = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../lib/activity');
const { toCsv } = require('../lib/csv');
const { toXlsxBuffer } = require('../lib/xlsx');

// Money an owner/partner takes OUT of the business, with an explicit way
// to record paying some or all of it back — see db/index.js's own
// CREATE TABLE comment for why this is its own table with a `type`
// column rather than reusing capital_contributions (money in, unrelated
// to any specific draw) or an expenses row tagged "shareholder payments"
// (a plain expense has no notion of a running balance or a later
// repayment against it). Gated on the existing 'expenses' permission
// rather than a new MODULES entry — same "reuse when the sensitivity
// level already matches" call capitalContributions.js/reports.js already
// make: this is the same kind of non-invoice cash-movement data.
const router = Router();
router.use(requireAuth);
const view = requirePermission('expenses', 'view');
const manage = requirePermission('expenses', 'manage');

const TYPES = ['draw', 'return'];
const PAGE_SIZE = 20;

// Mirrors capitalContributions.js's own distinctContributors() — every
// name used so far, independent of the current filter, so the filter
// dropdown always offers everyone who's ever taken or returned money
// rather than just who survived the current search.
function distinctNames() {
  return db
    .prepare("SELECT DISTINCT taken_by_name FROM owner_draws WHERE taken_by_name != '' ORDER BY taken_by_name COLLATE NOCASE")
    .all()
    .map((r) => r.taken_by_name);
}

// Independent of pagination/search — the running balance across every
// draw and return on file, not just what's currently filtered/visible.
// Backs the KPI strip at the top of OwnerDraws.jsx, same convention
// licenses.js's own GET /summary already establishes.
router.get('/summary', view, (req, res) => {
  const round2 = (n) => Math.round(n * 100) / 100;
  const totalDraws = round2(db.prepare("SELECT COALESCE(SUM(amount), 0) AS t FROM owner_draws WHERE type = 'draw'").get().t);
  const totalReturns = round2(db.prepare("SELECT COALESCE(SUM(amount), 0) AS t FROM owner_draws WHERE type = 'return'").get().t);
  res.json({ totalDraws, totalReturns, outstandingBalance: round2(totalDraws - totalReturns) });
});

router.get('/', view, (req, res) => {
  const { q, type, takenBy, page: pageParam } = req.query;
  const conditions = [];
  const params = [];
  if (q) {
    conditions.push('(taken_by_name LIKE ? OR notes LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  if (type && TYPES.includes(type)) {
    conditions.push('type = ?');
    params.push(type);
  }
  if (takenBy) {
    conditions.push('taken_by_name = ?');
    params.push(takenBy);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  if (!pageParam) {
    const rows = db.prepare(`SELECT * FROM owner_draws ${where} ORDER BY draw_date DESC, id DESC`).all(...params);
    return res.json({ draws: rows, names: distinctNames() });
  }

  const page = Math.max(1, Number(pageParam) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM owner_draws ${where}`).get(...params);
  const rows = db
    .prepare(`SELECT * FROM owner_draws ${where} ORDER BY draw_date DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...params, PAGE_SIZE, offset);
  res.json({
    draws: rows,
    names: distinctNames(),
    page,
    pageSize: PAGE_SIZE,
    total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
});

// Shared by both export routes below so the CSV and XLSX downloads can
// never drift apart — one row query, one column list, two serializers.
function loadDrawExport() {
  return {
    rows: db.prepare('SELECT * FROM owner_draws ORDER BY draw_date DESC, id DESC').all(),
    columns: [
      { label: 'Date', key: 'draw_date' },
      { label: 'Type', key: 'type' },
      { label: 'Taken by', key: 'taken_by_name' },
      { label: 'Amount', key: 'amount' },
      { label: 'Notes', key: 'notes' },
    ],
  };
}

router.get('/export.csv', view, (req, res) => {
  const { rows, columns } = loadDrawExport();
  const csv = toCsv(rows, columns);
  res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="owner-draws.csv"' });
  res.send(csv);
});

router.get('/export.xlsx', view, async (req, res) => {
  const { rows, columns } = loadDrawExport();
  const buffer = await toXlsxBuffer(rows, columns, 'Owner draws');
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': 'attachment; filename="owner-draws.xlsx"',
  });
  res.send(buffer);
});

function validate(body) {
  const { type = 'draw', taken_by_name, amount, draw_date } = body || {};
  if (!TYPES.includes(type)) return `type must be one of: ${TYPES.join(', ')}`;
  if (!taken_by_name || !amount || !draw_date) {
    return 'taken_by_name, amount and draw_date are required';
  }
  const amountNum = Number(amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    return 'amount must be a positive number';
  }
  return null;
}

router.post('/', manage, (req, res) => {
  const error = validate(req.body);
  if (error) return res.status(400).json({ error });

  const { type = 'draw', taken_by_name, amount, draw_date, notes = '' } = req.body;
  const result = db
    .prepare('INSERT INTO owner_draws (type, taken_by_name, amount, draw_date, notes, created_by_name) VALUES (?, ?, ?, ?, ?, ?)')
    .run(type, taken_by_name.trim(), Number(amount), draw_date, notes, req.user.name);

  const draw = db.prepare('SELECT * FROM owner_draws WHERE id = ?').get(result.lastInsertRowid);
  logActivity({
    userName: req.user.name,
    action: type === 'return' ? 'recorded a return from' : 'recorded a draw for',
    entityType: 'owner_draw',
    entityId: draw.id,
    entityLabel: `${draw.taken_by_name} (${draw.amount})`,
  });
  res.status(201).json({ draw });
});

router.put('/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM owner_draws WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Draw not found' });

  const error = validate(req.body);
  if (error) return res.status(400).json({ error });

  const { type = 'draw', taken_by_name, amount, draw_date, notes = '' } = req.body;
  db.prepare(
    `UPDATE owner_draws SET type = ?, taken_by_name = ?, amount = ?, draw_date = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(type, taken_by_name.trim(), Number(amount), draw_date, notes, req.params.id);

  const draw = db.prepare('SELECT * FROM owner_draws WHERE id = ?').get(req.params.id);
  logActivity({
    userName: req.user.name,
    action: type === 'return' ? 'updated a return from' : 'updated a draw for',
    entityType: 'owner_draw',
    entityId: draw.id,
    entityLabel: `${draw.taken_by_name} (${draw.amount})`,
  });
  res.json({ draw });
});

router.delete('/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM owner_draws WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Draw not found' });

  db.prepare('DELETE FROM owner_draws WHERE id = ?').run(req.params.id);
  logActivity({
    userName: req.user.name,
    action: existing.type === 'return' ? 'deleted a return from' : 'deleted a draw for',
    entityType: 'owner_draw',
    entityId: existing.id,
    entityLabel: `${existing.taken_by_name} (${existing.amount})`,
  });
  res.status(204).end();
});

module.exports = router;
