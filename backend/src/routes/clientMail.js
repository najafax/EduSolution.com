const { Router } = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../lib/activity');
const { checkInbox, sendReply, getSettings, addStarterRules, MODES } = require('../lib/clientMail');
const { gmailConfigured } = require('../lib/mailer');

// Auto-replies to client emails (lib/clientMail.js): settings, keyword rules,
// and the list of client emails with their drafted replies. Gated on its own
// 'client_mail' module — it reads client correspondence and can send in the
// business's name.
const router = Router();
router.use(requireAuth);
const view = requirePermission('client_mail', 'view');
const manage = requirePermission('client_mail', 'manage');
const PAGE_SIZE = 20;
const STATUSES = ['draft', 'sent', 'ignored', 'dismissed'];

router.get('/', view, (req, res) => {
  const status = STATUSES.includes(req.query.status) ? req.query.status : null;
  const page = Math.max(1, Number(req.query.page) || 1);
  const where = status ? 'WHERE m.status = ?' : "WHERE m.status != 'ignored'";
  const params = status ? [status] : [];
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM client_mail m ${where}`).get(...params);
  const messages = db
    .prepare(
      `SELECT m.*, c.name AS client_name, r.name AS rule_name
       FROM client_mail m LEFT JOIN clients c ON c.id = m.client_id LEFT JOIN client_mail_rules r ON r.id = m.rule_id
       ${where} ORDER BY m.id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, PAGE_SIZE, (page - 1) * PAGE_SIZE);
  const pending = db.prepare("SELECT COUNT(*) AS n FROM client_mail WHERE status = 'draft'").get().n;
  res.json({ messages, pending, page, pageSize: PAGE_SIZE, total, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)) });
});

router.get('/settings', view, (req, res) => {
  res.json({ settings: getSettings(), gmailConfigured: gmailConfigured() });
});

router.put('/settings', manage, (req, res) => {
  const { mode, signature } = req.body || {};
  if (!MODES.includes(mode)) return res.status(400).json({ error: 'Choose off, draft or auto.' });
  if (mode !== 'off' && !gmailConfigured()) return res.status(409).json({ error: 'Gmail is not configured on the server, so inbound mail cannot be read.' });
  const current = getSettings();
  // Switching on starts the clock: only mail that arrives from now on is looked at.
  const since = mode === 'off' ? current.enabled_since : current.mode === 'off' || !current.enabled_since ? db.prepare("SELECT datetime('now') AS t").get().t : current.enabled_since;
  db.prepare('UPDATE client_mail_settings SET mode = ?, signature = ?, enabled_since = ? WHERE id = 1').run(mode, String(signature || '').slice(0, 1000), since);
  if (mode !== current.mode) {
    logActivity({ userName: req.user.name, action: `set client auto-replies to "${mode}"`, entityType: 'client_mail', entityId: null, entityLabel: mode });
  }
  res.json({ settings: getSettings() });
});

router.post('/check-now', manage, async (req, res) => {
  try {
    const result = await checkInbox();
    if (result.skipped === 'off') return res.status(409).json({ error: 'Auto-replies are switched off.' });
    res.json(result);
  } catch (err) {
    res.status(err.code === 'GMAIL_NOT_CONFIGURED' ? 503 : 502).json({ error: err.message });
  }
});

// ---- Rules -----------------------------------------------------------------

function validateRule(body) {
  const b = body || {};
  const name = String(b.name || '').trim();
  const text = String(b.body || '').trim();
  if (!name) return { error: 'Give the rule a name.' };
  if (!text) return { error: 'Write the reply message.' };
  return {
    value: {
      name: name.slice(0, 100),
      keywords: String(b.keywords || '').trim().slice(0, 500),
      subject: String(b.subject || '').trim().slice(0, 200),
      body: text.slice(0, 5000),
      auto_send: b.auto_send ? 1 : 0,
      active: b.active === false || b.active === 0 ? 0 : 1,
      sort_order: Number.isFinite(Number(b.sort_order)) ? Math.trunc(Number(b.sort_order)) : 0,
    },
  };
}

router.get('/rules', view, (req, res) => {
  res.json({ rules: db.prepare('SELECT * FROM client_mail_rules ORDER BY sort_order, id').all() });
});

router.post('/rules', manage, (req, res) => {
  const { error, value } = validateRule(req.body);
  if (error) return res.status(400).json({ error });
  const r = db
    .prepare('INSERT INTO client_mail_rules (name, keywords, subject, body, auto_send, active, sort_order) VALUES (@name, @keywords, @subject, @body, @auto_send, @active, @sort_order)')
    .run(value);
  logActivity({ userName: req.user.name, action: 'created an auto-reply rule', entityType: 'client_mail', entityId: r.lastInsertRowid, entityLabel: value.name });
  res.status(201).json({ rule: db.prepare('SELECT * FROM client_mail_rules WHERE id = ?').get(r.lastInsertRowid) });
});

router.post('/rules/starter', manage, (req, res) => {
  const added = addStarterRules();
  if (added) logActivity({ userName: req.user.name, action: `added ${added} starter auto-reply rule(s)`, entityType: 'client_mail', entityId: null, entityLabel: '' });
  res.json({ added });
});

router.put('/rules/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT id FROM client_mail_rules WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Rule not found' });
  const { error, value } = validateRule(req.body);
  if (error) return res.status(400).json({ error });
  db.prepare('UPDATE client_mail_rules SET name = @name, keywords = @keywords, subject = @subject, body = @body, auto_send = @auto_send, active = @active, sort_order = @sort_order WHERE id = @id').run({ ...value, id: existing.id });
  logActivity({ userName: req.user.name, action: 'updated an auto-reply rule', entityType: 'client_mail', entityId: existing.id, entityLabel: value.name });
  res.json({ rule: db.prepare('SELECT * FROM client_mail_rules WHERE id = ?').get(existing.id) });
});

router.delete('/rules/:id', manage, (req, res) => {
  const rule = db.prepare('SELECT id, name FROM client_mail_rules WHERE id = ?').get(req.params.id);
  if (!rule) return res.status(404).json({ error: 'Rule not found' });
  db.prepare('DELETE FROM client_mail_rules WHERE id = ?').run(rule.id);
  logActivity({ userName: req.user.name, action: 'deleted an auto-reply rule', entityType: 'client_mail', entityId: rule.id, entityLabel: rule.name });
  res.json({ ok: true });
});

// ---- Handling one message --------------------------------------------------

router.post('/:id/send', manage, async (req, res) => {
  const row = db.prepare('SELECT id FROM client_mail WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Message not found' });
  try {
    const sent = await sendReply(row.id, {
      subject: String(req.body?.subject || ''),
      body: String(req.body?.body || ''),
      actor: req.user.name,
    });
    res.json({ message: sent });
  } catch (err) {
    if (err.code === 'NOT_DRAFT') return res.status(409).json({ error: err.message });
    if (err.code === 'EMPTY') return res.status(400).json({ error: err.message });
    if (err.code === 'EMAIL_NOT_CONFIGURED') return res.status(503).json({ error: err.message });
    console.error('[client-mail] send failed:', err.message);
    res.status(502).json({ error: `The reply could not be sent: ${err.message}` });
  }
});

// Save an edited reply without sending it.
router.put('/:id', manage, (req, res) => {
  const r = db
    .prepare("UPDATE client_mail SET reply_subject = ?, reply_body = ? WHERE id = ? AND status = 'draft'")
    .run(String(req.body?.subject || ''), String(req.body?.body || ''), req.params.id);
  if (!r.changes) return res.status(409).json({ error: 'Only an unsent draft can be edited.' });
  res.json({ message: db.prepare('SELECT * FROM client_mail WHERE id = ?').get(req.params.id) });
});

router.post('/:id/dismiss', manage, (req, res) => {
  const r = db
    .prepare("UPDATE client_mail SET status = 'dismissed', handled_by_name = ?, handled_at = datetime('now') WHERE id = ? AND status = 'draft'")
    .run(req.user.name, req.params.id);
  if (!r.changes) return res.status(409).json({ error: 'This message has already been handled.' });
  res.json({ ok: true });
});

module.exports = router;
