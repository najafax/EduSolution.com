const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { clientErrorLimiter } = require('../middleware/rateLimit');
const { recordError } = require('../lib/errorLog');
const jwt = require('jsonwebtoken');

// Best-effort: who was signed in (name only). Never trusted for access.
function tokenUser(token) {
  try {
    const p = jwt.verify(token, process.env.JWT_SECRET);
    if (p.type === 'client' || p.type === 'mfa') return null;
    return db.prepare('SELECT id, name FROM users WHERE id = ?').get(p.id) || null;
  } catch {
    return null;
  }
}

// Browser error intake: unauthenticated on purpose (the login page can crash
// too), so it is rate limited, size limited, and only ever writes one
// de-duplicated row — it never returns anything useful to the caller.
const intake = express.Router();
intake.post('/', clientErrorLimiter, (req, res) => {
  const b = req.body || {};
  if (typeof b.message !== 'string' || !b.message.trim()) return res.status(400).json({ error: 'message required' });
  let user = null;
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (m) user = tokenUser(m[1]);
  recordError({
    source: 'browser',
    message: b.message,
    stack: typeof b.stack === 'string' ? b.stack : '',
    url: typeof b.url === 'string' ? b.url : '',
    userAgent: req.headers['user-agent'],
    userId: user?.id,
    userName: user?.name,
  });
  res.status(204).end();
});

// Admin viewer.
const admin = express.Router();
admin.use(requireAuth, requireAdmin);

admin.get('/', (req, res) => {
  const status = req.query.status === 'resolved' ? 1 : 0;
  const rows = db
    .prepare('SELECT * FROM error_log WHERE resolved = ? ORDER BY last_seen_at DESC, id DESC LIMIT 200')
    .all(status);
  const open = db.prepare('SELECT COUNT(*) n FROM error_log WHERE resolved = 0').get().n;
  res.json({ errors: rows, openCount: open });
});

admin.post('/:id/resolve', (req, res) => {
  const r = db.prepare('UPDATE error_log SET resolved = 1 WHERE id = ?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

admin.post('/resolve-all', (req, res) => {
  db.prepare('UPDATE error_log SET resolved = 1 WHERE resolved = 0').run();
  res.json({ ok: true });
});

module.exports = { intake, admin };
