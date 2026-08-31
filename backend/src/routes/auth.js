const { Router } = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { loginLimiter, forgotPasswordLimiter, resetPasswordLimiter } = require('../middleware/rateLimit');
const { sendMail } = require('../lib/mailer');
const { effectivePermissions } = require('../lib/permissions');
const { createSession, revokeOtherSessions } = require('../lib/sessions');

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

// Profile photo — same base64-data-URI validation shape
// routes/clientPortal.js's own payment-proof upload uses (checked against
// the actual decoded byte length, never trusted from the client), just
// images only (no PDF — a profile photo isn't a document) and a smaller
// cap, since this is a small avatar, not a scanned bank slip.
const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const AVATAR_MAX_BYTES = 3 * 1024 * 1024;

const router = Router();

// `jti` ties this token to a `sessions` row (see lib/sessions.js) so it can
// later be listed/revoked from MyAccount.jsx without touching the
// password. Optional: `change-password` below re-signs a fresh token for
// an already-active session and passes its *existing* jti back in (the
// session itself hasn't changed, only the signature/iat has), rather than
// minting a whole new session row for what's really the same device.
function signToken(user, jti) {
  const payload = { id: user.id, email: user.email, name: user.name };
  if (jti) payload.jti = jti;
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
}

// The idle-logout timeout applies to every logged-in user regardless of
// their `settings` permission grant (it's a security policy, not business
// data), so it's sent alongside login/me rather than gated behind
// GET /api/settings like the rest of business_settings.
function getSessionTimeoutMinutes() {
  const row = db.prepare('SELECT session_timeout_minutes FROM business_settings WHERE id = 1').get();
  return row ? row.session_timeout_minutes : 30;
}

// The single place that shapes what a user record ever sends to the client
// — never return a raw DB row (it carries password_hash, reset_token, etc).
function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    restricted: Boolean(user.restricted),
    notifyOverdue: Boolean(user.notify_overdue),
    notifyQuoteResponses: Boolean(user.notify_quote_responses),
    notifyMonthlyReport: Boolean(user.notify_monthly_report),
    notifyPaymentProofs: Boolean(user.notify_payment_proofs),
    notifyAdminChanges: Boolean(user.notify_admin_changes),
    avatarImage: user.avatar_image || '',
    createdAt: user.created_at,
  };
}

// There is deliberately no public signup route. Every logged-in user sees
// and can edit all business data (single-business model, no per-user
// ownership), so open registration would hand full read/write access to
// anyone who found the URL. Accounts are created out-of-band by an operator:
//   cd backend && npm run create-user
// See scripts/create-user.js.

router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  if (!user.active) {
    return res.status(401).json({ error: 'This account has been deactivated' });
  }

  const jti = createSession(user.id, req);
  const token = signToken(user, jti);
  res.json({
    token,
    user: publicUser(user),
    permissions: effectivePermissions(user),
    sessionTimeoutMinutes: getSessionTimeoutMinutes(),
  });
});

router.post('/forgot-password', forgotPasswordLimiter, async (req, res) => {
  const { email } = req.body || {};
  if (!email) {
    return res.status(400).json({ error: 'email is required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  // Always respond the same way whether or not the account exists, so this
  // endpoint can't be used to enumerate registered emails.
  const genericMessage = { message: 'If an account exists for that email, a password reset link has been sent.' };

  if (!user) {
    return res.json(genericMessage);
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();
  db.prepare('UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?').run(token, expires, user.id);

  const resetUrl = `${process.env.CLIENT_ORIGIN || 'http://localhost:5173'}/reset-password?token=${token}`;
  try {
    await sendMail({
      to: user.email,
      subject: 'Reset your password',
      html: `<p>Hi ${user.name},</p><p>Click the link below to reset your password. This link expires in 1 hour.</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you didn't request this, you can ignore this email.</p>`,
    });
  } catch (err) {
    // Don't leak SMTP configuration state to the client — same generic
    // response either way. Server-side log is enough to diagnose in dev.
    console.error('Failed to send password reset email:', err.message);
  }

  res.json(genericMessage);
});

router.post('/reset-password', resetPasswordLimiter, async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) {
    return res.status(400).json({ error: 'token and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const user = db.prepare('SELECT * FROM users WHERE reset_token = ?').get(token);
  if (!user || !user.reset_token_expires || new Date(user.reset_token_expires) < new Date()) {
    return res.status(400).json({ error: 'This reset link is invalid or has expired' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  db.prepare(
    `UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL, password_changed_at = datetime('now') WHERE id = ?`,
  ).run(passwordHash, user.id);

  res.json({ message: 'Password updated. You can now log in.' });
});

router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json({
    user: publicUser(user),
    permissions: effectivePermissions(user),
    sessionTimeoutMinutes: getSessionTimeoutMinutes(),
  });
});

// Every logged-in user can edit their own profile — this is not gated by
// the 'users' permission, which is about managing *other* accounts.
router.put('/me', requireAuth, (req, res) => {
  const { name, email: emailInput } = req.body || {};
  if (!name || !emailInput) {
    return res.status(400).json({ error: 'name and email are required' });
  }
  const email = String(emailInput).trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Invalid email address' });

  const taken = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, req.user.id);
  if (taken) return res.status(409).json({ error: 'An account with this email already exists' });

  db.prepare('UPDATE users SET name = ?, email = ? WHERE id = ?').run(name.trim(), email, req.user.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(user) });
});

// Also ungated by the 'users' permission, same reasoning as PUT /me above
// — every account can set its own photo regardless of module grants.
router.put('/avatar', requireAuth, (req, res) => {
  const { image } = req.body || {};
  if (!image) return res.status(400).json({ error: 'An image is required' });

  const typeMatch = /^data:([^;]+);base64,/.exec(image);
  const mimeType = typeMatch ? typeMatch[1] : null;
  if (!mimeType || !AVATAR_TYPES.includes(mimeType)) {
    return res.status(400).json({ error: 'Only JPEG, PNG, or WEBP images are accepted' });
  }
  const match = new RegExp(`^data:${mimeType.replace('/', '\\/')};base64,([A-Za-z0-9+/]+=*)$`).exec(image);
  if (!match) return res.status(400).json({ error: 'The uploaded image could not be read' });
  const byteLength = Buffer.byteLength(match[1], 'base64');
  if (byteLength > AVATAR_MAX_BYTES) {
    return res.status(400).json({ error: 'Image is too large — please keep it under 3MB' });
  }

  db.prepare('UPDATE users SET avatar_image = ? WHERE id = ?').run(image, req.user.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(user) });
});

router.delete('/avatar', requireAuth, (req, res) => {
  db.prepare("UPDATE users SET avatar_image = '' WHERE id = ?").run(req.user.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(user) });
});

router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required' });
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

  const passwordHash = await bcrypt.hash(newPassword, 10);
  db.prepare(`UPDATE users SET password_hash = ?, password_changed_at = datetime('now') WHERE id = ?`).run(
    passwordHash,
    req.user.id,
  );
  // Bumping password_changed_at invalidates every token issued before now,
  // including the one this request just authenticated with — issue a fresh
  // one so the caller's own session doesn't get logged out by its own
  // password change. Carries the *same* jti forward (req.sessionJti, set
  // by requireAuth — absent for a pre-session-tracking token, in which case
  // this naturally starts tracking a session for it going forward instead
  // of leaving it untracked forever) rather than minting a new sessions
  // row — this is still the same device/session, just a refreshed
  // signature, so it should keep reading as one entry in MyAccount.jsx's
  // list, not spawn a duplicate.
  const jti = req.sessionJti || createSession(user.id, req);
  res.json({ message: 'Password updated.', token: signToken(user, jti) });
});

// Five personal preferences: opt in to a daily digest email when the
// overdue-reminder job actually sends reminders (see lib/scheduler.js),
// opt in to a notification whenever a client accepts a quote (see
// lib/quoteAcceptedNotify.js), opt in to the automated monthly P&L
// summary email (see lib/scheduler.js's `runMonthlyReport()`), opt in to a
// notification whenever a client uploads a payment proof (see
// lib/paymentProofNotify.js), and opt in to a notification whenever a new
// admin-tier account is created or an existing one is promoted (see
// lib/adminChangeNotify.js — only ever meaningful for a super_admin
// account, but stored/accepted the same as the other four rather than a
// role-specific special case). All five fields are optional in the body so
// a caller updating one doesn't have to also resend the others' current
// values — `?? existing` keeps whichever wasn't sent unchanged, rather
// than silently resetting it to false.
router.put('/preferences', requireAuth, (req, res) => {
  const existing = db
    .prepare(
      `SELECT notify_overdue, notify_quote_responses, notify_monthly_report, notify_payment_proofs,
              notify_admin_changes FROM users WHERE id = ?`,
    )
    .get(req.user.id);
  const { notifyOverdue, notifyQuoteResponses, notifyMonthlyReport, notifyPaymentProofs, notifyAdminChanges } =
    req.body || {};
  db.prepare(
    `UPDATE users SET notify_overdue = ?, notify_quote_responses = ?, notify_monthly_report = ?,
       notify_payment_proofs = ?, notify_admin_changes = ? WHERE id = ?`,
  ).run(
    (notifyOverdue ?? existing.notify_overdue) ? 1 : 0,
    (notifyQuoteResponses ?? existing.notify_quote_responses) ? 1 : 0,
    (notifyMonthlyReport ?? existing.notify_monthly_report) ? 1 : 0,
    (notifyPaymentProofs ?? existing.notify_payment_proofs) ? 1 : 0,
    (notifyAdminChanges ?? existing.notify_admin_changes) ? 1 : 0,
    req.user.id,
  );
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(user) });
});

// Session/device visibility (MyAccount.jsx) — see lib/sessions.js and
// db/index.js's `sessions` table. Every account manages only its own
// sessions; there's no admin-facing "see someone else's active devices"
// view here (that's a meaningfully bigger surveillance feature nobody
// asked for — this is purely the self-service "did I leave myself logged
// in on a lost laptop" list every account already gets for itself).
router.get('/sessions', requireAuth, (req, res) => {
  const rows = db
    .prepare('SELECT * FROM sessions WHERE user_id = ? AND revoked_at IS NULL ORDER BY last_seen_at DESC')
    .all(req.user.id);
  res.json({
    sessions: rows.map((s) => ({
      id: s.id,
      userAgent: s.user_agent,
      ipAddress: s.ip_address,
      createdAt: s.created_at,
      lastSeenAt: s.last_seen_at,
      isCurrent: Boolean(req.sessionJti) && s.jti === req.sessionJti,
    })),
  });
});

router.delete('/sessions/:id', requireAuth, (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (req.sessionJti && session.jti === req.sessionJti) {
    return res.status(400).json({ error: "You can't revoke your current session — log out instead" });
  }
  db.prepare("UPDATE sessions SET revoked_at = datetime('now') WHERE id = ?").run(session.id);
  res.status(204).end();
});

// "Sign out everywhere else" — a bulk sibling of the single-session DELETE
// above, for the common real case (a lost/stolen device, or just cleaning
// up after using a lot of shared machines) where revoking one row at a
// time is tedious. Distinct path shape from `/sessions/:id` (no trailing
// segment), so there's no literal-vs-`:id` ordering concern the way
// `GET /summary` elsewhere in this app has to register ahead of `GET /:id`.
router.delete('/sessions', requireAuth, (req, res) => {
  const revoked = revokeOtherSessions(req.user.id, req.sessionJti);
  res.json({ revoked });
});

module.exports = router;
