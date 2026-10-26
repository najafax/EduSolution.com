const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

let srv, boss;
test.before(async () => {
  srv = await startServer(5300 + Math.floor(Math.random() * 300));
  boss = await srv.login('boss@test.com', 'Test12345');
});
test.after(() => srv.stop());

test('browser errors are recorded, de-duplicated and rate-limited input is validated', async () => {
  const body = { message: 'x is undefined', stack: 'TypeError\n    at Foo (app.js:10:5)', url: '/invoices/123' };
  assert.equal((await srv.api('POST', '/client-errors', body)).status, 204);
  assert.equal((await srv.api('POST', '/client-errors', { ...body, url: '/invoices/456' })).status, 204);
  assert.equal((await srv.api('POST', '/client-errors', {})).status, 400);
  const list = (await srv.api('GET', '/error-log', null, boss)).data;
  assert.equal(list.errors.length, 1);
  assert.equal(list.errors[0].count, 2);
  assert.equal(list.errors[0].source, 'browser');
  assert.equal(list.openCount, 1);
});

test('error log is admin only', async () => {
  assert.equal((await srv.api('GET', '/error-log')).status, 401);
  const staff = (await srv.api('POST', '/users', { name: 'S', email: 's@test.com', password: 'Staff12345', role: 'staff' }, boss));
  assert.equal(staff.status, 201);
  const t = await srv.login('s@test.com', 'Staff12345');
  assert.equal((await srv.api('GET', '/error-log', null, t)).status, 403);
});

test('resolve, and a recurrence reopens it', async () => {
  const { errors } = (await srv.api('GET', '/error-log', null, boss)).data;
  assert.equal((await srv.api('POST', `/error-log/${errors[0].id}/resolve`, null, boss)).status, 200);
  assert.equal((await srv.api('GET', '/error-log', null, boss)).data.errors.length, 0);
  await srv.api('POST', '/client-errors', { message: 'x is undefined', stack: 'TypeError\n    at Foo (app.js:10:5)' });
  assert.equal((await srv.api('GET', '/error-log', null, boss)).data.errors.length, 1);
});

test('oversized report body is rejected', async () => {
  const r = await srv.api('POST', '/client-errors', { message: 'a'.repeat(60000) });
  assert.equal(r.status, 413);
});
