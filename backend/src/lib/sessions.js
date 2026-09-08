const crypto = require('crypto');
const db = require('../db');

// Session/device visibility (MyAccount.jsx) — see db/index.js's `sessions`
// table for the full reasoning. One row per issued JWT; `jti` (a random id
// embedded in the token payload, not the token itself, which is never
// stored) is the join key between a request's Authorization header and its
// row here.

// At most this many concurrent active sessions per staff account — signing
// in on one more than this auto-signs-out the oldest still-active one (see
// enforceSessionLimit() below), rather than letting the list grow without
// bound the way it could before this existed. Deliberately a fixed
// constant, not a `business_settings` field — this app has no other
// per-account security policy that's admin-tunable per user (only the
// single, business-wide `session_timeout_minutes`, see "Idle session
// timeout" in CLAUDE.md), and a hardcoded cap needed no new settings UI to
// ship.
const MAX_ACTIVE_SESSIONS = 3;

function createSession(userId, req) {
  const jti = crypto.randomBytes(16).toString('hex');
  db.prepare('INSERT INTO sessions (user_id, jti, user_agent, ip_address) VALUES (?, ?, ?, ?)').run(
    userId,
    jti,
    String(req.headers['user-agent'] || '').slice(0, 300),
    String(req.ip || '').slice(0, 100),
  );
  enforceSessionLimit(userId);
  return jti;
}

// Keeps at most MAX_ACTIVE_SESSIONS active (non-revoked) sessions per user —
// called right after `createSession` inserts a fresh row, so signing in on
// a 4th device automatically revokes the oldest still-active one instead of
// leaving every device signed in forever. Oldest-first by `created_at`
// (ties broken by `id`, since two sessions can share the same
// second-resolution timestamp), matching the same order `GET
// /api/auth/sessions` already lists them in. The revoked device isn't
// pushed a live notice — same as a manual "Sign out" from MyAccount.jsx
// today — it simply gets "This session has been signed out" (see
// middleware/auth.js's `requireAuth`) the next time it makes an API call.
// `POST /change-password`'s own call site never triggers this — it reuses
// the current request's own `jti` via `req.sessionJti` rather than calling
// `createSession`, so refreshing a token after a password change never
// counts as a new device.
function enforceSessionLimit(userId) {
  const active = db
    .prepare('SELECT jti FROM sessions WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at ASC, id ASC')
    .all(userId);
  const excess = active.length - MAX_ACTIVE_SESSIONS;
  if (excess <= 0) return;
  const oldest = active.slice(0, excess).map((s) => s.jti);
  const placeholders = oldest.map(() => '?').join(', ');
  db.prepare(`UPDATE sessions SET revoked_at = datetime('now') WHERE jti IN (${placeholders})`).run(...oldest);
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
