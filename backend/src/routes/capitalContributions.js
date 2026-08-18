const { Router } = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../lib/activity');
const { toCsv } = require('../lib/csv');
const { toXlsxBuffer } = require('../lib/xlsx');

// Money an owner/partner puts INTO the business — the deliberate mirror of
// an expenses row tagged 'shareholder payments' (money taken OUT), but its
// own table/route rather than a negative expense amount (see db/index.js's
// CREATE TABLE comment for why). Gated on the existing 'expenses' permission
// rather than a new MODULES entry — same "reuse when the sensitivity level
// already matches" call routes/reports.js makes for 'financials': this is
// the same kind of non-invoice cash-movement data expenses already covers,
// and 'shareholder payments' (its outbound mirror) already lives there.
const router = Router();
router.use(requireAuth);
const view = requirePermission('expenses', 'view');
const manage = requirePermission('expenses', 'manage');

const PAGE_SIZE = 20;

// Mirrors expenses.js's distinctPayees() — every contributor name used so
// far, independent of the current filter, so the filter dropdown always
// offers everyone who's ever contributed rather than just who survived the
// current search.
function distinctContributors() {
  return db
    .prepare("SELECT DISTINCT contributor_name FROM capital_contributions WHERE contributor_name != '' ORDER BY contributor_name COLLATE NOCASE")
    .all()
    .map((r) => r.contributor_name);
}

router.get('/', view, (req, res) => {
  const { q, contributor, page: pageParam } = req.query;
  const conditions = [];
  const params = [];
  if (q) {
    conditions.push('(contributor_name LIKE ? OR notes LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  if (contributor) {
    conditions.push('contributor_name = ?');
    params.push(contributor);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  // Total reflects every matching row, not just the current page — same
  // reasoning as expenses.js's own totalAmount, so a "Total" row stays
  // accurate once pagination means the page's own array isn't the full set.
  const { totalAmount } = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS totalAmount FROM capital_contributions ${where}`).get(...params);

  if (!pageParam) {
    const rows = db
      .prepare(`SELECT * FROM capital_contributions ${where} ORDER BY contribution_date DESC, id DESC`)
      .all(...params);
    return res.json({ contributions: rows, contributors: distinctContributors(), totalAmount });
  }

  const page = Math.max(1, Number(pageParam) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM capital_contributions ${where}`).get(...params);
  const rows = db
    .prepare(`SELECT * FROM capital_contributions ${where} ORDER BY contribution_date DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...params, PAGE_SIZE, offset);
  res.json({
    contributions: rows,
    contributors: distinctContributors(),
    totalAmount,
    page,
    pageSize: PAGE_SIZE,
    total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
});

// Shared by both export routes below so the CSV and XLSX downloads can
// never drift apart — one row query, one column list, two serializers.
function loadContributionExport() {
  return {
    rows: db.prepare('SELECT * FROM capital_contributions ORDER BY contribution_date DESC, id DESC').all(),
    columns: [
      { label: 'Date', key: 'contribution_date' },
      { label: 'Contributor', key: 'contributor_name' },
      { label: 'Amount', key: 'amount' },
      { label: 'Notes', key: 'notes' },
    ],
  };
}

router.get('/export.csv', view, (req, res) => {
  const { rows, columns } = loadContributionExport();
  const csv = toCsv(rows, columns);
  res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="capital-contributions.csv"' });
  res.send(csv);
});

router.get('/export.xlsx', view, async (req, res) => {
  const { rows, columns } = loadContributionExport();
  const buffer = await toXlsxBuffer(rows, columns, 'Capital contributions');
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': 'attachment; filename="capital-contributions.xlsx"',
  });
  res.send(buffer);
});

function validate(body) {
  const { contributor_name, amount, contribution_date } = body || {};
  if (!contributor_name || !amount || !contribution_date) {
    return 'contributor_name, amount and contribution_date are required';
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

  const { contributor_name, amount, contribution_date, notes = '' } = req.body;
  const result = db
    .prepare('INSERT INTO capital_contributions (contributor_name, amount, contribution_date, notes, created_by_name) VALUES (?, ?, ?, ?, ?)')
    .run(contributor_name.trim(), Number(amount), contribution_date, notes, req.user.name);

  const contribution = db.prepare('SELECT * FROM capital_contributions WHERE id = ?').get(result.lastInsertRowid);
  logActivity({
    userName: req.user.name,
    action: 'recorded capital contribution from',
    entityType: 'capital_contribution',
    entityId: contribution.id,
    entityLabel: `${contribution.contributor_name} (${contribution.amount})`,
  });
  res.status(201).json({ contribution });
});

router.put('/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM capital_contributions WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Capital contribution not found' });

  const error = validate(req.body);
  if (error) return res.status(400).json({ error });

  const { contributor_name, amount, contribution_date, notes = '' } = req.body;
  db.prepare(
    `UPDATE capital_contributions SET contributor_name = ?, amount = ?, contribution_date = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(contributor_name.trim(), Number(amount), contribution_date, notes, req.params.id);

  const contribution = db.prepare('SELECT * FROM capital_contributions WHERE id = ?').get(req.params.id);
  logActivity({
    userName: req.user.name,
    action: 'updated capital contribution from',
    entityType: 'capital_contribution',
    entityId: contribution.id,
    entityLabel: `${contribution.contributor_name} (${contribution.amount})`,
  });
  res.json({ contribution });
});

router.delete('/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM capital_contributions WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Capital contribution not found' });

  db.prepare('DELETE FROM capital_contributions WHERE id = ?').run(req.params.id);
  logActivity({
    userName: req.user.name,
    action: 'deleted capital contribution from',
    entityType: 'capital_contribution',
    entityId: existing.id,
    entityLabel: `${existing.contributor_name} (${existing.amount})`,
  });
  res.status(204).end();
});

module.exports = router;
