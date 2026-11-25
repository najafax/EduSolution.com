const { Router } = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { sendMail, textToHtml, escapeHtml } = require('../lib/mailer');
const { logEmail } = require('../lib/emailLog');
const { loadBody, fetchAttachment } = require('../lib/inbox');

// The in-app inbox: client replies that arrive at info@edusolutionsmv.com
// (received by Resend, stored by routes/inboxWebhook.js). Gated on the
// existing email_center module — it is the same "email" area, and a separate
// module slot would just be one more thing to grant. Messages are never
// deleted here, only archived (same stance as quotes/invoices).
const router = Router();
router.use(requireAuth);
const view = requirePermission('email_center', 'view');
const manage = requirePermission('email_center', 'manage');

const PAGE_SIZE = 30;

function parseAttachments(value) {
  try {
    const list = JSON.parse(value || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function unreadCount() {
  return db.prepare('SELECT COUNT(*) AS n FROM inbound_emails WHERE is_read = 0 AND archived = 0').get().n;
}

router.get('/unread-count', view, (req, res) => {
  res.json({ count: unreadCount() });
});

router.get('/', view, (req, res) => {
  const status = ['inbox', 'unread', 'archived'].includes(req.query.status) ? req.query.status : 'inbox';
  const page = Math.max(1, Number(req.query.page) || 1);
  const q = String(req.query.q || '').trim();

  const where = [];
  const params = [];
  if (status === 'archived') where.push('m.archived = 1');
  else where.push('m.archived = 0');
  if (status === 'unread') where.push('m.is_read = 0');
  if (q) {
    const like = `%${q}%`;
    where.push('(m.from_email LIKE ? OR m.from_name LIKE ? OR m.subject LIKE ? OR m.text_body LIKE ? OR c.name LIKE ?)');
    params.push(like, like, like, like, like);
  }
  const clause = `WHERE ${where.join(' AND ')}`;

  const total = db
    .prepare(`SELECT COUNT(*) AS n FROM inbound_emails m LEFT JOIN clients c ON c.id = m.client_id ${clause}`)
    .get(...params).n;
  const rows = db
    .prepare(
      `SELECT m.id, m.from_email, m.from_name, m.subject, substr(m.text_body, 1, 160) AS snippet,
              m.is_read, m.archived, m.received_at, m.replied_at, m.client_id, c.name AS client_name,
              json_array_length(m.attachments) AS attachment_count
         FROM inbound_emails m LEFT JOIN clients c ON c.id = m.client_id
         ${clause}
        ORDER BY m.received_at DESC, m.id DESC
        LIMIT ? OFFSET ?`,
    )
    .all(...params, PAGE_SIZE, (page - 1) * PAGE_SIZE);

  res.json({
    messages: rows.map((r) => ({ ...r, is_read: Boolean(r.is_read), archived: Boolean(r.archived) })),
    page,
    pageSize: PAGE_SIZE,
    total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    unread: unreadCount(),
  });
});

function getMessage(id) {
  const row = db
    .prepare(
      `SELECT m.*, c.name AS client_name FROM inbound_emails m
         LEFT JOIN clients c ON c.id = m.client_id WHERE m.id = ?`,
    )
    .get(id);
  if (!row) return null;
  const { resend_email_id, attachments, ...rest } = row; // eslint-disable-line no-unused-vars
  return { ...rest, attachments: parseAttachments(attachments), is_read: Boolean(row.is_read), archived: Boolean(row.archived) };
}

router.get('/:id', view, (req, res) => {
  const msg = getMessage(req.params.id);
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  if (!msg.is_read) {
    db.prepare('UPDATE inbound_emails SET is_read = 1 WHERE id = ?').run(msg.id);
    msg.is_read = true;
  }
  res.json({ message: msg, unread: unreadCount() });
});

router.post('/:id/read', manage, (req, res) => {
  const read = req.body && req.body.read === false ? 0 : 1;
  const info = db.prepare('UPDATE inbound_emails SET is_read = ? WHERE id = ?').run(read, req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Message not found' });
  res.json({ message: getMessage(req.params.id), unread: unreadCount() });
});

router.post('/:id/archive', manage, (req, res) => {
  const archived = req.body && req.body.archived === false ? 0 : 1;
  const info = db.prepare('UPDATE inbound_emails SET archived = ? WHERE id = ?').run(archived, req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Message not found' });
  res.json({ message: getMessage(req.params.id), unread: unreadCount() });
});

// Re-fetch the body from Resend — for a message whose first fetch failed.
router.post('/:id/reload', manage, async (req, res) => {
  const exists = db.prepare('SELECT id FROM inbound_emails WHERE id = ?').get(req.params.id);
  if (!exists) return res.status(404).json({ error: 'Message not found' });
  await loadBody(exists.id);
  res.json({ message: getMessage(exists.id) });
});

router.post('/:id/client', manage, (req, res) => {
  const clientId = req.body && req.body.client_id ? Number(req.body.client_id) : null;
  if (clientId && !db.prepare('SELECT id FROM clients WHERE id = ?').get(clientId)) {
    return res.status(400).json({ error: 'Client not found' });
  }
  const info = db.prepare('UPDATE inbound_emails SET client_id = ? WHERE id = ?').run(clientId, req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Message not found' });
  res.json({ message: getMessage(req.params.id) });
});

router.post('/:id/reply', manage, async (req, res) => {
  const row = db.prepare('SELECT * FROM inbound_emails WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Message not found' });
  const message = String((req.body && req.body.message) || '').trim();
  if (!message) return res.status(400).json({ error: 'Write a reply first' });
  if (message.length > 20000) return res.status(400).json({ error: 'Reply is too long' });
  if (!row.from_email) return res.status(400).json({ error: 'This message has no sender address to reply to' });

  const ownAddress = String(process.env.SMTP_FROM || '').match(/<([^>]+)>/);
  const own = (ownAddress ? ownAddress[1] : process.env.SMTP_FROM || '').trim().toLowerCase();
  if (own && row.from_email === own) {
    return res.status(400).json({ error: 'This message came from our own address, so there is nobody to reply to' });
  }

  const base = row.subject.trim() || '(no subject)';
  const subject = /^re:/i.test(base) ? base : `Re: ${base}`;
  const quoted = String(row.text_body || '').slice(0, 5000);
  const who = row.from_name ? `${row.from_name} <${row.from_email}>` : row.from_email;
  const html =
    textToHtml(message) +
    (quoted
      ? `<blockquote style="margin:16px 0 0;padding-left:12px;border-left:3px solid #ccc;color:#666">` +
        `<p>On ${escapeHtml(row.received_at)} UTC, ${escapeHtml(who)} wrote:</p>` +
        `<p>${escapeHtml(quoted).replace(/\n/g, '<br>')}</p></blockquote>`
      : '');

  try {
    await sendMail({ to: row.from_email, subject, html });
  } catch (err) {
    const status = err.code === 'EMAIL_NOT_CONFIGURED' ? 503 : 502;
    return res.status(status).json({ error: err.message || 'Could not send the reply' });
  }

  db.prepare("UPDATE inbound_emails SET replied_at = datetime('now'), replied_by_name = ?, is_read = 1 WHERE id = ?").run(
    req.user.name,
    row.id,
  );
  logEmail({
    type: 'inbox_reply',
    to: row.from_email,
    subject,
    sentByName: req.user.name,
    entityType: row.client_id ? 'client' : null,
    entityId: row.client_id || null,
    entityLabel: row.from_name || row.from_email,
  });
  res.json({ message: getMessage(row.id) });
});

router.get('/:id/attachments/:attId', view, async (req, res) => {
  const row = db.prepare('SELECT * FROM inbound_emails WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Message not found' });
  if (!parseAttachments(row.attachments).some((a) => String(a.id) === String(req.params.attId))) {
    return res.status(404).json({ error: 'Attachment not found' });
  }
  try {
    const { buffer, filename, contentType } = await fetchAttachment(row, req.params.attId);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(buffer);
  } catch (err) {
    res.status(err.status === 404 ? 404 : 502).json({ error: err.message || 'Could not fetch the attachment' });
  }
});

module.exports = router;
