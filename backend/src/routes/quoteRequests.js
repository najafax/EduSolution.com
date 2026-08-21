const { Router } = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../lib/activity');

// Gated on the existing `quotes` permission rather than a new MODULES
// entry — a quote request is a precursor to a real quote at the exact same
// sensitivity level, so a staff member already trusted to manage quotes is
// trusted to review these too (same "reuse when sensitivity matches" call
// routes/reports.js/routes/capitalContributions.js already make elsewhere).
const router = Router();
router.use(requireAuth);
const view = requirePermission('quotes', 'view');
const manage = requirePermission('quotes', 'manage');

const PAGE_SIZE = 20;

function getRequestItems(requestId) {
  return db.prepare('SELECT * FROM quote_request_items WHERE quote_request_id = ? ORDER BY id').all(requestId);
}

function getRequestWithClient(id) {
  const request = db
    .prepare(
      `SELECT quote_requests.*, clients.name AS client_name, clients.email AS client_email,
         quotes.number AS quote_number, quotes.status AS quote_status
       FROM quote_requests
       JOIN clients ON clients.id = quote_requests.client_id
       LEFT JOIN quotes ON quotes.id = quote_requests.quote_id
       WHERE quote_requests.id = ?`,
    )
    .get(id);
  if (!request) return null;
  return { ...request, items: getRequestItems(request.id) };
}

router.get('/', view, (req, res) => {
  const { status, page: pageParam } = req.query;
  const where = status ? 'WHERE quote_requests.status = ?' : '';
  const params = status ? [status] : [];
  const listQuery = `
    SELECT quote_requests.*, clients.name AS client_name,
      quotes.number AS quote_number, quotes.status AS quote_status
    FROM quote_requests
    JOIN clients ON clients.id = quote_requests.client_id
    LEFT JOIN quotes ON quotes.id = quote_requests.quote_id
  `;

  // Items are fetched once via a single IN(...) query per page/list rather
  // than per-row, same batching approach routes/clientPortal.js's own
  // GET /quote-requests uses.
  function withItems(rows) {
    const ids = rows.map((r) => r.id);
    const allItems = ids.length
      ? db
          .prepare(`SELECT * FROM quote_request_items WHERE quote_request_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`)
          .all(...ids)
      : [];
    return rows.map((r) => ({ ...r, items: allItems.filter((i) => i.quote_request_id === r.id) }));
  }

  if (!pageParam) {
    const requests = db
      .prepare(`${listQuery} ${where} ORDER BY quote_requests.created_at DESC, quote_requests.id DESC`)
      .all(...params);
    return res.json({ requests: withItems(requests) });
  }

  const page = Math.max(1, Number(pageParam) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM quote_requests ${where}`).get(...params);
  const requests = db
    .prepare(`${listQuery} ${where} ORDER BY quote_requests.created_at DESC, quote_requests.id DESC LIMIT ? OFFSET ?`)
    .all(...params, PAGE_SIZE, offset);
  res.json({
    requests: withItems(requests),
    page,
    pageSize: PAGE_SIZE,
    total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
});

router.get('/:id', view, (req, res) => {
  const request = getRequestWithClient(req.params.id);
  if (!request) return res.status(404).json({ error: 'Quote request not found' });
  res.json({ request });
});

router.post('/:id/decline', manage, (req, res) => {
  const request = db.prepare('SELECT * FROM quote_requests WHERE id = ?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Quote request not found' });
  if (request.status !== 'pending') {
    return res.status(409).json({ error: 'This request has already been decided' });
  }

  const note = (req.body?.note || '').trim();
  db.prepare(
    `UPDATE quote_requests SET status = 'declined', decision_note = ?, decided_by_name = ?, decided_at = datetime('now')
     WHERE id = ?`,
  ).run(note, req.user.name, request.id);

  const client = db.prepare('SELECT name FROM clients WHERE id = ?').get(request.client_id);
  logActivity({
    userName: req.user.name,
    action: 'declined a quote request from',
    entityType: 'quote_request',
    entityId: request.id,
    entityLabel: client.name,
  });

  res.json({ request: getRequestWithClient(request.id) });
});

// Called by the frontend right after a staff member saves the priced quote
// they built from this request (QuoteForm.jsx, pre-filled via ?requestId=)
// — the request itself carries no pricing/line items, so "approve" can't
// create a quote directly the way, say, routes/quotes.js's own
// duplicate/convert-to-invoice routes create their target row in one step.
router.post('/:id/link-quote', manage, (req, res) => {
  const request = db.prepare('SELECT * FROM quote_requests WHERE id = ?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Quote request not found' });
  if (request.status !== 'pending') {
    return res.status(409).json({ error: 'This request has already been decided' });
  }

  const quoteId = Number(req.body?.quote_id);
  const quote = db.prepare('SELECT * FROM quotes WHERE id = ?').get(quoteId);
  if (!quote) return res.status(400).json({ error: 'quote_id does not refer to a real quote' });
  if (quote.client_id !== request.client_id) {
    return res.status(400).json({ error: 'That quote was created for a different client' });
  }

  db.prepare(
    `UPDATE quote_requests SET status = 'approved', quote_id = ?, decided_by_name = ?, decided_at = datetime('now')
     WHERE id = ?`,
  ).run(quote.id, req.user.name, request.id);

  const client = db.prepare('SELECT name FROM clients WHERE id = ?').get(request.client_id);
  logActivity({
    userName: req.user.name,
    action: 'approved a quote request from',
    entityType: 'quote_request',
    entityId: request.id,
    entityLabel: `${client.name} → ${quote.number}`,
  });

  res.json({ request: getRequestWithClient(request.id) });
});

module.exports = router;
