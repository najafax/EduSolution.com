const db = require('../db');
const mailer = require('./mailer');
const { logEmail } = require('./emailLog');
const { splitEmails, EMAIL_RE } = require('./emails');
const { renderSignatureHtml } = require('./signatureHtml');

// Everything the Inbox sends (new mail, replies, forwards). One place validates
// recipients and attachments, sends through lib/mailer.js, and records the
// message so it shows up in the Sent folder and the conversation view.
//
// `mailer.sendMail` is looked up at call time (not destructured) so a test can
// replace it and exercise the whole path without any email transport.

const MAX_RECIPIENTS = 25;
const MAX_FILES = 10;
const MAX_TOTAL_BYTES = 5 * 1024 * 1024; // decoded; the API body limit is 8MB of base64 JSON
const MAX_FILENAME = 150;
const MAX_MESSAGE = 50000;
const MAX_SUBJECT = 300;
// Files mail providers refuse anyway, or that only ever carry malware.
const BLOCKED_EXT = /\.(exe|bat|cmd|com|scr|pif|msi|vbs|jse?|jar|ps1|lnk|dll|sh|reg)$/i;

const fail = (message) => ({ ok: false, message });

// "a@x.com, b@y.com" or an array -> { ok, list } (deduplicated, validated).
function parseRecipients(value, label) {
  const raw = Array.isArray(value) ? value.flatMap((v) => splitEmails(v)) : splitEmails(value);
  const list = [];
  const seen = new Set();
  for (const e of raw) {
    if (!EMAIL_RE.test(e)) return fail(`"${e}" is not a valid ${label} address`);
    if (!seen.has(e.toLowerCase())) {
      seen.add(e.toLowerCase());
      list.push(e);
    }
  }
  return { ok: true, list };
}

// Validates the To/Cc/Bcc triple. A person in more than one box is kept in the
// strongest one only (To over Cc over Bcc) so nobody gets two copies.
function parseAddressing({ to, cc, bcc }) {
  const t = parseRecipients(to, 'To');
  if (!t.ok) return t;
  const c = parseRecipients(cc, 'Cc');
  if (!c.ok) return c;
  const b = parseRecipients(bcc, 'Bcc');
  if (!b.ok) return b;
  if (t.list.length === 0) return fail('Add at least one recipient in To');
  const lower = (arr) => new Set(arr.map((e) => e.toLowerCase()));
  const inTo = lower(t.list);
  const ccList = c.list.filter((e) => !inTo.has(e.toLowerCase()));
  const inCc = lower(ccList);
  const bccList = b.list.filter((e) => !inTo.has(e.toLowerCase()) && !inCc.has(e.toLowerCase()));
  if (t.list.length + ccList.length + bccList.length > MAX_RECIPIENTS) {
    return fail(`At most ${MAX_RECIPIENTS} recipients per message`);
  }
  return { ok: true, to: t.list, cc: ccList, bcc: bccList };
}

// Browser uploads: [{ filename, content_type, data: <base64 or data URI> }].
function parseUploads(list) {
  if (list === undefined || list === null) return { ok: true, files: [] };
  if (!Array.isArray(list)) return fail('Attachments must be a list');
  if (list.length > MAX_FILES) return fail(`At most ${MAX_FILES} attachments per message`);
  const files = [];
  let total = 0;
  for (const item of list) {
    const filename = String((item && item.filename) || '')
      .replace(/[\\/\r\n]/g, '_')
      .trim()
      .slice(0, MAX_FILENAME);
    if (!filename) return fail('Every attachment needs a file name');
    if (BLOCKED_EXT.test(filename)) return fail(`"${filename}" is a file type that cannot be sent by email`);
    const b64 = String((item && item.data) || '').replace(/^data:[^,]*,/, '');
    const buffer = Buffer.from(b64, 'base64');
    if (buffer.length === 0) return fail(`"${filename}" is empty`);
    total += buffer.length;
    if (total > MAX_TOTAL_BYTES) return fail('Attachments are too large (5 MB in total)');
    files.push({
      filename,
      contentType: String((item && item.content_type) || '').slice(0, 100) || 'application/octet-stream',
      buffer,
    });
  }
  return { ok: true, files };
}

// Adds files (already decoded, e.g. a forwarded original's attachments) to a
// parsed set, enforcing the same total.
function addFiles(files, more) {
  let total = files.reduce((n, f) => n + f.buffer.length, 0);
  const out = [...files];
  for (const f of more) {
    total += f.buffer.length;
    if (out.length >= MAX_FILES) return fail(`At most ${MAX_FILES} attachments per message`);
    if (total > MAX_TOTAL_BYTES) return fail('Attachments are too large (5 MB in total)');
    out.push(f);
  }
  return { ok: true, files: out };
}

// Our own mailbox addresses (the From address and the Reply-To address), so a
// reply never goes to ourselves.
function ownAddresses() {
  const from = String(process.env.SMTP_FROM || process.env.GMAIL_FROM || process.env.SMTP_USER || '');
  const m = from.match(/<([^>]+)>/);
  const replyTo = mailer.replyToAddress();
  return new Set([(m ? m[1] : from).trim().toLowerCase(), String(replyTo || '').trim().toLowerCase()].filter(Boolean));
}

function angle(id) {
  const v = String(id || '').trim();
  if (!v) return '';
  return v.startsWith('<') ? v : `<${v}>`;
}

// In-Reply-To / References for a reply to an inbound row, so the recipient's
// mail app files it in the same conversation.
function threadHeaders(row) {
  const id = angle(row.message_id);
  if (!id) return undefined;
  const refs = [String(row.references_hdr || '').trim(), id].filter(Boolean).join(' ').replace(/\s+/g, ' ');
  return { 'In-Reply-To': id, References: refs };
}

function cleanSubject(subject) {
  return String(subject || '').trim().slice(0, MAX_SUBJECT) || '(no subject)';
}

function checkMessage(message, files) {
  const text = String(message || '').trim();
  if (!text && files.length === 0) return fail('Write a message first');
  if (text.length > MAX_MESSAGE) return fail('The message is too long');
  return { ok: true, text };
}

/**
 * Sends and records one message. Returns the new sent_emails id.
 *   kind: 'compose' | 'reply' | 'forward'
 *   addressing: result of parseAddressing()
 *   text: plain-text body as typed (stored as-is)
 *   extraHtml: appended after the converted body (the quoted original)
 *   files: decoded attachments [{ filename, contentType, buffer }]
 * Throws whatever sendMail throws (the caller maps EMAIL_NOT_CONFIGURED to 503);
 * nothing is recorded unless the send succeeded.
 */
async function sendAndRecord({ kind, addressing, subject, text, extraHtml = '', files = [], headers, inReplyToId = null, clientId = null, user }) {
  // If the message ends with the sender's saved signature (the compose form
  // pre-fills it), send that part as a styled block instead of plain text. The
  // stored copy in Sent keeps the plain text as typed.
  let body = text;
  let signatureHtml = '';
  try {
    const row = user && user.id ? db.prepare('SELECT email_signature FROM users WHERE id = ?').get(user.id) : null;
    const sig = String((row && row.email_signature) || '').replace(/\r\n/g, '\n').trim();
    const normalised = String(text).replace(/\r\n/g, '\n').trimEnd();
    if (sig && normalised.endsWith(sig)) {
      body = normalised.slice(0, normalised.length - sig.length).trimEnd();
      signatureHtml = renderSignatureHtml(sig, { origin: process.env.CLIENT_ORIGIN || '' });
    }
  } catch (err) {
    console.error('signature render failed', err.message);
    body = text;
    signatureHtml = '';
  }
  const html = (body ? mailer.textToHtml(body) : '') + signatureHtml + extraHtml;
  await mailer.sendMail({
    to: addressing.to,
    cc: addressing.cc,
    bcc: addressing.bcc,
    subject,
    html,
    headers,
    attachments: files.map((f) => ({ filename: f.filename, content: f.buffer, contentType: f.contentType })),
  });

  const insert = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO sent_emails (kind, to_emails, cc_emails, bcc_emails, subject, text_body, in_reply_to_id, client_id, sent_by_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(kind, addressing.to.join(', '), addressing.cc.join(', '), addressing.bcc.join(', '), subject, text, inReplyToId, clientId, user.name);
    const fileStmt = db.prepare(
      'INSERT INTO sent_email_files (sent_email_id, filename, content_type, size, data) VALUES (?, ?, ?, ?, ?)',
    );
    for (const f of files) fileStmt.run(info.lastInsertRowid, f.filename, f.contentType, f.buffer.length, f.buffer);
    return Number(info.lastInsertRowid);
  });
  const id = insert();

  try {
    logEmail({
      type: kind === 'reply' ? 'inbox_reply' : kind === 'forward' ? 'inbox_forward' : 'inbox_compose',
      to: addressing.to.join(', '),
      subject,
      sentByName: user.name,
      entityType: clientId ? 'client' : null,
      entityId: clientId || null,
      entityLabel: addressing.to[0],
    });
  } catch (err) {
    console.error('email log failed', err.message);
  }
  return id;
}

module.exports = {
  MAX_RECIPIENTS,
  MAX_FILES,
  MAX_TOTAL_BYTES,
  parseRecipients,
  parseAddressing,
  parseUploads,
  addFiles,
  ownAddresses,
  threadHeaders,
  cleanSubject,
  checkMessage,
  sendAndRecord,
};
