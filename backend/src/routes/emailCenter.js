const { Router } = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { getAllTemplates, setTemplate, resetTemplate } = require('../lib/emailTemplates');

const router = Router();
router.use(requireAuth);
const view = requirePermission('email_center', 'view');
const manage = requirePermission('email_center', 'manage');

// Human label for the log entry types that have no editable template — the
// automated license-expiry alert (which reuses license_remind's own
// editable template rather than carrying one of its own, see
// lib/scheduler.js), the manual license renewal confirmation
// (lib/licenseRenewalEmail.js — a fixed designed HTML summary of the
// license's own data, not prose an admin would rewrite), and promotional
// campaigns (which are one-off copy written fresh per send, not a
// recurring transactional message with a template to edit). `overdue_reminder`
// (with no `_soft`/`_firm`/`_final` suffix) is kept here too purely so a
// sent-log entry written before the automated overdue-reminder digest
// became customizable (see lib/emailTemplates.js's own note on
// overdue_reminder_soft/_firm/_final) still renders with a real label
// instead of falling back to its raw type string — no code path writes
// that literal type anymore. The editable types (including the three
// dunning-ladder stages, now customizable via the Email Center same as
// every other template) already carry a `label` from getAllTemplates(),
// duplicated here too since this map backs a different endpoint (the sent
// log, not the template editor).
const TYPE_LABELS = {
  quote_send: 'Quote sent',
  invoice_send: 'Invoice sent',
  invoice_remind: 'Payment reminder',
  receipt_send: 'Payment receipt',
  license_remind: 'License renewal reminder',
  license_renewal_confirm: 'License renewal confirmation',
  portal_invite: 'Portal invite',
  overdue_reminder_soft: 'Overdue reminder (early)',
  overdue_reminder_firm: 'Overdue reminder (firm)',
  overdue_reminder_final: 'Overdue reminder (final notice)',
  overdue_reminder: 'Automated overdue reminder',
  license_expiry_alert: 'Automated license expiry alert',
  campaign: 'Promotional campaign',
};

router.get('/templates', view, (req, res) => {
  res.json({ templates: getAllTemplates() });
});

router.put('/templates/:type', manage, (req, res) => {
  const { subject, message } = req.body || {};
  if (!subject || !subject.trim() || !message || !message.trim()) {
    return res.status(400).json({ error: 'subject and message are required' });
  }
  try {
    setTemplate(req.params.type, { subject: subject.trim(), message: message.trim() });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  res.json({ templates: getAllTemplates() });
});

router.post('/templates/:type/reset', manage, (req, res) => {
  try {
    resetTemplate(req.params.type);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  res.json({ templates: getAllTemplates() });
});

const PAGE_SIZE = 30;

// Sent log — mirrors routes/activity.js's pagination pattern exactly
// (always paginated, not opt-in like the business list routes' `?page=`
// convention) since this is a chronological audit feed, not a pickable list.
router.get('/log', view, (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const { total } = db.prepare('SELECT COUNT(*) AS total FROM email_log').get();
  const rows = db
    .prepare('SELECT * FROM email_log ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?')
    .all(PAGE_SIZE, offset);
  const entries = rows.map((row) => ({ ...row, type_label: TYPE_LABELS[row.type] || row.type }));
  res.json({ entries, page, pageSize: PAGE_SIZE, total, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)) });
});

module.exports = router;
