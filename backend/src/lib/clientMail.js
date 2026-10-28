const db = require('../db');
const { gmailConfigured, gmailAccessToken, sendMail, textToHtml } = require('./mailer');
const { renderTemplate } = require('./emailTemplates');
const { splitEmails } = require('./emails');
const { todayStr, addDays } = require('./businessDate');
const { logActivity } = require('./activity');
const { logEmail } = require('./emailLog');

// Client auto-replies. Reads new mail from the Gmail inbox (Gmail API,
// gmail.readonly scope on top of the gmail.send the mailer already needs),
// keeps only mail from addresses that belong to a client, picks a reply from
// the keyword rules (client_mail_rules) and either leaves it as a draft for
// staff to approve (mode 'draft') or sends it itself (mode 'auto', and only
// for rules marked auto_send). Nothing is ever sent to anyone who is not a
// client, to automated senders, or twice to the same person within a day.

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const MAX_PER_RUN = 25;
const MAX_BODY = 8000;
const MODES = ['off', 'draft', 'auto'];
let running = false;

async function gmailGet(path) {
  const res = await fetch(`${GMAIL}${path}`, { headers: { Authorization: `Bearer ${await gmailAccessToken()}` } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(data.error?.message || `Gmail returned ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

const getSettings = () => db.prepare('SELECT * FROM client_mail_settings WHERE id = 1').get();

// ---- Reading a message -----------------------------------------------------

function decode(data) {
  return Buffer.from(String(data || ''), 'base64url').toString('utf8');
}

function stripHtml(html) {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

function findPart(payload, mime) {
  if (!payload) return null;
  if (payload.mimeType === mime && payload.body?.data) return payload;
  for (const p of payload.parts || []) {
    const found = findPart(p, mime);
    if (found) return found;
  }
  return null;
}

// Text of a Gmail API message: the text/plain part, else the html part stripped.
function bodyText(payload) {
  const plain = findPart(payload, 'text/plain');
  if (plain) return decode(plain.body.data).trim().slice(0, MAX_BODY);
  const html = findPart(payload, 'text/html');
  return html ? stripHtml(decode(html.body.data)).slice(0, MAX_BODY) : '';
}

function parseMessage(msg) {
  const headers = {};
  for (const h of msg.payload?.headers || []) headers[h.name.toLowerCase()] = h.value;
  const from = headers.from || '';
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  const email = (m ? m[2] : from).trim().toLowerCase();
  return {
    gmailId: msg.id,
    threadId: msg.threadId || '',
    messageId: headers['message-id'] || '',
    fromEmail: email,
    fromName: m ? m[1].trim() : '',
    subject: headers.subject || '',
    receivedAt: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString().slice(0, 19).replace('T', ' ') : null,
    body: bodyText(msg.payload),
    headers,
  };
}

const ownAddresses = () =>
  [process.env.SMTP_FROM, process.env.GMAIL_FROM, process.env.SMTP_USER]
    .filter(Boolean)
    .map((v) => (v.match(/<([^>]+)>/)?.[1] || v).trim().toLowerCase());

// Why this message must never get an automatic reply ('' = it is fine).
function skipReason(p) {
  if (!p.fromEmail || !p.fromEmail.includes('@')) return 'no sender address';
  if (ownAddresses().includes(p.fromEmail)) return 'sent by us';
  if (/^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounce)/i.test(p.fromEmail)) return 'automated sender';
  const h = p.headers;
  if (h['auto-submitted'] && h['auto-submitted'].toLowerCase() !== 'no') return 'automatic message';
  if (/bulk|junk|list|auto_reply/i.test(h.precedence || '')) return 'bulk/automatic message';
  if (h['list-id'] || h['list-unsubscribe']) return 'mailing list';
  if (h['x-autoreply'] || h['x-autorespond'] || h['x-auto-response-suppress']) return 'automatic message';
  return '';
}

function findClient(email) {
  for (const c of db.prepare('SELECT id, name, email FROM clients').all()) {
    if (splitEmails(c.email).map((e) => e.toLowerCase()).includes(email)) return c;
  }
  return null;
}

// ---- Choosing and filling in a reply --------------------------------------

function chooseRule(text) {
  const lower = text.toLowerCase();
  const rules = db.prepare('SELECT * FROM client_mail_rules WHERE active = 1 ORDER BY sort_order, id').all();
  for (const r of rules) {
    const words = r.keywords.split(/[,\n]/).map((w) => w.trim().toLowerCase()).filter(Boolean);
    if (words.length && words.some((w) => lower.includes(w))) return r;
  }
  return rules.find((r) => !r.keywords.trim()) || null;
}

function buildVars(client, original) {
  const s = db.prepare('SELECT business_name, currency_symbol FROM business_settings WHERE id = 1').get() || {};
  const sym = s.currency_symbol || '';
  const money = (n) => `${sym}${Number(n).toFixed(2)}`;
  const today = todayStr();
  const invoices = db
    .prepare("SELECT number, total, amount_paid, due_date FROM invoices WHERE client_id = ? AND status = 'sent' ORDER BY due_date")
    .all(client.id)
    .map((i) => ({ ...i, balance: i.total - i.amount_paid }))
    .filter((i) => i.balance > 0.005);
  const line = (i) => `${i.number} — ${money(i.balance)} due ${i.due_date}`;
  const licenses = db
    .prepare("SELECT name, expiry_date FROM licenses WHERE client_id = ? AND status = 'active' AND expiry_date <= ? ORDER BY expiry_date")
    .all(client.id, addDays(today, 30));
  const vars = {
    client_name: client.name,
    business_name: s.business_name || '',
    subject: original.subject,
    outstanding: money(invoices.reduce((t, i) => t + i.balance, 0)),
    unpaid_invoices: invoices.map(line).join('\n') || 'none',
    overdue_invoices: invoices.filter((i) => i.due_date < today).map(line).join('\n') || 'none',
    licenses_expiring: licenses.map((l) => `${l.name} — expires ${l.expiry_date}`).join('\n') || 'none',
    portal_url: `${process.env.CLIENT_ORIGIN || 'http://localhost:5173'}/login`,
  };
  // Only when the email names one of THIS client's own invoices.
  const mentioned = (original.subject + ' ' + original.body).match(/INV-\d{4}-\d{4}/i);
  if (mentioned) {
    const inv = db
      .prepare('SELECT number, total, amount_paid, due_date, status FROM invoices WHERE client_id = ? AND number = ?')
      .get(client.id, mentioned[0].toUpperCase());
    if (inv && inv.status !== 'draft') {
      vars.invoice_number = inv.number;
      vars.invoice_balance = money(inv.total - inv.amount_paid);
      vars.invoice_due = inv.due_date;
      vars.invoice_status = inv.status === 'void' ? 'cancelled' : inv.total - inv.amount_paid <= 0.005 ? 'paid' : 'unpaid';
    }
  }
  return vars;
}

function composeReply(rule, client, original, settings) {
  if (!rule) return { subject: '', body: '' };
  const vars = buildVars(client, original);
  const subject = rule.subject.trim() ? renderTemplate(rule.subject, vars) : /^re:/i.test(original.subject) ? original.subject : `Re: ${original.subject}`;
  let body = renderTemplate(rule.body, vars);
  if (settings.signature.trim()) body += `\n\n${settings.signature.trim()}`;
  return { subject, body };
}

const hasUnfilled = (text) => /\{\{\w+\}\}/.test(text);

// ---- Sending ---------------------------------------------------------------

// Sends the (possibly edited) reply for a stored message. The row is claimed
// first so two clicks / a click and the poller can never both send it.
async function sendReply(id, { subject, body, actor }) {
  const claimed = db.prepare("UPDATE client_mail SET status = 'sending' WHERE id = ? AND status = 'draft'").run(id);
  if (!claimed.changes) {
    const err = new Error('This message has already been handled.');
    err.code = 'NOT_DRAFT';
    throw err;
  }
  const row = db.prepare('SELECT * FROM client_mail WHERE id = ?').get(id);
  try {
    if (!subject.trim() || !body.trim()) {
      const err = new Error('Write a subject and a message first.');
      err.code = 'EMPTY';
      throw err;
    }
    await sendMail({
      to: row.from_email,
      subject,
      html: textToHtml(body),
      inReplyTo: row.message_id || undefined,
      references: row.message_id || undefined,
      threadId: row.thread_id || undefined,
    });
  } catch (err) {
    db.prepare("UPDATE client_mail SET status = 'draft' WHERE id = ?").run(id);
    throw err;
  }
  db.prepare("UPDATE client_mail SET status = 'sent', reply_subject = ?, reply_body = ?, handled_by_name = ?, handled_at = datetime('now') WHERE id = ?").run(
    subject,
    body,
    actor,
    id,
  );
  logEmail({ type: 'client_mail_reply', to: row.from_email, subject, sentByName: actor, entityType: 'client', entityId: row.client_id, entityLabel: row.from_name || row.from_email });
  logActivity({ userName: actor, action: actor === 'Automated' ? 'auto-replied to an email from' : 'replied to an email from', entityType: 'client', entityId: row.client_id, entityLabel: row.from_name || row.from_email });
  return db.prepare('SELECT * FROM client_mail WHERE id = ?').get(id);
}

// ---- The inbox check -------------------------------------------------------

const sqlTime = (s) => Date.parse(`${s.replace(' ', 'T')}Z`);

async function handleOne(p, settings, tally) {
  const insert = (fields) =>
    db
      .prepare(
        `INSERT INTO client_mail (gmail_id, thread_id, message_id, from_email, from_name, client_id, subject, body_text, received_at, status, ignore_reason, rule_id, reply_subject, reply_body)
         VALUES (@gmail_id, @thread_id, @message_id, @from_email, @from_name, @client_id, @subject, @body_text, COALESCE(@received_at, datetime('now')), @status, @ignore_reason, @rule_id, @reply_subject, @reply_body)`,
      )
      .run({ gmail_id: p.gmailId, thread_id: p.threadId, message_id: p.messageId, from_email: p.fromEmail, from_name: p.fromName, subject: p.subject, body_text: p.body, received_at: p.receivedAt, client_id: null, rule_id: null, reply_subject: '', reply_body: '', ignore_reason: '', ...fields });

  const skip = skipReason(p);
  if (skip) {
    insert({ status: 'ignored', ignore_reason: skip });
    tally.ignored += 1;
    return;
  }
  const client = findClient(p.fromEmail);
  if (!client) {
    insert({ status: 'ignored', ignore_reason: 'not a client' });
    tally.ignored += 1;
    return;
  }

  const rule = chooseRule(`${p.subject}\n${p.body}`);
  const reply = composeReply(rule, client, p, settings);
  let note = '';
  let send = settings.mode === 'auto' && rule && rule.auto_send === 1;
  if (send && hasUnfilled(reply.subject + reply.body)) {
    send = false;
    note = 'Held for review: the reply uses details this email does not give (e.g. an invoice number).';
  }
  if (send && db.prepare("SELECT 1 FROM client_mail WHERE from_email = ? AND status = 'sent' AND handled_at > datetime('now', '-1 day')").get(p.fromEmail)) {
    send = false;
    note = 'Held for review: this person was already sent a reply in the last 24 hours.';
  }

  const { lastInsertRowid } = insert({ client_id: client.id, status: 'draft', ignore_reason: note, rule_id: rule ? rule.id : null, reply_subject: reply.subject, reply_body: reply.body });
  if (!send) {
    tally.drafted += 1;
    return;
  }
  try {
    await sendReply(lastInsertRowid, { subject: reply.subject, body: reply.body, actor: 'Automated' });
    tally.sent += 1;
  } catch (err) {
    db.prepare('UPDATE client_mail SET ignore_reason = ? WHERE id = ?').run(`Automatic send failed: ${err.message}`, lastInsertRowid);
    tally.drafted += 1;
  }
}

async function checkInbox() {
  if (running) return { skipped: 'already running' };
  const settings = getSettings();
  if (settings.mode === 'off') return { skipped: 'off' };
  if (!gmailConfigured()) {
    const err = new Error('Gmail is not configured on the server.');
    err.code = 'GMAIL_NOT_CONFIGURED';
    throw err;
  }
  running = true;
  const tally = { checked: 0, drafted: 0, sent: 0, ignored: 0 };
  try {
    const since = Math.floor(sqlTime(settings.enabled_since || new Date().toISOString().slice(0, 19).replace('T', ' ')) / 1000);
    const list = await gmailGet(`/messages?q=${encodeURIComponent(`in:inbox after:${since} -category:promotions -category:social -category:forums`)}&maxResults=${MAX_PER_RUN}`);
    for (const { id } of list.messages || []) {
      if (db.prepare('SELECT 1 FROM client_mail WHERE gmail_id = ?').get(id)) continue;
      try {
        await handleOne(parseMessage(await gmailGet(`/messages/${id}?format=full`)), settings, tally);
        tally.checked += 1;
      } catch (err) {
        console.error('[client-mail] could not process message', id, err.message);
      }
    }
    db.prepare("UPDATE client_mail_settings SET last_checked_at = datetime('now'), last_error = '' WHERE id = 1").run();
    return tally;
  } catch (err) {
    const msg = err.status === 403 || err.status === 401 ? 'Gmail refused to read the inbox. The Google login needs the "Read email" permission (gmail.readonly) — authorise it again and update GMAIL_REFRESH_TOKEN.' : err.message;
    db.prepare("UPDATE client_mail_settings SET last_checked_at = datetime('now'), last_error = ? WHERE id = 1").run(msg);
    const wrapped = new Error(msg);
    wrapped.code = 'GMAIL_READ_ERROR';
    throw wrapped;
  } finally {
    running = false;
  }
}

module.exports = { checkInbox, sendReply, chooseRule, composeReply, buildVars, skipReason, parseMessage, findClient, getSettings, MODES };
