const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

let srv, boss;
test.before(async () => {
  srv = await startServer(6800 + Math.floor(Math.random() * 300));
  boss = await srv.login('boss@test.com', 'Test12345');
});
test.after(() => srv.stop());

const long = () => Date.now() - 10000; // rendered 10s ago
const good = { name: 'Aishath Naza', organisation: 'Example School', email: 'Aishath@School.test', phone: '7771234', interest: 'edupage', message: 'About 600 students.' };

// The public limiter allows 5 requests an hour per address, so this test
// sends exactly five.
test('public enquiry form: spam traps, validation, per-address cap, storage and staff handling', async () => {
  const count = () => {
    const db = srv.db();
    try {
      return db.prepare('SELECT COUNT(*) AS n FROM website_enquiries').get().n;
    } finally {
      db.close();
    }
  };

  // honeypot filled and "submitted too fast" both look like success but store nothing
  assert.equal((await srv.api('POST', '/public/enquiries', { ...good, website: 'http://spam', t: long() })).data.ok, true);
  assert.equal((await srv.api('POST', '/public/enquiries', { ...good, t: Date.now() })).data.ok, true);
  assert.equal(count(), 0);

  assert.equal((await srv.api('POST', '/public/enquiries', { ...good, email: 'nope', t: long() })).status, 400);

  const ok = await srv.api('POST', '/public/enquiries', { ...good, interest: 'bogus', t: long() });
  assert.equal(ok.status, 200);
  assert.equal(count(), 1);

  // more than 3 in a day from one address is refused
  const db = srv.db();
  for (let i = 0; i < 3; i++) db.prepare("INSERT INTO website_enquiries (name, email) VALUES ('x', 'busy@x.test')").run();
  db.close();
  assert.equal((await srv.api('POST', '/public/enquiries', { ...good, email: 'busy@x.test', t: long() })).status, 429);

  // staff side
  assert.equal((await srv.api('GET', '/website/enquiries', null)).status, 401);
  const list = await srv.api('GET', '/website/enquiries', null, boss);
  const mine = list.data.enquiries.find((e) => e.email === 'aishath@school.test');
  assert.equal(mine.interest, 'unsure'); // unknown interest falls back
  assert.equal(mine.status, 'new');
  assert.ok(list.data.newCount >= 1);

  assert.equal((await srv.api('PUT', `/website/enquiries/${mine.id}/status`, { status: 'nope' }, boss)).status, 400);
  const made = await srv.api('POST', `/website/enquiries/${mine.id}/create-client`, null, boss);
  assert.equal(made.status, 201);
  const client = await srv.api('GET', `/clients/${made.data.clientId}`, null, boss);
  assert.equal(client.data.client.name, 'Example School');
  assert.equal(client.data.client.email, 'aishath@school.test');
  assert.equal(made.data.enquiry.status, 'contacted');
  assert.equal((await srv.api('POST', `/website/enquiries/${mine.id}/create-client`, null, boss)).status, 409);
  assert.equal((await srv.api('PUT', `/website/enquiries/${mine.id}/status`, { status: 'closed' }, boss)).data.enquiry.status, 'closed');
});
