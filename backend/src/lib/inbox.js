const crypto = require('crypto');
const db = require('../db');
const { splitEmails } = require('./emails');

// Incoming mail for info@edusolutionsmv.com arrives at Resend, which POSTs a
// small "email.received" webhook (metadata only). We store that straight away
// (so a message is never lost), then fetch the body from Resend's API.
//
// Written from Resend's published docs summaries without being able to open
// the pages themselves, so every field read here is defensive: a missing or
// differently-named field just leaves that column blank instead of throwing.

// ---- webhook signature (Svix scheme, which Resend uses) -------------------
// Signed content is "<svix-id>.<svix-timestamp>.<raw body>", HMAC-SHA256 with
// the base64 part of the "whsec_..." secret; the header carries one or more
// space-separated "v1,<base64 signature>" entries.
function verifySignature({ secret, id, timestamp, signature, rawBody, toleranceSec = 300, now = Date.now() }) {
  if (!secret || !id || !timestamp || !signature || !Buffer.isBuffer(rawBody)) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > toleranceSec) return false;
  const key = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64');
  const expected = crypto
    .createHmac('sha256', key)
    .update(Buffer.concat([Buffer.from(`${id}.${timestamp}.`), rawBody]))
    .digest();
  for (const part of String(signature).split(' ')) {
    const [version, sig] = part.split(',');
    if (version !== 'v1' || !sig) continue;
    const got = Buffer.from(sig, 'base64');
    if (got.length === expected.length && crypto.timingSafeEqual(got, expected)) return true;
  }
  return false;
}

// ---- small helpers ---------------------------------------------------------
function parseAddress(value) {
  if (value && typeof value === 'object') {
    return { name: String(value.name || '').trim(), email: String(value.email || value.address || '').trim().toLowerCase() };
  }
  const s = String(value || '').trim();
  const m = s.match(/^(.*?)<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim().replace(/^"|"$/g, ''), email: m[2].trim().toLowerCase() };
  return { name: '', email: s.toLowerCase() };
}

function toSqlTime(value) {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function htmlToText(html) {
  return String(html || '')
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normaliseAttachments(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((a) => ({
      id: String((a && (a.id || a.attachment_id)) || ''),
      filename: String((a && (a.filename || a.name)) || 'attachment'),
      content_type: String((a && (a.content_type || a.contentType)) || ''),
      size: Number((a && (a.size || a.size_bytes)) || 0) || 0,
    }))
    .filter((a) => a.id);
}

// The client whose email field (one or several addresses) contains this sender.
function matchClientId(email) {
  if (!email) return null;
  const rows = db.prepare("SELECT id, email FROM clients WHERE email != ''").all();
  const hit = rows.find((r) => splitEmails(r.email).some((e) => e.toLowerCase() === email));
  return hit ? hit.id : null;
}

// ---- Resend API -----------------------------------------------------------
async function resendGet(path) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    const err = new Error('RESEND_API_KEY is not set on the server.');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }
  const res = await fetch(`https://api.resend.com${path}`, { headers: { Authorization: `Bearer ${key}` } });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const err = new Error((json && (json.message || json.error)) || `Resend returned ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

// ---- ingest ---------------------------------------------------------------
// Stores the webhook's metadata. Returns { row, created } or null if the
// payload carries no email id. Safe to call twice for the same email.
function ingestMetadata(data) {
  const resendId = String((data && (data.email_id || data.id)) || '');
  if (!resendId) return null;
  const existing = db.prepare('SELECT id FROM inbound_emails WHERE resend_email_id = ?').get(resendId);
  if (existing) return { row: existing, created: false };

  const from = parseAddress(data.from);
  const to = (Array.isArray(data.to) ? data.to : [data.to]).filter(Boolean).map((t) => parseAddress(t).email || String(t));
  const info = db
    .prepare(
      `INSERT OR IGNORE INTO inbound_emails
         (resend_email_id, from_email, from_name, to_emails, subject, message_id, attachments, client_id, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`,
    )
    .run(
      resendId,
      from.email,
      from.name,
      to.join(', '),
      String(data.subject || ''),
      String(data.message_id || ''),
      JSON.stringify(normaliseAttachments(data.attachments)),
      matchClientId(from.email),
      toSqlTime(data.created_at),
    );
  const row = db.prepare('SELECT id FROM inbound_emails WHERE resend_email_id = ?').get(resendId);
  return { row, created: info.changes > 0 };
}

// Fetches the body (and fills anything the webhook left blank). Never throws:
// a failure is recorded in body_error so staff see it and can press Reload.
async function loadBody(id) {
  const row = db.prepare('SELECT * FROM inbound_emails WHERE id = ?').get(id);
  if (!row) return false;
  try {
    const json = await resendGet(`/emails/receiving/${encodeURIComponent(row.resend_email_id)}`);
    const d = (json && json.data) || json || {};
    const html = String(d.html || '');
    const text = String(d.text || '') || htmlToText(html);
    const headers = d.headers && typeof d.headers === 'object' ? d.headers : {};
    const from = parseAddress(d.from);
    const fromEmail = row.from_email || from.email;
    const attachments = row.attachments === '[]' ? normaliseAttachments(d.attachments) : null;
    db.prepare(
      `UPDATE inbound_emails SET
         text_body = ?, html_body = ?, body_loaded = 1, body_error = '',
         from_email = ?, from_name = CASE WHEN from_name = '' THEN ? ELSE from_name END,
         subject = CASE WHEN subject = '' THEN ? ELSE subject END,
         message_id = CASE WHEN message_id = '' THEN ? ELSE message_id END,
         client_id = COALESCE(client_id, ?),
         attachments = COALESCE(?, attachments)
       WHERE id = ?`,
    ).run(
      text,
      html,
      fromEmail,
      from.name,
      String(d.subject || ''),
      String(d.message_id || headers['message-id'] || headers['Message-ID'] || ''),
      matchClientId(fromEmail),
      attachments ? JSON.stringify(attachments) : null,
      id,
    );
    return true;
  } catch (err) {
    const hint =
      err.status === 401 || err.status === 403
        ? ' (the Resend API key may not be allowed to read received emails — try a full-access key)'
        : '';
    db.prepare("UPDATE inbound_emails SET body_error = ? WHERE id = ?").run(`${err.message}${hint}`.slice(0, 500), id);
    return false;
  }
}

// One attachment's bytes, fetched fresh (Resend's download links expire).
async function fetchAttachment(row, attachmentId) {
  const json = await resendGet(`/emails/receiving/${encodeURIComponent(row.resend_email_id)}/attachments`);
  const list = Array.isArray(json) ? json : (json && json.data) || [];
  const att = list.find((a) => String(a.id) === String(attachmentId));
  if (!att || !att.download_url) {
    const err = new Error('Attachment not found');
    err.status = 404;
    throw err;
  }
  const res = await fetch(att.download_url);
  if (!res.ok) throw new Error(`Could not download the attachment (${res.status})`);
  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    filename: att.filename || att.name || 'attachment',
    contentType: att.content_type || att.contentType || 'application/octet-stream',
  };
}

module.exports = { verifySignature, parseAddress, htmlToText, matchClientId, ingestMetadata, loadBody, fetchAttachment };
