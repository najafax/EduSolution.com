const { Router } = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email, name: user.name }, process.env.JWT_SECRET, {
    expiresIn: '7d',
  });
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, createdAt: user.created_at };
}

router.post('/signup', async (req, res) => {
  const { name, email, password } = req.body || {};

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email and password are required' });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const result = db
    .prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
    .run(name.trim(), email.toLowerCase(), passwordHash);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  const token = signToken(user);

  res.status(201).json({ token, user: publicUser(user) });
});

router.post('/login', async (req, res) => {
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

router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json({ user: publicUser(user) });
});

module.exports = router;
