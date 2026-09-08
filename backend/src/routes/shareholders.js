const { Router } = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../lib/activity');
const { runDailyEarningsReport } = require('../lib/dailyEarningsReport');

// The recipient list behind the automated daily-earnings email (see
// lib/dailyEarningsReport.js / lib/scheduler.js's runDailyEarningsReport()
// job) — a shareholder here is purely a name + email to notify, no login,
// no permissions. Gated on the existing 'financials' permission rather
// than a new MODULES entry, same "reuse when the sensitivity level
// already matches" call routes/reports.js/routes/capitalContributions.js
// already make elsewhere — a shareholder list, and what it's used to
// email, is squarely financial-summary-sensitive data.
const router = Router();
router.use(requireAuth);
const view = requirePermission('financials', 'view');
const manage = requirePermission('financials', 'manage');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ownership_percent (optional, 0-100, defaults to 0) is how much of a
// distributed deal's net profit this shareholder is owed — see
// routes/deals.js's own POST /:id/distribute — editable under the same
// `financials` permission as everything else on this router, so no extra
// gate is needed just for this one field.
function validate({ name, email, ownership_percent }) {
  if (!name || !name.trim()) return 'Name is required';
  if (!email || !EMAIL_RE.test(email.trim())) return 'A valid email is required';
  if (ownership_percent !== undefined && ownership_percent !== null && ownership_percent !== '') {
    const pct = Number(ownership_percent);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return 'Ownership percent must be a number between 0 and 100';
  }
  return null;
}

// No pagination/search — a shareholder list is inherently small (a
// handful of people at most), the same "don't build it until needed" call
// this app already makes for other small per-entity lists (e.g.
// routes/licenses.js's own GET /:id/renewals).
router.get('/', view, (req, res) => {
  const shareholders = db.prepare('SELECT * FROM shareholders ORDER BY name COLLATE NOCASE').all();
  res.json({ shareholders });
});

router.post('/', manage, (req, res) => {
  const { name = '', email = '', active = true, ownership_percent = 0 } = req.body || {};
  const error = validate({ name, email, ownership_percent });
  if (error) return res.status(400).json({ error });

  const info = db
    .prepare('INSERT INTO shareholders (name, email, active, ownership_percent) VALUES (?, ?, ?, ?)')
    .run(name.trim(), email.trim(), active ? 1 : 0, Number(ownership_percent) || 0);
  const shareholder = db.prepare('SELECT * FROM shareholders WHERE id = ?').get(info.lastInsertRowid);
  logActivity({ userName: req.user.name, action: 'added', entityType: 'shareholder', entityId: shareholder.id, entityLabel: shareholder.name });
  res.status(201).json({ shareholder });
});

router.put('/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM shareholders WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Shareholder not found' });

  const {
    name = existing.name,
    email = existing.email,
    active = Boolean(existing.active),
    ownership_percent = existing.ownership_percent,
  } = req.body || {};
  const error = validate({ name, email, ownership_percent });
  if (error) return res.status(400).json({ error });

  db.prepare('UPDATE shareholders SET name = ?, email = ?, active = ?, ownership_percent = ? WHERE id = ?').run(
    name.trim(),
    email.trim(),
    active ? 1 : 0,
    Number(ownership_percent) || 0,
    req.params.id,
  );
  const shareholder = db.prepare('SELECT * FROM shareholders WHERE id = ?').get(req.params.id);
  logActivity({ userName: req.user.name, action: 'updated', entityType: 'shareholder', entityId: shareholder.id, entityLabel: shareholder.name });
  res.json({ shareholder });
});

router.delete('/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM shareholders WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Shareholder not found' });

  db.prepare('DELETE FROM shareholders WHERE id = ?').run(req.params.id);
  logActivity({ userName: req.user.name, action: 'deleted', entityType: 'shareholder', entityId: existing.id, entityLabel: existing.name });
  res.json({ ok: true });
});

// Runs the exact same job the 08:20 cron trigger fires — see
// lib/dailyEarningsReport.js — on demand, for yesterday's date, so an
// admin can verify the pipeline (and resend if a prior run failed) without
// waiting for tomorrow morning. Not logged as a distinct activity entry of
// its own beyond what the job itself already logs (one summary row per
// send, whether triggered by cron or this button) — see that module's own
// note on why.
router.post('/send-report', manage, async (req, res) => {
  try {
    const result = await runDailyEarningsReport();
    res.json(result);
  } catch (err) {
    console.error('[shareholders] manual send-report failed:', err);
    res.status(500).json({ error: 'Failed to send the daily earnings report' });
  }
});

module.exports = router;
