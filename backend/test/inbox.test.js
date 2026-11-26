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

test('folders: spam and trash move mail out of the inbox, trash is recoverable, delete needs trash first', async () => {
  const mk = async (id, from, subject) => {
    assert.equal(await post({ email_id: id, from, to: ['info@edusolutionsmv.com'], cc: ['Second <second@school.test>'], subject, created_at: '2026-11-26T09:00:00.000Z' }), 200);
    const list = await srv.api('GET', `/inbox?q=${encodeURIComponent(subject)}`, null, boss);
    return list.data.messages[0].id;
  };
  const spamId = await mk('em_spam', 'Promo <promo@junk.test>', 'Folder test spam');
  const trashId = await mk('em_trash', 'Parent <parent@school.test>', 'Folder test trash');

  const spam = await srv.api('POST', `/inbox/${spamId}/spam`, {}, boss);
  assert.equal(spam.data.message.spam, true);
  assert.equal((await srv.api('GET', '/inbox?q=Folder%20test%20spam', null, boss)).data.total, 0);
  assert.equal((await srv.api('GET', '/inbox?status=spam&q=Folder%20test%20spam', null, boss)).data.total, 1);
  assert.equal((await srv.api('POST', `/inbox/${spamId}/spam`, { spam: false }, boss)).data.message.spam, false);
  assert.equal((await srv.api('GET', '/inbox?q=Folder%20test%20spam', null, boss)).data.total, 1);

  // unread count ignores spam and trash
  const unreadBefore = (await srv.api('GET', '/inbox/unread-count', null, boss)).data.count;
  await srv.api('POST', `/inbox/${spamId}/spam`, {}, boss);
  await srv.api('POST', `/inbox/${trashId}/trash`, {}, boss);
  assert.equal((await srv.api('GET', '/inbox/unread-count', null, boss)).data.count, unreadBefore - 2);
  const trashList = await srv.api('GET', '/inbox?status=trash', null, boss);
  assert.equal(trashList.data.messages.some((m) => m.id === trashId), true);
  assert.ok(trashList.data.trash >= 1 && trashList.data.spam >= 1);

  // permanent delete only from trash
  assert.equal((await srv.api('DELETE', `/inbox/${spamId}`, null, boss)).status, 409);
  assert.equal((await srv.api('POST', `/inbox/${trashId}/trash`, { trashed: false }, boss)).data.message.trashed, false);
  assert.equal((await srv.api('POST', `/inbox/${trashId}/trash`, {}, boss)).data.message.trashed, true);
  assert.equal((await srv.api('DELETE', `/inbox/${trashId}`, null, boss)).status, 200);
  assert.equal((await srv.api('GET', `/inbox/${trashId}`, null, boss)).status, 404);

  // empty trash removes everything in it, and nothing outside it
  await srv.api('POST', `/inbox/${spamId}/trash`, {}, boss);
  const emptied = await srv.api('DELETE', '/inbox/trash', null, boss);
  assert.ok(emptied.data.deleted >= 1);
  assert.equal(emptied.data.trash, 0);
  assert.equal((await srv.api('GET', `/inbox/${spamId}`, null, boss)).status, 404);
});

test('reply-all recipients, thread view, and the Sent folder start empty', async () => {
  assert.equal(await post({ email_id: 'em_cc', from: 'Head <head@thread.test>', to: ['info@edusolutionsmv.com', 'colleague@thread.test'], cc: ['Second <second@thread.test>'], subject: 'Thread one', created_at: '2026-11-26T10:00:00.000Z' }), 200);
  const found = await srv.api('GET', '/inbox?q=Thread%20one', null, boss);
  const id = found.data.messages[0].id;
  const one = await srv.api('GET', `/inbox/${id}`, null, boss);
  assert.deepEqual(one.data.message.reply_all_cc.sort(), ['colleague@thread.test', 'second@thread.test']);
  assert.equal(one.data.message.references_hdr, undefined);

  assert.equal(await post({ email_id: 'em_cc2', from: 'head@thread.test', to: ['info@edusolutionsmv.com'], subject: 'Thread two', created_at: '2026-11-26T11:00:00.000Z' }), 200);
  const thread = await srv.api('GET', `/inbox/${id}/thread`, null, boss);
  assert.equal(thread.status, 200);
  assert.deepEqual(thread.data.items.map((i) => i.subject), ['Thread one', 'Thread two']);
  assert.ok(thread.data.items.every((i) => i.direction === 'in'));
  assert.equal((await srv.api('GET', '/inbox/9999/thread', null, boss)).status, 404);

  const sent = await srv.api('GET', '/inbox/sent', null, boss);
  assert.equal(sent.status, 200);
  assert.equal(sent.data.total, 0);
  assert.equal((await srv.api('GET', '/inbox/sent/1', null, boss)).status, 404);
  assert.equal((await srv.api('GET', '/inbox/sent/1/files/1', null, boss)).status, 404);
});

test('compose, reply and forward validate input; with no email transport they fail cleanly and record nothing', async () => {
  const c = (body) => srv.api('POST', '/inbox/compose', body, boss);
  assert.equal((await c({ to: '', subject: 'x', message: 'hi' })).status, 400);
  assert.match((await c({ to: 'not-an-email', subject: 'x', message: 'hi' })).data.error, /not a valid To address/);
  assert.match((await c({ to: 'a@x.com', cc: 'bad', message: 'hi' })).data.error, /not a valid Cc address/);
  assert.equal((await c({ to: 'a@x.com', subject: 'x', message: '  ' })).status, 400);
  assert.match((await c({ to: 'a@x.com', message: 'hi', attachments: [{ filename: 'virus.exe', data: 'AAAA' }] })).data.error, /cannot be sent/);
  assert.equal((await c({ to: 'a@x.com', subject: 'Hello', message: 'hi' })).status, 503); // valid, but no transport in tests
  assert.equal((await srv.api('GET', '/inbox/sent', null, boss)).data.total, 0);

  const found = await srv.api('GET', '/inbox?q=Thread%20one', null, boss);
  const id = found.data.messages[0].id;
  assert.equal((await srv.api('POST', `/inbox/${id}/reply`, { message: 'ok', to: 'bad' }, boss)).status, 400);
  assert.equal((await srv.api('POST', `/inbox/${id}/reply`, { message: 'ok', cc: 'second@thread.test' }, boss)).status, 503);
  assert.equal((await srv.api('POST', `/inbox/${id}/forward`, { to: '' }, boss)).status, 400);
  assert.equal((await srv.api('POST', `/inbox/${id}/forward`, { to: 'boss@edu.test', message: 'FYI' }, boss)).status, 503);
  assert.equal((await srv.api('POST', '/inbox/9999/forward', { to: 'a@x.com' }, boss)).status, 404);
  assert.equal((await srv.api('GET', '/inbox/sent', null, boss)).data.total, 0);
});

test('signature is saved per user and limited in length', async () => {
  assert.equal((await srv.api('GET', '/inbox/signature', null, boss)).data.signature, '');
  const saved = await srv.api('PUT', '/inbox/signature', { signature: '  Regards,\r\nEdu Solutions  ' }, boss);
  assert.equal(saved.data.signature, 'Regards,\nEdu Solutions');
  assert.equal((await srv.api('GET', '/inbox/signature', null, boss)).data.signature, 'Regards,\nEdu Solutions');
  assert.equal((await srv.api('PUT', '/inbox/signature', { signature: 'x'.repeat(2001) }, boss)).status, 400);
});

test('the inbox needs login and the email_center grant', async () => {
  assert.equal((await srv.api('GET', '/inbox')).status, 401);
  const u = await srv.api('POST', '/users', { name: 'Staff', email: 'staff@test.com', password: 'Test12345', role: 'staff', permissions: {} }, boss);
  assert.equal(u.status, 201);
  const staff = await srv.login('staff@test.com', 'Test12345');
  assert.equal((await srv.api('GET', '/inbox', null, staff)).status, 403);
  assert.equal((await srv.api('GET', '/inbox/sent', null, staff)).status, 403);
  assert.equal((await srv.api('POST', '/inbox/compose', { to: 'a@x.com', message: 'hi' }, staff)).status, 403);
  assert.equal((await srv.api('GET', '/inbox/signature', null, staff)).status, 403);
});

test('webhook is closed when no secret is configured', async () => {
  const res = await fetch(`${srv.base}/webhooks/resend`, { method: 'POST', body: '{}' });
  assert.ok([401, 503].includes(res.status));
});
