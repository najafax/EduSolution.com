const { Router } = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { getAllTemplates, setTemplate, resetTemplate } = require('../lib/emailTemplates');

const router = Router();
// Admin-only for now (see CLAUDE.md) — same requireAdmin pattern as
// routes/dataReset.js, bypassing the per-module user_permissions grant
// system entirely rather than adding a new gatable module. Could move to
// requirePermission('email_center', ...) later if this needs to open up to
// staff, but that's a deliberate future call, not an oversight.
router.use(requireAuth);
router.use(requireAdmin);

// Human label for the log entry types that have no editable template — the
// automated overdue-reminder digest and the automated license-expiry alert
// (see lib/scheduler.js and lib/emailTemplates.js's own doc comment for why
// those stay non-customizable), plus the manual license renewal
// confirmation (lib/licenseRenewalEmail.js) — a fixed designed HTML
// summary of the license's own data, not prose an admin would rewrite, so
// it's outside the template system the same way the automated two are.
// The editable types already carry a `label` from getAllTemplates(),
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
  overdue_reminder: 'Automated overdue reminder',
  license_expiry_alert: 'Automated license expiry alert',
  campaign: 'Promotional campaign',
};

router.get('/templates', (req, res) => {
  res.json({ templates: getAllTemplates() });
});

router.put('/templates/:type', (req, res) => {
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

router.post('/templates/:type/reset', (req, res) => {
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
router.get('/log', (req, res) => {
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
