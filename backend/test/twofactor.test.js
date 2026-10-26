const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');
const totp = require('../src/lib/totp');

let srv;
test.before(async () => {
  srv = await startServer(4900 + Math.floor(Math.random() * 90));
});
test.after(() => srv.stop());

test('TOTP matches the RFC 6238 test vector and rejects replays', () => {
  process.env.JWT_SECRET = 'x';
  const secret = totp.base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(totp.codeForStep(secret, Math.floor(59 / 30)), '287082');
  assert.equal(totp.verifyCode(secret, '287082', { nowMs: 59_000 }), 1);
  assert.equal(totp.verifyCode(secret, '287082', { nowMs: 59_000, lastStep: 1 }), null); // same step again
  assert.equal(totp.verifyCode(secret, '000000', { nowMs: 59_000 }), null);
  assert.equal(totp.decryptSecret(totp.encryptSecret(secret)), secret);
  assert.equal(totp.decryptSecret('garbage'), null);
});

test('two-step login: setup, enforced at login, one-use codes, recovery, disable', async () => {
  const api = srv.api;
  const boss = await srv.login('boss@test.com', 'Test12345');

  // Not on yet -> normal login.
  assert.equal((await api('POST', '/auth/login', { email: 'boss@test.com', password: 'Test12345' })).data.mfaRequired, undefined);

  // Enabling needs the setup step first, and a valid code.
  assert.equal((await api('POST', '/auth/2fa/enable', { code: '123456' }, boss)).status, 400);
  const setup = (await api('POST', '/auth/2fa/setup', {}, boss)).data;
  assert.match(setup.otpauthUri, /^otpauth:\/\/totp\//);
  assert.equal((await api('POST', '/auth/2fa/enable', { code: '000000' }, boss)).status, 400);
  const now = totp.currentStep();
  const enabled = await api('POST', '/auth/2fa/enable', { code: totp.codeForStep(setup.secret, now) }, boss);
  assert.equal(enabled.status, 200);
  assert.equal(enabled.data.recoveryCodes.length, 10);
  assert.equal((await api('GET', '/auth/me', null, boss)).data.user.twoFactorEnabled, true);

  // The secret is not stored in the clear.
  const d = srv.db();
  const row = d.prepare("SELECT totp_secret FROM users WHERE email = 'boss@test.com'").get();
  d.close();
  assert.ok(!row.totp_secret.includes(setup.secret));

  // Password alone no longer gives a session.
  const step1 = (await api('POST', '/auth/login', { email: 'boss@test.com', password: 'Test12345' })).data;
  assert.equal(step1.mfaRequired, true);
  assert.equal(step1.token, undefined);
  // ...and the ticket it hands back cannot be used as a login.
  assert.equal((await api('GET', '/auth/me', null, step1.mfaToken)).status, 401);

  // Wrong code, then a correct one (next time step, so it is not a replay of the enable code).
  assert.equal((await api('POST', '/auth/login/mfa', { mfaToken: step1.mfaToken, code: '000000' })).status, 401);
  const good = totp.codeForStep(setup.secret, now + 1);
  const ok = await api('POST', '/auth/login/mfa', { mfaToken: step1.mfaToken, code: good });
  assert.equal(ok.status, 200);
  assert.ok(ok.data.token);
  assert.equal((await api('GET', '/auth/me', null, ok.data.token)).status, 200);
  // The same code cannot be used twice.
  assert.equal((await api('POST', '/auth/login/mfa', { mfaToken: step1.mfaToken, code: good })).status, 401);

  // A recovery code works once.
  const rec = enabled.data.recoveryCodes[0];
  const viaRecovery = await api('POST', '/auth/login/mfa', { mfaToken: step1.mfaToken, code: rec });
  assert.equal(viaRecovery.status, 200);
  assert.equal((await api('POST', '/auth/login/mfa', { mfaToken: step1.mfaToken, code: rec })).status, 401);

  // Turning it off needs the password AND a code.
  const t = ok.data.token;
  assert.equal((await api('POST', '/auth/2fa/disable', { password: 'wrong', code: enabled.data.recoveryCodes[1] }, t)).status, 401);
  assert.equal((await api('POST', '/auth/2fa/disable', { password: 'Test12345', code: '000000' }, t)).status, 401);
  assert.equal((await api('POST', '/auth/2fa/disable', { password: 'Test12345', code: enabled.data.recoveryCodes[1] }, t)).status, 200);
  assert.equal((await api('POST', '/auth/login', { email: 'boss@test.com', password: 'Test12345' })).data.mfaRequired, undefined);
});

test('a super admin can reset a staff member\'s two-step setup', async () => {
  const api = srv.api;
  const boss = await srv.login('boss@test.com', 'Test12345');
  const made = await api('POST', '/users', { name: 'Sam', email: 'sam@test.com', password: 'Sam12345', role: 'staff', permissions: {} }, boss);
  assert.equal(made.status, 201);
  const samId = made.data.user.id;
  const sam = await srv.login('sam@test.com', 'Sam12345');
  const setup = (await api('POST', '/auth/2fa/setup', {}, sam)).data;
  assert.equal((await api('POST', '/auth/2fa/enable', { code: totp.codeForStep(setup.secret, totp.currentStep()) }, sam)).status, 200);
  assert.equal((await api('POST', '/users/' + samId + '/reset-2fa', {}, boss)).status, 204);
  assert.equal((await api('POST', '/users/' + samId + '/reset-2fa', {}, boss)).status, 409); // nothing left to reset
  assert.equal((await api('GET', '/auth/me', null, sam)).status, 401); // old session signed out
  assert.equal((await api('POST', '/auth/login', { email: 'sam@test.com', password: 'Sam12345' })).data.mfaRequired, undefined);
});
