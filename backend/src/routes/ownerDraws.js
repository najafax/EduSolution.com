const { Router } = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../lib/activity');
const { toCsv } = require('../lib/csv');
const { toXlsxBuffer } = require('../lib/xlsx');
const { renderOwnerStatementPdf } = require('../lib/reportPdf');

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
const BALANCE_EPSILON = 0.005;

const round2 = (n) => Math.round(n * 100) / 100;

// How much has been returned against one specific draw, and what's left.
// Only ever meaningful for a type='draw' row — a return itself never has
// its own "returned_amount"/"balance" (nothing returns against a return),
// so those come back as 0/null for one. Don't-store-what-you-can-compute,
// same approach invoices.js's withComputed() takes for is_overdue — a
// draw's balance is always derived fresh from its own linked returns
// (owner_draws.parent_draw_id, see db/index.js) rather than a stored
// running total that could drift out of sync.
function withComputedDraw(draw) {
  if (draw.type !== 'draw') return { ...draw, returned_amount: 0, balance: null };
  const { t } = db
    .prepare(`SELECT COALESCE(SUM(amount), 0) AS t FROM owner_draws WHERE parent_draw_id = ? AND type = 'return'`)
    .get(draw.id);
  const returned = round2(t);
  return { ...draw, returned_amount: returned, balance: round2(draw.amount - returned) };
}

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

// Per-owner breakdown of the same totals GET /summary already computes
// table-wide — one row per distinct taken_by_name, `outstanding` sorted
// highest-first so whoever owes the most reads first. Grouped by name
// rather than by individual draw (withComputedDraw()'s own per-draw
// `balance` already answers that narrower question) since the KPI strip's
// single outstandingBalance figure stops being useful the moment more than
// one owner/partner is drawing money — this answers "who, specifically."
// A name with returns but no draws (a freeform return with nothing to link
// against, see db/index.js's own note on parent_draw_id) still gets a row,
// with a negative `outstanding` — real activity, not an error.
function byNameBreakdown() {
  const rows = db
    .prepare(
      `SELECT taken_by_name AS name,
        COALESCE(SUM(CASE WHEN type = 'draw' THEN amount ELSE 0 END), 0) AS totalDraws,
        COALESCE(SUM(CASE WHEN type = 'return' THEN amount ELSE 0 END), 0) AS totalReturns
       FROM owner_draws
       GROUP BY taken_by_name`,
    )
    .all();
  return rows
    .map((r) => ({
      name: r.name,
      totalDraws: round2(r.totalDraws),
      totalReturns: round2(r.totalReturns),
      outstanding: round2(r.totalDraws - r.totalReturns),
    }))
    .sort((a, b) => b.outstanding - a.outstanding);
}

// Independent of pagination/search — the running balance across every
// draw and return on file, not just what's currently filtered/visible.
// Backs the KPI strip at the top of OwnerDraws.jsx, same convention
// licenses.js's own GET /summary already establishes. This is the
// table-wide total (every return counts against it, linked to a specific
// draw or not) — a distinct question from withComputedDraw()'s own
// per-draw balance above.
router.get('/summary', view, (req, res) => {
  const totalDraws = round2(db.prepare("SELECT COALESCE(SUM(amount), 0) AS t FROM owner_draws WHERE type = 'draw'").get().t);
  const totalReturns = round2(db.prepare("SELECT COALESCE(SUM(amount), 0) AS t FROM owner_draws WHERE type = 'return'").get().t);
  res.json({ totalDraws, totalReturns, outstandingBalance: round2(totalDraws - totalReturns), byName: byNameBreakdown() });
});

// `od` is the row itself; `pd` is a self-join back to the specific draw a
// linked return's own parent_draw_id points at (NULL for a draw row, and
// for a freeform/unlinked return — see db/index.js's own note) — carried
// as parent_draw_date/parent_draw_amount so OwnerDraws.jsx can show which
// draw a linked return was recorded against right in the list, not just
// inside that draw's own history modal. Every condition below is
// od-qualified since od/pd share the same column names and an unqualified
// reference would otherwise be ambiguous now that this is a two-table query.
const LIST_SELECT = `SELECT od.*, pd.draw_date AS parent_draw_date, pd.amount AS parent_draw_amount
  FROM owner_draws od LEFT JOIN owner_draws pd ON pd.id = od.parent_draw_id`;

router.get('/', view, (req, res) => {
  const { q, type, takenBy, hasBalance, page: pageParam } = req.query;
  const conditions = [];
  const params = [];
  if (q) {
    conditions.push('(od.taken_by_name LIKE ? OR od.notes LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  // "Outstanding only" (OwnerDraws.jsx's own balance filter chip) only
  // ever means "a draw with something still owed" — a return has no
  // balance concept of its own (withComputedDraw() above always returns
  // null for one), so this forces type='draw' and computes each row's
  // balance the same way withComputedDraw() does, rather than fetching
  // every row and filtering in JS (which would break LIMIT/OFFSET's own
  // page math for the paginated case below). Takes priority over an
  // explicit `type` param instead of ANDing with it — the two would
  // otherwise be able to contradict each other (type=return AND
  // type=draw is never true), and the frontend already clears its own
  // type filter the moment "Outstanding only" is picked, so this is
  // purely a defensive fallback for a caller that sends both anyway.
  if (hasBalance === '1') {
    conditions.push("od.type = 'draw'");
    conditions.push(
      `(od.amount - COALESCE((SELECT SUM(amount) FROM owner_draws r WHERE r.parent_draw_id = od.id AND r.type = 'return'), 0)) > ?`,
    );
    params.push(BALANCE_EPSILON);
  } else if (type && TYPES.includes(type)) {
    conditions.push('od.type = ?');
    params.push(type);
  }
  if (takenBy) {
    conditions.push('od.taken_by_name = ?');
    params.push(takenBy);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  // "Outstanding only" is about finding who owes the most, not what
  // happened most recently — sorting by balance descending (biggest
  // still-owed amount first) serves that directly, falling back to the
  // usual date-recency order any other view of this list already uses.
  const orderBy =
    hasBalance === '1'
      ? `(od.amount - COALESCE((SELECT SUM(amount) FROM owner_draws r WHERE r.parent_draw_id = od.id AND r.type = 'return'), 0)) DESC, od.draw_date DESC, od.id DESC`
      : 'od.draw_date DESC, od.id DESC';

  if (!pageParam) {
    const rows = db.prepare(`${LIST_SELECT} ${where} ORDER BY ${orderBy}`).all(...params);
    return res.json({ draws: rows.map(withComputedDraw), names: distinctNames() });
  }

  const page = Math.max(1, Number(pageParam) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM owner_draws od ${where}`).get(...params);
  const rows = db
    .prepare(`${LIST_SELECT} ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
    .all(...params, PAGE_SIZE, offset);
  res.json({
    draws: rows.map(withComputedDraw),
    names: distinctNames(),
    page,
    pageSize: PAGE_SIZE,
    total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
});

// The return history behind one specific draw's own "Return" action on
// OwnerDraws.jsx — mirrors licenses.js's own GET /:id/renewals shape (the
// draw itself, computed, plus its full linked history, no pagination
// since a single draw's own return count is inherently small).
router.get('/:id/returns', view, (req, res) => {
  const draw = db.prepare("SELECT * FROM owner_draws WHERE id = ? AND type = 'draw'").get(req.params.id);
  if (!draw) return res.status(404).json({ error: 'Draw not found' });
  const returns = db
    .prepare(`SELECT * FROM owner_draws WHERE parent_draw_id = ? ORDER BY draw_date DESC, id DESC`)
    .all(draw.id);
  res.json({ draw: withComputedDraw(draw), returns });
});

// Records a partial or full payment back against one specific draw — the
// actual action behind OwnerDraws.jsx's "Return" button. Deliberately a
// separate, dedicated route from the generic POST / above (which still
// exists for a freeform, unlinked return — see db/index.js's own note on
// parent_draw_id) since this one always inherits taken_by_name from the
// draw itself (the return is from whoever took it) and validates against
// that specific draw's own remaining balance rather than accepting an
// arbitrary amount.
router.post('/:id/returns', manage, (req, res) => {
  const draw = db.prepare("SELECT * FROM owner_draws WHERE id = ? AND type = 'draw'").get(req.params.id);
  if (!draw) return res.status(404).json({ error: 'Draw not found' });

  const { amount, draw_date, notes = '' } = req.body || {};
  const amountNum = Number(amount);
  if (!draw_date) return res.status(400).json({ error: 'draw_date is required' });
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }

  const { balance } = withComputedDraw(draw);
  if (amountNum > balance + BALANCE_EPSILON) {
    return res.status(400).json({ error: `Amount cannot exceed the remaining balance of ${balance.toFixed(2)}` });
  }

  const result = db
    .prepare(
      'INSERT INTO owner_draws (type, parent_draw_id, taken_by_name, amount, draw_date, notes, created_by_name) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run('return', draw.id, draw.taken_by_name, amountNum, draw_date, notes, req.user.name);

  logActivity({
    userName: req.user.name,
    action: 'recorded a return against',
    entityType: 'owner_draw',
    entityId: draw.id,
    entityLabel: `${draw.taken_by_name} (${amountNum.toFixed(2)} against a draw of ${draw.amount.toFixed(2)})`,
  });

  const updatedDraw = withComputedDraw(db.prepare('SELECT * FROM owner_draws WHERE id = ?').get(draw.id));
  const returns = db
    .prepare(`SELECT * FROM owner_draws WHERE parent_draw_id = ? ORDER BY draw_date DESC, id DESC`)
    .all(draw.id);
  res.status(201).json({ draw: updatedDraw, returns, return: db.prepare('SELECT * FROM owner_draws WHERE id = ?').get(result.lastInsertRowid) });
});

// Shared by both export routes below so the CSV and XLSX downloads can
// never drift apart — one row query, one column list, two serializers.
// Reuses LIST_SELECT/withComputedDraw so the download carries the exact
// same computed balance/linked-draw info the list page itself now shows
// (see OwnerDraws.jsx's own "Linked-return indicator" note) — `value: (r)
// => …` accessors rather than plain `key`s for the three computed columns,
// same convention routes/expenses.js's own currency-exchange columns
// already follow, blank for whichever rows they don't apply to (Balance
// for a return, Linked draw date/amount for a draw or an unlinked return).
function loadDrawExport() {
  const rows = db.prepare(`${LIST_SELECT} ORDER BY od.draw_date DESC, od.id DESC`).all().map(withComputedDraw);
  return {
    rows,
    columns: [
      { label: 'Date', key: 'draw_date' },
      { label: 'Type', key: 'type' },
      { label: 'Taken by', key: 'taken_by_name' },
      { label: 'Amount', key: 'amount' },
      { label: 'Balance', value: (r) => (r.type === 'draw' ? r.balance : '') },
      { label: 'Linked draw date', value: (r) => r.parent_draw_date || '' },
      { label: 'Linked draw amount', value: (r) => (r.parent_draw_amount != null ? r.parent_draw_amount : '') },
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

// A printable per-owner ledger — the "Bank Balance Statement" PDF's own
// pattern (see lib/reportPdf.js), just scoped to one owner's own draws/
// returns instead of the whole business's cash movements, and covering
// their entire history rather than one date range (a single owner's own
// record count is inherently small, same "don't paginate a naturally
// small list" call this app already makes for GET /:id/returns above).
// Matched by taken_by_name (query string, not a path param, so a name
// with a slash in it can't break the route) since owner_draws has no
// separate "owners" table of its own to reference by id — same free-text
// identity every other taken_by_name filter/breakdown in this file already
// keys on.
router.get('/statement/pdf', view, async (req, res) => {
  const { takenBy } = req.query;
  if (!takenBy) return res.status(400).json({ error: 'takenBy is required' });
  const records = db.prepare('SELECT * FROM owner_draws WHERE taken_by_name = ? ORDER BY draw_date ASC, id ASC').all(takenBy);
  const settings = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();
  const buffer = await renderOwnerStatementPdf({ name: takenBy, records, settings });
  const safeName = takenBy.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'owner';
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="owner-draw-statement-${safeName}.pdf"` });
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

  const draw = withComputedDraw(db.prepare('SELECT * FROM owner_draws WHERE id = ?').get(result.lastInsertRowid));
  logActivity({
    userName: req.user.name,
    action: type === 'return' ? 'recorded a return from' : 'recorded a draw for',
    entityType: 'owner_draw',
    entityId: draw.id,
    entityLabel: `${draw.taken_by_name} (${draw.amount})`,
  });
  res.status(201).json({ draw });
});

// Returns how much has already been returned against `drawId`, excluding
// one specific linked return row (`excludeReturnId`) from that sum — used
// below so editing a linked return's own amount validates against the
// draw's balance as it would be *without* this return's old value, not
// double-counting it.
function returnedAgainst(drawId, excludeReturnId) {
  const { t } = db
    .prepare(`SELECT COALESCE(SUM(amount), 0) AS t FROM owner_draws WHERE parent_draw_id = ? AND type = 'return' AND id != ?`)
    .get(drawId, excludeReturnId || 0);
  return round2(t);
}

router.put('/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM owner_draws WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Draw not found' });

  const error = validate(req.body);
  if (error) return res.status(400).json({ error });

  const { type = 'draw', taken_by_name, amount, draw_date, notes = '' } = req.body;
  const amountNum = Number(amount);

  // A draw that already has recorded returns against it can't silently
  // stop being a draw, or shrink below what's already been paid back —
  // either would corrupt the balance every linked return's amount is
  // computed against. A return that's itself linked to a draw
  // (parent_draw_id set) can't silently stop being a return either, and
  // its own amount can't be edited past what would push that draw's
  // balance negative — same "don't let an edit corrupt a relationship"
  // convention this app's own locked-status guards already follow
  // elsewhere (a converted quote, a sent/paid invoice).
  if (existing.type === 'draw') {
    const returned = returnedAgainst(existing.id);
    if (returned > 0) {
      if (type !== 'draw') {
        return res.status(400).json({ error: 'This draw has recorded returns and its type cannot be changed.' });
      }
      if (amountNum < returned - BALANCE_EPSILON) {
        return res
          .status(400)
          .json({ error: `Amount cannot be less than the ${returned.toFixed(2)} already returned against this draw.` });
      }
    }
  } else if (existing.parent_draw_id) {
    if (type !== 'return') {
      return res.status(400).json({ error: 'This return is linked to a draw and its type cannot be changed.' });
    }
    const parentDraw = db.prepare('SELECT * FROM owner_draws WHERE id = ?').get(existing.parent_draw_id);
    if (parentDraw) {
      const remaining = round2(parentDraw.amount - returnedAgainst(parentDraw.id, existing.id));
      if (amountNum > remaining + BALANCE_EPSILON) {
        return res
          .status(400)
          .json({ error: `Amount cannot exceed the remaining balance of ${remaining.toFixed(2)} for this draw.` });
      }
    }
  }

  db.prepare(
    `UPDATE owner_draws SET type = ?, taken_by_name = ?, amount = ?, draw_date = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(type, taken_by_name.trim(), amountNum, draw_date, notes, req.params.id);

  const draw = withComputedDraw(db.prepare('SELECT * FROM owner_draws WHERE id = ?').get(req.params.id));
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

  // Mirrors this app's other "checked-first 409, not a raw FK error"
  // delete guards (routes/clients.js's own DELETE /:id) — deleting a draw
  // that still has linked returns would either orphan them (dangling
  // parent_draw_id) or silently erase real repayment history, neither of
  // which this app lets happen to a real business record.
  if (existing.type === 'draw' && returnedAgainst(existing.id) > 0) {
    return res
      .status(409)
      .json({ error: 'This draw has recorded returns and cannot be deleted. Delete the returns first.' });
  }

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
