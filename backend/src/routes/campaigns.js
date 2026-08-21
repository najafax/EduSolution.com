const { Router } = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../lib/activity');
const { logEmail } = require('../lib/emailLog');
const { sendMail, textToHtml } = require('../lib/mailer');

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
  const { subject, message, recipientType } = req.body || {};
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

  const html = textToHtml(message);
  const failures = [];
  let sentCount = 0;

  // Sequential, not Promise.all — a bulk send shouldn't hammer the SMTP
  // server with dozens of simultaneous connections, and this app's
  // single-business scale (a handful to low hundreds of clients) makes the
  // extra time negligible. One client's rejected/invalid address doesn't
  // abort the rest of the run.
  for (const client of recipients) {
    try {
      await sendMail({ to: client.email, subject: subject.trim(), html });
      logEmail({
        type: 'campaign',
        to: client.email,
        subject: subject.trim(),
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
      failures.push({ client_id: client.id, name: client.name, error: err.message });
    }
  }

  const campaign = db
    .prepare(
      `INSERT INTO campaigns (subject, message, recipient_type, recipient_count, sent_count, failed_count, sent_by_name)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(subject.trim(), message.trim(), type, recipients.length, sentCount, failures.length, req.user.name);

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
