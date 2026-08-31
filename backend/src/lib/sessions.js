const crypto = require('crypto');
const db = require('../db');

// Session/device visibility (MyAccount.jsx) — see db/index.js's `sessions`
// table for the full reasoning. One row per issued JWT; `jti` (a random id
// embedded in the token payload, not the token itself, which is never
// stored) is the join key between a request's Authorization header and its
// row here.

function createSession(userId, req) {
  const jti = crypto.randomBytes(16).toString('hex');
  db.prepare('INSERT INTO sessions (user_id, jti, user_agent, ip_address) VALUES (?, ?, ?, ?)').run(
    userId,
    jti,
    String(req.headers['user-agent'] || '').slice(0, 300),
    String(req.ip || '').slice(0, 100),
  );
  return jti;
}

// A token with no matching row (revoked, or never tracked — see
// middleware/auth.js's requireAuth on why an untracked jti is treated as
// "not session-gated" rather than rejected) never reaches this; only called
// once per request for a token that already resolved to an active session.
function touchSession(jti) {
  db.prepare("UPDATE sessions SET last_seen_at = datetime('now') WHERE jti = ?").run(jti);
}

function getActiveSession(jti) {
  return db.prepare('SELECT * FROM sessions WHERE jti = ? AND revoked_at IS NULL').get(jti);
}

// "Sign out everywhere else" — revokes every one of this user's other
// active sessions in one call, leaving the current one (if there is one —
// see below) untouched. `currentJti` is `req.sessionJti`, which is only
// set when the *current* request's own token carries a `jti` at all (a
// token minted before this feature shipped has none — see requireAuth's
// own note on why that's let through unchecked); when it's falsy there's
// no current-session row to exclude, so every one of this user's tracked
// sessions is fair game. Returns the number of rows actually revoked, so
// the caller can report "signed out N other devices" back to the user.
function revokeOtherSessions(userId, currentJti) {
  const result = currentJti
    ? db
        .prepare("UPDATE sessions SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL AND jti != ?")
        .run(userId, currentJti)
    : db.prepare("UPDATE sessions SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL").run(userId);
  return result.changes;
}

module.exports = { createSession, touchSession, getActiveSession, revokeOtherSessions };
