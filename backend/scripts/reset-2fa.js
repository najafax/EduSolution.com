// Emergency recovery for the case where nobody can sign in with 2-step
// verification (e.g. the only super admin lost their phone and recovery codes,
// or JWT_SECRET was rotated, which makes stored secrets unreadable).
//   node scripts/reset-2fa.js you@yourbusiness.com
// Needs shell access to the server, the same trust level as create-user.js.
require('dotenv').config();
const db = require('../src/db');

const email = (process.argv[2] || '').trim().toLowerCase();
if (!email) {
  console.error('Usage: node scripts/reset-2fa.js <email>');
  process.exit(1);
}
const user = db.prepare('SELECT id, name, totp_enabled FROM users WHERE email = ?').get(email);
if (!user) {
  console.error(`No account with the email ${email}`);
  process.exit(1);
}
db.prepare(`UPDATE users SET totp_enabled = 0, totp_secret = '', totp_last_step = 0, totp_recovery = '[]' WHERE id = ?`).run(user.id);
db.prepare(`UPDATE sessions SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL`).run(user.id);
console.log(user.totp_enabled ? `Two-step verification removed for ${user.name}.` : `${user.name} did not have two-step verification on; nothing changed.`);
