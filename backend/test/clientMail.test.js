const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Throwaway database + a fake Gmail: nothing real is read or sent.
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'edu-cm-')), 't.sqlite3');
process.env.GMAIL_CLIENT_ID = 'id';
process.env.GMAIL_CLIENT_SECRET = 'secret';
process.env.GMAIL_REFRESH_TOKEN = 'refresh';
process.env.SMTP_FROM = 'Edu <info@edu.test>';
process.env.JWT_SECRET = 'x';

const db = require('../src/db');
const cm = require('../src/lib/clientMail');

const b64 = (s) => Buffer.from(s).toString('base64url');
const msg = (id, from, subject, text, extra = []) => ({
  id,
  threadId: `t${id}`,
  internalDate: String(Date.now()),
  payload: {
    mimeType: 'multipart/alternative',
    headers: [{ name: 'From', value: from }, { name: 'Subject', value: subject }, { name: 'Message-ID', value: `<${id}@mail>` }, ...extra],
    parts: [{ mimeType: 'text/plain', body: { data: b64(text) } }],
  },
});

function fakeGmail(messages) {
  const sent = [];
  const real = global.fetch;
  global.fetch = async (url, opts) => {
    url = String(url);
    if (url.includes('oauth2')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
    if (url.includes('messages/send')) {
      sent.push(JSON.parse(opts.body));
      return { ok: true, json: async () => ({ id: 'out' }) };
    }
    if (/\/messages\?/.test(url)) return { ok: true, json: async () => ({ messages: messages.map((m) => ({ id: m.id })) }) };
    const m = messages.find((x) => url.includes(`/messages/${x.id}?`));
    return m ? { ok: true, json: async () => m } : { ok: false, status: 404, json: async () => ({}) };
  };
  return { sent, restore: () => (global.fetch = real) };
}

test('replies only to clients, picks the rule, and respects the safety rules', async () => {
  const client = db.prepare("INSERT INTO clients (name, email) VALUES ('Atoll School', 'bursar@atoll.test, head@atoll.test')").run().lastInsertRowid;
  db.prepare("UPDATE business_settings SET business_name = 'Edu Solutions', currency_symbol = 'MVR ' WHERE id = 1").run();
  db.prepare("INSERT INTO client_mail_rules (name, keywords, subject, body, auto_send, sort_order) VALUES ('Invoice question', 'invoice, balance', '', 'Hi {{client_name}}, you owe {{outstanding}}.', 1, 1)").run();
  db.prepare("INSERT INTO client_mail_rules (name, keywords, subject, body, auto_send, sort_order) VALUES ('Specific invoice', 'inv-', '', 'Invoice {{invoice_number}} balance {{invoice_balance}}', 1, 0)").run();
  db.prepare("INSERT INTO client_mail_rules (name, keywords, subject, body, auto_send, sort_order) VALUES ('Default', '', 'Got it', 'We received your email.', 0, 9)").run();

  // Off by default: nothing happens.
  assert.equal((await cm.checkInbox()).skipped, 'off');

  db.prepare("UPDATE client_mail_settings SET mode = 'auto', enabled_since = datetime('now', '-1 hour'), signature = 'Edu Solutions' WHERE id = 1").run();
  const gm = fakeGmail([
    msg('1', 'Bursar <head@atoll.test>', 'Question about my invoice', 'What is my balance?'),
    msg('2', 'Random <someone@else.test>', 'Hello', 'Hi'),
    msg('3', 'Bursar <bursar@atoll.test>', 'Meeting', 'Can we meet next week?'),
    msg('4', 'Bot <noreply@atoll.test>', 'Receipt', 'x'),
    msg('5', 'Bursar <bursar@atoll.test>', 'Out of office', 'away', [{ name: 'Auto-Submitted', value: 'auto-replied' }]),
    msg('6', 'Bursar <bursar@atoll.test>', 'Invoice INV-2026-0099', 'what about INV-2026-0099 balance'),
  ]);
  try {
    const r = await cm.checkInbox();
    assert.deepEqual({ sent: r.sent, drafted: r.drafted, ignored: r.ignored }, { sent: 1, drafted: 2, ignored: 3 });
    assert.equal(gm.sent.length, 1);
    const mime = Buffer.from(gm.sent[0].raw, 'base64url').toString();
    assert.match(mime, /To: head@atoll.test/);
    assert.match(mime, /In-Reply-To: <1@mail>/);
    assert.equal(gm.sent[0].threadId, 't1');
    assert.match(mime, /Re: Question about my invoice/);

    const rows = Object.fromEntries(db.prepare('SELECT * FROM client_mail').all().map((x) => [x.gmail_id, x]));
    assert.equal(rows['1'].status, 'sent');
    assert.match(rows['1'].reply_body, /Hi Atoll School, you owe MVR 0\.00\.\n\nEdu Solutions/);
    assert.equal(rows['2'].ignore_reason, 'not a client');
    assert.equal(rows['3'].status, 'draft'); // default rule has auto_send off
    assert.equal(rows['3'].reply_subject, 'Got it');
    assert.equal(rows['4'].ignore_reason, 'automated sender');
    assert.equal(rows['5'].ignore_reason, 'automatic message');
    // Names an invoice that is not theirs: placeholders stay unfilled, so it is held, not sent.
    assert.equal(rows['6'].status, 'draft');
    assert.match(rows['6'].ignore_reason, /Held for review/);

    // The same inbox again changes nothing (no double replies).
    const again = await cm.checkInbox();
    assert.equal(again.checked, 0);
    assert.equal(gm.sent.length, 1);

    // Same person again within 24h is held, not auto-sent.
    gm.restore();
    const gm2 = fakeGmail([msg('7', 'Bursar <head@atoll.test>', 'Another invoice question', 'balance please')]);
    const r2 = await cm.checkInbox();
    assert.equal(r2.sent, 0);
    assert.match(db.prepare("SELECT ignore_reason FROM client_mail WHERE gmail_id = '7'").get().ignore_reason, /last 24 hours/);
    gm2.restore();

    // Staff approve the draft with an edit.
    const gm3 = fakeGmail([]);
    const id = rows['3'].id;
    const out = await cm.sendReply(id, { subject: 'Re: Meeting', body: 'Tuesday works.', actor: 'Boss' });
    assert.equal(out.status, 'sent');
    assert.equal(gm3.sent.length, 1);
    await assert.rejects(cm.sendReply(id, { subject: 'x', body: 'y', actor: 'Boss' }), /already been handled/);
    gm3.restore();
  } finally {
    global.fetch = global.fetch;
  }
});

test('a client invoice number fills in that invoice\'s details', () => {
  const c = db.prepare("SELECT id, name FROM clients LIMIT 1").get();
  const vars = cm.buildVars(c, { subject: 'About INV-2026-0099', body: '' });
  assert.equal(vars.invoice_number, undefined); // no such invoice for this client
  assert.equal(vars.overdue_invoices, 'none');

  db.prepare("INSERT INTO invoices (client_id, number, status, issue_date, due_date, subtotal, total, amount_paid, public_token) VALUES (?, 'INV-2026-0099', 'sent', '2026-01-01', '2026-01-15', 500, 500, 200, 'tok99')").run(c.id);
  const v2 = cm.buildVars(c, { subject: 'About INV-2026-0099', body: '' });
  assert.equal(v2.invoice_balance, 'MVR 300.00');
  assert.equal(v2.invoice_due, '2026-01-15');
  assert.equal(v2.invoice_status, 'unpaid');
  assert.match(v2.overdue_invoices, /INV-2026-0099 — MVR 300\.00 due 2026-01-15/);
  assert.equal(v2.outstanding, 'MVR 300.00');
});
