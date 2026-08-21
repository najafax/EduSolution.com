const { Router } = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { requireClientAuth } = require('../middleware/clientAuth');
const {
  portalLoginLimiter,
  portalForgotPasswordLimiter,
  portalResetPasswordLimiter,
  portalAcceptInviteLimiter,
} = require('../middleware/rateLimit');
const { sendMail } = require('../lib/mailer');

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour, same window as staff resets
const MIN_PASSWORD_LENGTH = 8;

const router = Router();

function signClientToken(account) {
  return jwt.sign({ id: account.id, clientId: account.client_id, email: account.email, type: 'client' }, process.env.JWT_SECRET, {
    expiresIn: '7d',
  });
}

// The single place that shapes what a portal account ever sends to the
// client — never return a raw row (it carries password_hash, tokens, etc).
function publicAccount(account) {
  return {
    id: account.id,
    clientId: account.client_id,
    clientName: account.client_name,
    email: account.email,
  };
}

function getAccountWithClientName(id) {
  return db
    .prepare(
      `SELECT client_portal_accounts.*, clients.name AS client_name
       FROM client_portal_accounts
       JOIN clients ON clients.id = client_portal_accounts.client_id
       WHERE client_portal_accounts.id = ?`,
    )
    .get(id);
}

// There is no signup route here either, same reasoning as routes/auth.js —
// a portal account is only ever created by an admin inviting an existing
// client (routes/clients.js's POST /:id/portal-invite, added alongside the
// portal's own admin-facing UI), never by someone showing up with an email.

router.post('/login', portalLoginLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const account = db
    .prepare(
      `SELECT client_portal_accounts.*, clients.name AS client_name
       FROM client_portal_accounts
       JOIN clients ON clients.id = client_portal_accounts.client_id
       WHERE client_portal_accounts.email = ?`,
    )
    .get(String(email).toLowerCase());
  if (!account) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  if (!account.password_hash) {
    return res.status(401).json({ error: 'This account has not been activated yet. Check your email for an invite link.' });
  }

  const valid = await bcrypt.compare(password, account.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  if (!account.active) {
    return res.status(401).json({ error: 'This account has been deactivated' });
  }

  res.json({ token: signClientToken(account), account: publicAccount(account) });
});

router.post('/accept-invite', portalAcceptInviteLimiter, async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) {
    return res.status(400).json({ error: 'token and password are required' });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }

  const account = db.prepare('SELECT * FROM client_portal_accounts WHERE invite_token = ?').get(token);
  if (!account || !account.invite_token_expires || new Date(account.invite_token_expires) < new Date()) {
    return res.status(400).json({ error: 'This invite link is invalid or has expired' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  db.prepare(
    `UPDATE client_portal_accounts
     SET password_hash = ?, invite_token = NULL, invite_token_expires = NULL, password_changed_at = datetime('now')
     WHERE id = ?`,
  ).run(passwordHash, account.id);

  res.json({ message: 'Password set. You can now log in.' });
});

router.post('/forgot-password', portalForgotPasswordLimiter, async (req, res) => {
  const { email } = req.body || {};
  if (!email) {
    return res.status(400).json({ error: 'email is required' });
  }

  const account = db.prepare('SELECT * FROM client_portal_accounts WHERE email = ?').get(String(email).toLowerCase());
  // Always respond the same way whether or not the account exists, same
  // reasoning as routes/auth.js's own forgot-password.
  const genericMessage = { message: 'If an account exists for that email, a password reset link has been sent.' };

  if (!account) {
    return res.json(genericMessage);
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();
  db.prepare('UPDATE client_portal_accounts SET reset_token = ?, reset_token_expires = ? WHERE id = ?').run(
    token,
    expires,
    account.id,
  );

  const resetUrl = `${process.env.CLIENT_ORIGIN || 'http://localhost:5173'}/portal/reset-password?token=${token}`;
  try {
    await sendMail({
      to: account.email,
      subject: 'Reset your portal password',
      html: `<p>Hi,</p><p>Click the link below to reset your portal password. This link expires in 1 hour.</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you didn't request this, you can ignore this email.</p>`,
    });
  } catch (err) {
    console.error('Failed to send portal password reset email:', err.message);
  }

  res.json(genericMessage);
});

router.post('/reset-password', portalResetPasswordLimiter, async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) {
    return res.status(400).json({ error: 'token and password are required' });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }

  const account = db.prepare('SELECT * FROM client_portal_accounts WHERE reset_token = ?').get(token);
  if (!account || !account.reset_token_expires || new Date(account.reset_token_expires) < new Date()) {
    return res.status(400).json({ error: 'This reset link is invalid or has expired' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  db.prepare(
    `UPDATE client_portal_accounts
     SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL, password_changed_at = datetime('now')
     WHERE id = ?`,
  ).run(passwordHash, account.id);

  res.json({ message: 'Password updated. You can now log in.' });
});

router.get('/me', requireClientAuth, (req, res) => {
  const account = getAccountWithClientName(req.clientAccount.id);
  res.json({ account: publicAccount(account) });
});

module.exports = router;
