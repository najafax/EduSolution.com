const { Router } = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { loginLimiter, forgotPasswordLimiter, resetPasswordLimiter } = require('../middleware/rateLimit');
const { sendMail } = require('../lib/mailer');
const { effectivePermissions } = require('../lib/permissions');

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

const router = Router();

function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email, name: user.name }, process.env.JWT_SECRET, {
    expiresIn: '7d',
  });
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
    notifyOverdue: Boolean(user.notify_overdue),
    notifyQuoteResponses: Boolean(user.notify_quote_responses),
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

  const token = signToken(user);
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
  // password change.
  res.json({ message: 'Password updated.', token: signToken(user) });
});

// Two personal preferences: opt in to a daily digest email when the
// overdue-reminder job actually sends reminders (see lib/scheduler.js), and
// opt in to a notification whenever a client accepts a quote (see
// lib/quoteAcceptedNotify.js). Both fields are optional in the body so a
// caller updating one doesn't have to also resend the other's current
// value — `?? existing` keeps whichever wasn't sent unchanged, rather than
// silently resetting it to false.
router.put('/preferences', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT notify_overdue, notify_quote_responses FROM users WHERE id = ?').get(req.user.id);
  const { notifyOverdue, notifyQuoteResponses } = req.body || {};
  db.prepare('UPDATE users SET notify_overdue = ?, notify_quote_responses = ? WHERE id = ?').run(
    (notifyOverdue ?? existing.notify_overdue) ? 1 : 0,
    (notifyQuoteResponses ?? existing.notify_quote_responses) ? 1 : 0,
    req.user.id,
  );
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(user) });
});

module.exports = router;
