const { Router } = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { loginLimiter, forgotPasswordLimiter, resetPasswordLimiter } = require('../middleware/rateLimit');
const { sendMail } = require('../lib/mailer');

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

const router = Router();

function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email, name: user.name }, process.env.JWT_SECRET, {
    expiresIn: '7d',
  });
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, createdAt: user.created_at };
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

  const token = signToken(user);
  res.json({ token, user: publicUser(user) });
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
  db.prepare('UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?').run(
    passwordHash,
    user.id,
  );

  res.json({ message: 'Password updated. You can now log in.' });
});

router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json({ user: publicUser(user) });
});

module.exports = router;
