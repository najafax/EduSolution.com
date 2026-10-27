const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeEmails, primaryEmail, splitEmails } = require('../src/lib/emails');
const { startServer } = require('./helpers');

test('normalizeEmails trims, de-duplicates and validates every address', () => {
  assert.equal(normalizeEmails(' a@x.com ,b@y.com; A@X.com\nc@z.org ').value, 'a@x.com, b@y.com, c@z.org');
  assert.equal(normalizeEmails('a@x.com, nope').ok, false);
  assert.equal(normalizeEmails('  ,  ').ok, false);
  assert.equal(primaryEmail('a@x.com, b@y.com'), 'a@x.com');
  assert.deepEqual(splitEmails('a@x.com,b@y.com'), ['a@x.com', 'b@y.com']);
});

let srv, boss;
test.before(async () => {
  srv = await startServer(6100 + Math.floor(Math.random() * 300));
  boss = await srv.login('boss@test.com', 'Test12345');
});
test.after(() => srv.stop());

test('a client can hold several emails; bad ones are rejected; import resolves by any address', async () => {
  const ok = await srv.api('POST', '/clients', { name: 'Multi', email: 'one@m.test,  two@m.test' }, boss);
  assert.equal(ok.status, 201);
  assert.equal(ok.data.client.email, 'one@m.test, two@m.test');
  const bad = await srv.api('POST', '/clients', { name: 'Bad', email: 'one@m.test, oops' }, boss);
  assert.equal(bad.status, 400);
  const upd = await srv.api('PUT', `/clients/${ok.data.client.id}`, { name: 'Multi', email: 'three@m.test' }, boss);
  assert.equal(upd.data.client.email, 'three@m.test');
});
