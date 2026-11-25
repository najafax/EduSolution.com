const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { verifySignature, parseAddress, htmlToText } = require('../src/lib/inbox');
const { startServer } = require('./helpers');

const SECRET_BYTES = crypto.randomBytes(24);
const SECRET = `whsec_${SECRET_BYTES.toString('base64')}`;

function sign(id, ts, body) {
  const sig = crypto.createHmac('sha256', SECRET_BYTES).update(`${id}.${ts}.${body}`).digest('base64');
  return `v1,${sig}`;
}

test('webhook signature: accepts a good one, rejects tampering, old timestamps and wrong secrets', () => {
  const body = Buffer.from('{"type":"email.received"}');
  const ts = String(Math.floor(Date.now() / 1000));
  const good = { secret: SECRET, id: 'msg_1', timestamp: ts, signature: sign('msg_1', ts, body.toString()), rawBody: body };
  assert.equal(verifySignature(good), true);
  // several signatures in the header (key rotation): one valid is enough
  assert.equal(verifySignature({ ...good, signature: `v1,AAAA ${good.signature}` }), true);
  assert.equal(verifySignature({ ...good, rawBody: Buffer.from('{"type":"x"}') }), false);
  assert.equal(verifySignature({ ...good, id: 'msg_2' }), false);
  assert.equal(verifySignature({ ...good, secret: `whsec_${crypto.randomBytes(24).toString('base64')}` }), false);
  assert.equal(verifySignature({ ...good, now: Date.now() + 10 * 60 * 1000 }), false); // replay window
  assert.equal(verifySignature({ ...good, signature: '' }), false);
});

test('address and html helpers', () => {
  assert.deepEqual(parseAddress('Aishath Naza <Aishath@School.edu.mv>'), { name: 'Aishath Naza', email: 'aishath@school.edu.mv' });
  assert.deepEqual(parseAddress('plain@x.com'), { name: '', email: 'plain@x.com' });
  assert.equal(htmlToText('<p>Hi&nbsp;there</p><p>Bye<br>now</p>'), 'Hi there\nBye\nnow');
});

let srv, boss;
test.before(async () => {
  process.env.RESEND_WEBHOOK_SECRET = SECRET;
  srv = await startServer(6500 + Math.floor(Math.random() * 300));
  boss = await srv.login('boss@test.com', 'Test12345');
});
test.after(() => srv.stop());

async function post(payload, { signed = true, type = 'email.received' } = {}) {
  const body = JSON.stringify({ type, data: payload });
  const id = `msg_${Math.random().toString(36).slice(2)}`;
  const ts = String(Math.floor(Date.now() / 1000));
  const res = await fetch(`${srv.base}/webhooks/resend`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'svix-id': id,
      'svix-timestamp': ts,
      'svix-signature': signed ? sign(id, ts, body) : 'v1,bad',
    },
    body,
  });
  return res.status;
}

test('inbound webhook stores a message, links the client, dedupes, and the inbox API works', async () => {
  const client = await srv.api('POST', '/clients', { name: 'Example School', email: 'head@school.test, office@school.test' }, boss);
  assert.equal(client.status, 201);

  assert.equal(await post({ email_id: 'em_1' }, { signed: false }), 401);
  assert.equal(await post({ email_id: 'em_1' }, { type: 'email.delivered' }), 200); // ignored
  assert.equal((await srv.api('GET', '/inbox', null, boss)).data.total, 0);

  const payload = {
    email_id: 'em_1',
    from: 'Head Teacher <OFFICE@school.test>',
    to: ['info@edusolutionsmv.com'],
    subject: 'Quote Q-2026-0001',
    created_at: '2026-11-25T08:30:00.000Z',
    attachments: [{ id: 'att_1', filename: 'po.pdf', content_type: 'application/pdf' }],
  };
  assert.equal(await post(payload), 200);
  assert.equal(await post(payload), 200); // Resend retry -> still one row

  const list = await srv.api('GET', '/inbox', null, boss);
  assert.equal(list.data.total, 1);
  assert.equal(list.data.unread, 1);
  const m = list.data.messages[0];
  assert.equal(m.from_email, 'office@school.test');
  assert.equal(m.client_name, 'Example School'); // matched on the second address
  assert.equal(m.attachment_count, 1);
  assert.equal(m.received_at, '2026-11-25 08:30:00');

  const one = await srv.api('GET', `/inbox/${m.id}`, null, boss);
  assert.equal(one.data.message.is_read, true);
  assert.equal(one.data.unread, 0);
  assert.equal(one.data.message.attachments[0].filename, 'po.pdf');
  assert.equal(one.data.message.resend_email_id, undefined);

  // (no RESEND_API_KEY in tests) the body fetch fails visibly instead of being lost
  await new Promise((r) => setTimeout(r, 300));
  const after = await srv.api('GET', `/inbox/${m.id}`, null, boss);
  assert.match(after.data.message.body_error, /RESEND_API_KEY/);

  assert.equal((await srv.api('POST', `/inbox/${m.id}/read`, { read: false }, boss)).data.unread, 1);
  assert.equal((await srv.api('GET', '/inbox?status=unread', null, boss)).data.total, 1);
  assert.equal((await srv.api('GET', '/inbox?q=nothingmatches', null, boss)).data.total, 0);
  await srv.api('POST', `/inbox/${m.id}/archive`, {}, boss);
  assert.equal((await srv.api('GET', '/inbox', null, boss)).data.total, 0);
  assert.equal((await srv.api('GET', '/inbox?status=archived', null, boss)).data.total, 1);
  assert.equal((await srv.api('GET', '/inbox/unread-count', null, boss)).data.count, 0);

  // replying without any email transport configured fails cleanly, and an empty reply is refused
  assert.equal((await srv.api('POST', `/inbox/${m.id}/reply`, { message: ' ' }, boss)).status, 400);
  assert.equal((await srv.api('POST', `/inbox/${m.id}/reply`, { message: 'Thanks' }, boss)).status, 503);
  assert.equal((await srv.api('GET', '/inbox/9999', null, boss)).status, 404);
});

test('the inbox needs login and the email_center grant', async () => {
  assert.equal((await srv.api('GET', '/inbox')).status, 401);
  const u = await srv.api('POST', '/users', { name: 'Staff', email: 'staff@test.com', password: 'Test12345', role: 'staff', permissions: {} }, boss);
  assert.equal(u.status, 201);
  const staff = await srv.login('staff@test.com', 'Test12345');
  assert.equal((await srv.api('GET', '/inbox', null, staff)).status, 403);
});

test('webhook is closed when no secret is configured', async () => {
  const res = await fetch(`${srv.base}/webhooks/resend`, { method: 'POST', body: '{}' });
  assert.ok([401, 503].includes(res.status));
});
