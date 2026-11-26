const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Throwaway database BEFORE anything opens src/db (node runs each test file in
// its own process, so this cannot leak into other files or the real database).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-outbox-'));
process.env.DB_PATH = path.join(dir, 'test.sqlite3');
process.env.SMTP_FROM = 'Edu Solutions <info@edusolutionsmv.com>';

const db = require('../src/db');
const mailer = require('../src/lib/mailer');
const outbox = require('../src/lib/outbox');

const b64 = (s) => Buffer.from(s).toString('base64');

test('recipients: validated, deduplicated, strongest box wins, capped', () => {
  const ok = outbox.parseAddressing({
    to: 'a@x.com, B@y.com; a@x.com',
    cc: ['b@y.com', 'c@z.com'],
    bcc: 'C@z.com, d@w.com',
  });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.to, ['a@x.com', 'B@y.com']);
  assert.deepEqual(ok.cc, ['c@z.com']); // b@y.com is already in To
  assert.deepEqual(ok.bcc, ['d@w.com']); // c@z.com is already in Cc

  assert.match(outbox.parseAddressing({ to: 'nope' }).message, /not a valid To address/);
  assert.match(outbox.parseAddressing({ to: 'a@x.com', cc: 'bad' }).message, /not a valid Cc address/);
  assert.match(outbox.parseAddressing({ to: '' }).message, /at least one recipient/);
  const many = Array.from({ length: 26 }, (_, i) => `p${i}@x.com`).join(',');
  assert.match(outbox.parseAddressing({ to: many }).message, /At most 25/);
});

test('attachments: decoded, named safely, blocked types and size limits enforced', () => {
  const ok = outbox.parseUploads([
    { filename: '../etc/po.pdf', content_type: 'application/pdf', data: `data:application/pdf;base64,${b64('hello')}` },
  ]);
  assert.equal(ok.ok, true);
  assert.equal(ok.files[0].filename, '.._etc_po.pdf');
  assert.equal(ok.files[0].buffer.toString(), 'hello');
  assert.equal(outbox.parseUploads(undefined).files.length, 0);

  assert.match(outbox.parseUploads([{ filename: 'run.exe', data: b64('x') }]).message, /cannot be sent/);
  assert.match(outbox.parseUploads([{ filename: 'a.txt', data: '' }]).message, /empty/);
  assert.match(outbox.parseUploads([{ data: b64('x') }]).message, /file name/);
  const big = Buffer.alloc(3 * 1024 * 1024, 1).toString('base64');
  assert.match(
    outbox.parseUploads([
      { filename: 'a.bin', data: big },
      { filename: 'b.bin', data: big },
    ]).message,
    /too large/,
  );
  const eleven = Array.from({ length: 11 }, (_, i) => ({ filename: `f${i}.txt`, data: b64('x') }));
  assert.match(outbox.parseUploads(eleven).message, /At most 10/);
});

test('thread headers continue the sender conversation', () => {
  assert.deepEqual(outbox.threadHeaders({ message_id: 'abc@mail.x', references_hdr: '<one@x> <two@x>' }), {
    'In-Reply-To': '<abc@mail.x>',
    References: '<one@x> <two@x> <abc@mail.x>',
  });
  assert.deepEqual(outbox.threadHeaders({ message_id: '<abc@mail.x>', references_hdr: '' }), {
    'In-Reply-To': '<abc@mail.x>',
    References: '<abc@mail.x>',
  });
  assert.equal(outbox.threadHeaders({ message_id: '' }), undefined);
});

test('sendAndRecord sends with every field, records Sent + files, and records nothing on failure', async () => {
  const user = { name: 'Aishath' };
  const sent = [];
  const realSend = mailer.sendMail;
  mailer.sendMail = async (args) => {
    sent.push(args);
  };
  try {
    const addressing = outbox.parseAddressing({ to: 'head@school.test', cc: 'office@school.test', bcc: 'boss@edu.test' });
    const files = outbox.parseUploads([{ filename: 'quote.pdf', content_type: 'application/pdf', data: b64('PDFDATA') }]).files;
    const id = await outbox.sendAndRecord({
      kind: 'reply',
      addressing,
      subject: 'Re: Quote',
      text: 'Thanks, attached.',
      extraHtml: '<blockquote>old</blockquote>',
      files,
      headers: { 'In-Reply-To': '<m@x>', References: '<m@x>' },
      user,
    });

    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].to, ['head@school.test']);
    assert.deepEqual(sent[0].cc, ['office@school.test']);
    assert.deepEqual(sent[0].bcc, ['boss@edu.test']);
    assert.deepEqual(sent[0].headers, { 'In-Reply-To': '<m@x>', References: '<m@x>' });
    assert.match(sent[0].html, /Thanks, attached\.<\/p><blockquote>old<\/blockquote>/);
    assert.equal(sent[0].attachments[0].filename, 'quote.pdf');
    assert.equal(sent[0].attachments[0].content.toString(), 'PDFDATA');

    const row = db.prepare('SELECT * FROM sent_emails WHERE id = ?').get(id);
    assert.equal(row.kind, 'reply');
    assert.equal(row.to_emails, 'head@school.test');
    assert.equal(row.cc_emails, 'office@school.test');
    assert.equal(row.bcc_emails, 'boss@edu.test');
    assert.equal(row.text_body, 'Thanks, attached.');
    assert.equal(row.sent_by_name, 'Aishath');
    const file = db.prepare('SELECT * FROM sent_email_files WHERE sent_email_id = ?').get(id);
    assert.equal(file.filename, 'quote.pdf');
    assert.equal(file.size, 7);
    assert.equal(file.data.toString(), 'PDFDATA');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM email_log WHERE type = 'inbox_reply'").get().n, 1);

    // a failed send is reported to the caller and leaves no Sent record behind
    const before = db.prepare('SELECT COUNT(*) AS n FROM sent_emails').get().n;
    mailer.sendMail = async () => {
      const err = new Error('Resend refused');
      err.code = 'RESEND_ERROR';
      throw err;
    };
    await assert.rejects(
      outbox.sendAndRecord({ kind: 'compose', addressing, subject: 'x', text: 'y', user }),
      /Resend refused/,
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sent_emails').get().n, before);
  } finally {
    mailer.sendMail = realSend;
  }
});

test('trash older than 30 days is purged, recent trash and inbox mail are kept', () => {
  const { purgeOldTrash } = require('../src/lib/inbox');
  const add = db.prepare(
    "INSERT INTO inbound_emails (resend_email_id, from_email, trashed, trashed_at) VALUES (?, 'a@x.com', ?, ?)",
  );
  add.run('old', 1, "2020-01-01 00:00:00");
  add.run('recent', 1, new Date().toISOString().slice(0, 19).replace('T', ' '));
  add.run('inbox', 0, null);
  assert.equal(purgeOldTrash(), 1);
  const left = db.prepare('SELECT resend_email_id FROM inbound_emails ORDER BY id').all().map((r) => r.resend_email_id);
  assert.deepEqual(left, ['recent', 'inbox']);
});
