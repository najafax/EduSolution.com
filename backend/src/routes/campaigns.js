const { Router } = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../lib/activity');
const { logEmail } = require('../lib/emailLog');
const { sendMail, textToHtml } = require('../lib/mailer');
const { renderTemplate } = require('../lib/emailTemplates');

const router = Router();
router.use(requireAuth);
const view = requirePermission('campaigns', 'view');
const manage = requirePermission('campaigns', 'manage');

const PAGE_SIZE = 20;

// Always paginated, newest first — same convention as routes/emailCenter.js's
// own sent log (a chronological history feed, not a pickable list, so it
// doesn't need the business list routes' opt-in `?page=` convention).
router.get('/', view, (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const { total } = db.prepare('SELECT COUNT(*) AS total FROM campaigns').get();
  const campaigns = db
    .prepare('SELECT * FROM campaigns ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?')
    .all(PAGE_SIZE, offset);
  res.json({ campaigns, page, pageSize: PAGE_SIZE, total, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)) });
});

// Per-recipient detail behind a campaign's own failed_count — see
// db/index.js's campaign_failures note for why this exists as its own
// route rather than being folded into GET /.
router.get('/:id/failures', view, (req, res) => {
  const failures = db
    .prepare('SELECT client_id, client_name, client_email, error FROM campaign_failures WHERE campaign_id = ? ORDER BY id')
    .all(req.params.id);
  res.json({ failures });
});

// Resolves the target recipient list server-side — the frontend only ever
// sends *which* clients it means (recipientType + optional clientIds), never
// the resolved email addresses themselves, so there's no way for a stale or
// tampered client list to send mail to the wrong address.
function resolveRecipients({ recipientType, clientIds }) {
  if (recipientType === 'selected') {
    if (!Array.isArray(clientIds) || clientIds.length === 0) {
      const err = new Error('Select at least one client');
      err.status = 400;
      throw err;
    }
    const placeholders = clientIds.map(() => '?').join(',');
    return db
      .prepare(`SELECT id, name, email FROM clients WHERE id IN (${placeholders}) AND TRIM(COALESCE(email, '')) != ''`)
      .all(...clientIds);
  }
  return db.prepare("SELECT id, name, email FROM clients WHERE TRIM(COALESCE(email, '')) != ''").all();
}

// A bulk/promotional email — the "single & bulk" send this feature exists
// for is really the same action either way: 'selected' with one clientId
// is exactly how the Clients page's own per-row "Send email" shortcut
// sends to just that one client, no separate code path needed.
router.post('/', manage, async (req, res) => {
  const { subject, message, recipientType, recipientData } = req.body || {};
  if (!subject || !subject.trim() || !message || !message.trim()) {
    return res.status(400).json({ error: 'Subject and message are required' });
  }
  const type = recipientType === 'selected' ? 'selected' : 'all';

  let recipients;
  try {
    recipients = resolveRecipients({ recipientType: type, clientIds: req.body?.clientIds });
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }

  if (recipients.length === 0) {
    return res.status(400).json({
      error:
        type === 'all'
          ? 'No clients have an email address on file'
          : 'None of the selected clients have an email address on file',
    });
  }

  const failures = [];
  let sentCount = 0;

  // Sequential, not Promise.all — a bulk send shouldn't hammer the SMTP
  // server with dozens of simultaneous connections, and this app's
  // single-business scale (a handful to low hundreds of clients) makes the
  // extra time negligible. One client's rejected/invalid address doesn't
  // abort the rest of the run.
  //
  // Subject/message are rendered per recipient via the same
  // {{placeholder}} substitution lib/emailTemplates.js's own transactional
  // sends already use (renderTemplate) — recipientData is an optional
  // { [clientId]: { key: value } } map the caller supplies (e.g.
  // Licenses.jsx's "Email cancelled clients" passes each client's own
  // license_url), so a genuinely one-to-many campaign with no merge data
  // renders identically to before (renderTemplate against an empty vars
  // object just leaves any literal {{...}} in the text untouched).
  for (const client of recipients) {
    const vars = (recipientData && recipientData[client.id]) || {};
    const subjectForClient = renderTemplate(subject.trim(), vars);
    const messageForClient = renderTemplate(message, vars);
    try {
      await sendMail({ to: client.email, subject: subjectForClient, html: textToHtml(messageForClient) });
      logEmail({
        type: 'campaign',
        to: client.email,
        subject: subjectForClient,
        sentByName: req.user.name,
        entityType: 'client',
        entityId: client.id,
        entityLabel: client.name,
      });
      sentCount += 1;
    } catch (err) {
      if (err.code === 'EMAIL_NOT_CONFIGURED') {
        return res.status(503).json({ error: err.message });
      }
      failures.push({ client_id: client.id, name: client.name, email: client.email, error: err.message });
    }
  }

  const campaign = db
    .prepare(
      `INSERT INTO campaigns (subject, message, recipient_type, recipient_count, sent_count, failed_count, sent_by_name)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(subject.trim(), message.trim(), type, recipients.length, sentCount, failures.length, req.user.name);

  // Persist which specific recipients failed and why — the `failures`
  // array above only ever lived in this one HTTP response before this;
  // once the page reloaded or the toast dismissed, there was no way to
  // find out who didn't get the email. GET /:id/failures below reads
  // this back for the Campaigns page's "View failed recipients" action.
  if (failures.length > 0) {
    const insertFailure = db.prepare(
      `INSERT INTO campaign_failures (campaign_id, client_id, client_name, client_email, error) VALUES (?, ?, ?, ?, ?)`,
    );
    const insertAll = db.transaction((rows) => {
      for (const f of rows) {
        insertFailure.run(campaign.lastInsertRowid, f.client_id, f.name, f.email, f.error);
      }
    });
    insertAll(failures);
  }

  logActivity({
    userName: req.user.name,
    action: 'sent campaign',
    entityType: 'campaign',
    entityId: campaign.lastInsertRowid,
    entityLabel: `"${subject.trim()}" to ${sentCount} of ${recipients.length} recipient${recipients.length === 1 ? '' : 's'}`,
  });

  res.status(201).json({
    campaign: db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaign.lastInsertRowid),
    sentCount,
    failedCount: failures.length,
    failures,
  });
});

module.exports = router;
