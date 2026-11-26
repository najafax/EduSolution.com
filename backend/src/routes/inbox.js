const { Router } = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { escapeHtml } = require('../lib/mailer');
const { loadBody, fetchAttachment, matchClientId } = require('../lib/inbox');
const { splitEmails } = require('../lib/emails');
const outbox = require('../lib/outbox');

// The in-app mailbox for info@edusolutionsmv.com. Mail arrives at Resend and is
// stored by routes/inboxWebhook.js; staff read it here, reply, write new mail,
// forward, and keep what they sent in a Sent folder. Gated on the existing
// email_center module — it is the same "email" area, and a separate module slot
// would just be one more thing to grant.
//
// Resend is not an IMAP mailbox host, so this page IS the mailbox: there is no
// way to open info@ in a phone or desktop mail app.
const router = Router();
router.use(requireAuth);
const view = requirePermission('email_center', 'view');
const manage = requirePermission('email_center', 'manage');

const PAGE_SIZE = 30;
const SIGNATURE_MAX = 2000;

function parseAttachments(value) {
  try {
    const list = JSON.parse(value || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

// Folders over inbound mail. "Sent" is its own table (see /sent below).
const FOLDERS = {
  inbox: 'm.archived = 0 AND m.trashed = 0 AND m.spam = 0',
  unread: 'm.archived = 0 AND m.trashed = 0 AND m.spam = 0 AND m.is_read = 0',
  archived: 'm.archived = 1 AND m.trashed = 0 AND m.spam = 0',
  spam: 'm.spam = 1 AND m.trashed = 0',
  trash: 'm.trashed = 1',
};

function counts() {
  const n = (clause) => db.prepare(`SELECT COUNT(*) AS n FROM inbound_emails m WHERE ${clause}`).get().n;
  return { unread: n(FOLDERS.unread), spam: n(FOLDERS.spam), trash: n(FOLDERS.trash) };
}
const unreadCount = () => counts().unread;

const escapeLike = (s) => String(s).replace(/[\\%_]/g, (c) => `\\${c}`);

// Maps a send failure to an HTTP status: no transport configured is 503, a
// provider rejection is 502.
function sendFailure(res, err) {
  const status = err.code === 'EMAIL_NOT_CONFIGURED' ? 503 : 502;
  return res.status(status).json({ error: err.message || 'Could not send the message' });
}

router.get('/unread-count', view, (req, res) => {
  res.json({ count: unreadCount() });
});

// ---- signature (per staff member) -----------------------------------------
router.get('/signature', view, (req, res) => {
  const row = db.prepare('SELECT email_signature FROM users WHERE id = ?').get(req.user.id);
  res.json({ signature: (row && row.email_signature) || '' });
});

router.put('/signature', manage, (req, res) => {
  const signature = String((req.body && req.body.signature) || '').replace(/\r\n/g, '\n').trim();
  if (signature.length > SIGNATURE_MAX) {
    return res.status(400).json({ error: `The signature can be at most ${SIGNATURE_MAX} characters` });
  }
  db.prepare('UPDATE users SET email_signature = ? WHERE id = ?').run(signature, req.user.id);
  res.json({ signature });
});

// ---- Sent folder ----------------------------------------------------------
router.get('/sent', view, (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const q = String(req.query.q || '').trim();
  const where = [];
  const params = [];
  if (q) {
    const like = `%${q}%`;
    where.push('(s.to_emails LIKE ? OR s.cc_emails LIKE ? OR s.subject LIKE ? OR s.text_body LIKE ? OR c.name LIKE ?)');
    params.push(like, like, like, like, like);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db
    .prepare(`SELECT COUNT(*) AS n FROM sent_emails s LEFT JOIN clients c ON c.id = s.client_id ${clause}`)
    .get(...params).n;
  const messages = db
    .prepare(
      `SELECT s.id, s.kind, s.to_emails, s.subject, substr(s.text_body, 1, 160) AS snippet, s.sent_by_name,
              s.created_at, s.client_id, c.name AS client_name,
              (SELECT COUNT(*) FROM sent_email_files f WHERE f.sent_email_id = s.id) AS attachment_count
         FROM sent_emails s LEFT JOIN clients c ON c.id = s.client_id
         ${clause}
        ORDER BY s.created_at DESC, s.id DESC
        LIMIT ? OFFSET ?`,
    )
    .all(...params, PAGE_SIZE, (page - 1) * PAGE_SIZE);
  res.json({
    messages,
    page,
    pageSize: PAGE_SIZE,
    total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    ...counts(),
  });
});

router.get('/sent/:id', view, (req, res) => {
  const row = db
    .prepare('SELECT s.*, c.name AS client_name FROM sent_emails s LEFT JOIN clients c ON c.id = s.client_id WHERE s.id = ?')
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Message not found' });
  const files = db
    .prepare('SELECT id, filename, content_type, size FROM sent_email_files WHERE sent_email_id = ? ORDER BY id')
    .all(row.id);
  res.json({ message: { ...row, attachments: files } });
});

router.get('/sent/:id/files/:fileId', view, (req, res) => {
  const f = db
    .prepare('SELECT filename, content_type, data FROM sent_email_files WHERE id = ? AND sent_email_id = ?')
    .get(req.params.fileId, req.params.id);
  if (!f) return res.status(404).json({ error: 'Attachment not found' });
  res.setHeader('Content-Type', f.content_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(f.filename)}`);
  res.send(f.data);
});

// ---- write a new message ----------------------------------------------------
router.post('/compose', manage, async (req, res) => {
  const body = req.body || {};
  const addressing = outbox.parseAddressing(body);
  if (!addressing.ok) return res.status(400).json({ error: addressing.message });
  const uploads = outbox.parseUploads(body.attachments);
  if (!uploads.ok) return res.status(400).json({ error: uploads.message });
  const msg = outbox.checkMessage(body.message, uploads.files);
  if (!msg.ok) return res.status(400).json({ error: msg.message });

  const clientId = matchClientId(addressing.to[0].toLowerCase());
  try {
    const id = await outbox.sendAndRecord({
      kind: 'compose',
      addressing,
      subject: outbox.cleanSubject(body.subject),
      text: msg.text,
      files: uploads.files,
      clientId,
      user: req.user,
    });
    res.status(201).json({ id });
  } catch (err) {
    sendFailure(res, err);
  }
});

// ---- inbound list ------------------------------------------------------------
router.delete('/trash', manage, (req, res) => {
  const info = db.prepare('DELETE FROM inbound_emails WHERE trashed = 1').run();
  res.json({ deleted: info.changes, ...counts() });
});

router.get('/', view, (req, res) => {
  const status = Object.keys(FOLDERS).includes(req.query.status) ? req.query.status : 'inbox';
  const page = Math.max(1, Number(req.query.page) || 1);
  const q = String(req.query.q || '').trim();

  const where = [FOLDERS[status]];
  const params = [];
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
    ...counts(),
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
  const { resend_email_id, attachments, references_hdr, ...rest } = row; // eslint-disable-line no-unused-vars

  // Who "Reply all" would write to: the sender, plus everyone else on the
  // message except our own address and the sender.
  const skip = new Set([...outbox.ownAddresses(), String(row.from_email || '').toLowerCase()].filter(Boolean));
  const others = [...splitEmails(row.to_emails), ...splitEmails(row.cc_emails)].filter((e) => !skip.has(e.toLowerCase()));
  const seen = new Set();
  const cc = others.filter((e) => (seen.has(e.toLowerCase()) ? false : (seen.add(e.toLowerCase()), true)));

  return {
    ...rest,
    attachments: parseAttachments(attachments),
    is_read: Boolean(row.is_read),
    archived: Boolean(row.archived),
    spam: Boolean(row.spam),
    trashed: Boolean(row.trashed),
    reply_all_cc: cc,
  };
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

// Earlier messages with the same person, both directions, oldest first.
router.get('/:id/thread', view, (req, res) => {
  const row = db.prepare('SELECT id, from_email FROM inbound_emails WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Message not found' });
  const email = String(row.from_email || '').toLowerCase();
  if (!email) return res.json({ items: [] });

  const inbound = db
    .prepare(
      `SELECT id, subject, text_body, from_name, from_email, received_at AS at
         FROM inbound_emails
        WHERE lower(from_email) = ? AND trashed = 0 AND spam = 0
        ORDER BY received_at DESC, id DESC LIMIT 30`,
    )
    .all(email);
  const needle = `%, ${escapeLike(email)}, %`;
  const sent = db
    .prepare(
      `SELECT id, subject, text_body, sent_by_name, kind, created_at AS at
         FROM sent_emails
        WHERE (', ' || lower(to_emails) || ', ') LIKE ? ESCAPE '\\'
           OR (', ' || lower(cc_emails) || ', ') LIKE ? ESCAPE '\\'
        ORDER BY created_at DESC, id DESC LIMIT 30`,
    )
    .all(needle, needle);

  const items = [
    ...inbound.map((m) => ({
      direction: 'in',
      id: m.id,
      subject: m.subject,
      text: String(m.text_body || '').slice(0, 3000),
      at: m.at,
      who: m.from_name || m.from_email,
    })),
    ...sent.map((m) => ({
      direction: 'out',
      id: m.id,
      kind: m.kind,
      subject: m.subject,
      text: String(m.text_body || '').slice(0, 3000),
      at: m.at,
      who: m.sent_by_name || 'Staff',
    })),
  ]
    .sort((a, b) => (a.at === b.at ? (a.direction === b.direction ? a.id - b.id : a.direction === 'in' ? -1 : 1) : a.at < b.at ? -1 : 1))
    .slice(-40);
  res.json({ items });
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

// Spam is a manual flag (there is no automatic filter): it moves the message
// out of the inbox and out of the unread count, and "Not spam" brings it back.
router.post('/:id/spam', manage, (req, res) => {
  const spam = req.body && req.body.spam === false ? 0 : 1;
  const info = db.prepare('UPDATE inbound_emails SET spam = ? WHERE id = ?').run(spam, req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Message not found' });
  res.json({ message: getMessage(req.params.id), unread: unreadCount(), ...counts() });
});

// Trash is recoverable; a message in trash is removed for good only by
// "Delete forever", "Empty trash", or the 30-day clean-up.
router.post('/:id/trash', manage, (req, res) => {
  const trashed = req.body && req.body.trashed === false ? 0 : 1;
  const info = db
    .prepare("UPDATE inbound_emails SET trashed = ?, trashed_at = CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END WHERE id = ?")
    .run(trashed, trashed, req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Message not found' });
  res.json({ message: getMessage(req.params.id), unread: unreadCount(), ...counts() });
});

router.delete('/:id', manage, (req, res) => {
  const row = db.prepare('SELECT trashed FROM inbound_emails WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Message not found' });
  if (!row.trashed) return res.status(409).json({ error: 'Move the message to trash first' });
  db.prepare('DELETE FROM inbound_emails WHERE id = ?').run(req.params.id);
  res.json({ ok: true, ...counts() });
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

function quotedOriginal(row) {
  const quoted = String(row.text_body || '').slice(0, 5000);
  if (!quoted) return '';
  const who = row.from_name ? `${row.from_name} <${row.from_email}>` : row.from_email;
  return (
    `<blockquote style="margin:16px 0 0;padding-left:12px;border-left:3px solid #ccc;color:#666">` +
    `<p>On ${escapeHtml(row.received_at)} UTC, ${escapeHtml(who)} wrote:</p>` +
    `<p>${escapeHtml(quoted).replace(/\n/g, '<br>')}</p></blockquote>`
  );
}

router.post('/:id/reply', manage, async (req, res) => {
  const row = db.prepare('SELECT * FROM inbound_emails WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Message not found' });
  const body = req.body || {};

  const uploads = outbox.parseUploads(body.attachments);
  if (!uploads.ok) return res.status(400).json({ error: uploads.message });
  const message = String(body.message || '').trim();
  if (!message) return res.status(400).json({ error: 'Write a reply first' });
  const msg = outbox.checkMessage(message, uploads.files);
  if (!msg.ok) return res.status(400).json({ error: msg.message });

  const addressing = outbox.parseAddressing({
    to: body.to !== undefined ? body.to : row.from_email,
    cc: body.cc,
    bcc: body.bcc,
  });
  if (!addressing.ok) {
    return res.status(400).json({
      error: row.from_email ? addressing.message : 'This message has no sender address to reply to',
    });
  }
  const own = outbox.ownAddresses();
  if (addressing.to.every((e) => own.has(e.toLowerCase())) && addressing.cc.length === 0) {
    return res.status(400).json({ error: 'This message came from our own address, so there is nobody to reply to' });
  }

  const base = row.subject.trim() || '(no subject)';
  const defaultSubject = /^re:/i.test(base) ? base : `Re: ${base}`;
  const subject = String(body.subject || '').trim() ? outbox.cleanSubject(body.subject) : defaultSubject;

  try {
    await outbox.sendAndRecord({
      kind: 'reply',
      addressing,
      subject,
      text: msg.text,
      extraHtml: quotedOriginal(row),
      files: uploads.files,
      headers: outbox.threadHeaders(row),
      inReplyToId: row.id,
      clientId: row.client_id || null,
      user: req.user,
    });
  } catch (err) {
    return sendFailure(res, err);
  }

  db.prepare("UPDATE inbound_emails SET replied_at = datetime('now'), replied_by_name = ?, is_read = 1 WHERE id = ?").run(
    req.user.name,
    row.id,
  );
  res.json({ message: getMessage(row.id) });
});

router.post('/:id/forward', manage, async (req, res) => {
  const row = db.prepare('SELECT * FROM inbound_emails WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Message not found' });
  const body = req.body || {};

  const addressing = outbox.parseAddressing(body);
  if (!addressing.ok) return res.status(400).json({ error: addressing.message });
  let uploads = outbox.parseUploads(body.attachments);
  if (!uploads.ok) return res.status(400).json({ error: uploads.message });

  if (body.include_attachments) {
    const originals = [];
    for (const a of parseAttachments(row.attachments)) {
      try {
        const { buffer, filename, contentType } = await fetchAttachment(row, a.id);
        originals.push({ filename, contentType, buffer });
      } catch (err) {
        return res.status(502).json({ error: `Could not include "${a.filename}": ${err.message}` });
      }
    }
    uploads = outbox.addFiles(uploads.files, originals);
    if (!uploads.ok) return res.status(400).json({ error: uploads.message });
  }

  const who = row.from_name ? `${row.from_name} <${row.from_email}>` : row.from_email;
  const forwarded = [
    '---------- Forwarded message ----------',
    `From: ${who}`,
    `Date: ${row.received_at} UTC`,
    `Subject: ${row.subject || '(no subject)'}`,
    `To: ${row.to_emails}`,
    '',
    String(row.text_body || '').slice(0, 20000),
  ].join('\n');
  const intro = String(body.message || '').trim();
  const text = intro ? `${intro}\n\n${forwarded}` : forwarded;

  const base = row.subject.trim() || '(no subject)';
  const defaultSubject = /^fwd?:/i.test(base) ? base : `Fwd: ${base}`;
  const subject = String(body.subject || '').trim() ? outbox.cleanSubject(body.subject) : defaultSubject;

  try {
    const id = await outbox.sendAndRecord({
      kind: 'forward',
      addressing,
      subject,
      text,
      files: uploads.files,
      inReplyToId: row.id,
      clientId: matchClientId(addressing.to[0].toLowerCase()),
      user: req.user,
    });
    res.status(201).json({ id });
  } catch (err) {
    sendFailure(res, err);
  }
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
