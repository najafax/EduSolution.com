const { Router } = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { MODULES, getPermissions, setPermissions } = require('../lib/permissions');
const { logActivity } = require('../lib/activity');

const router = Router();
router.use(requireAuth);
const view = requirePermission('users', 'view');
const manage = requirePermission('users', 'manage');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = ['admin', 'staff'];
const MIN_PASSWORD_LENGTH = 8;

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    active: Boolean(user.active),
    notify_overdue: Boolean(user.notify_overdue),
    created_at: user.created_at,
  };
}

function activeAdminCount(excludingUserId) {
  const row = db
    .prepare('SELECT COUNT(*) AS c FROM users WHERE role = ? AND active = 1 AND id != ?')
    .get('admin', excludingUserId ?? -1);
  return row.c;
}

const PAGE_SIZE = 20;

router.get('/', view, (req, res) => {
  const { q, page: pageParam } = req.query;
  const where = q ? 'WHERE name LIKE ? OR email LIKE ?' : '';
  const params = q ? [`%${q}%`, `%${q}%`] : [];

  if (!pageParam) {
    const users = db.prepare(`SELECT * FROM users ${where} ORDER BY id`).all(...params);
    return res.json({ users: users.map(publicUser) });
  }

  const page = Math.max(1, Number(pageParam) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM users ${where}`).get(...params);
  const users = db.prepare(`SELECT * FROM users ${where} ORDER BY id LIMIT ? OFFSET ?`).all(...params, PAGE_SIZE, offset);
  res.json({
    users: users.map(publicUser),
    page,
    pageSize: PAGE_SIZE,
    total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
});

router.get('/:id', view, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: publicUser(user), permissions: getPermissions(user.id) });
});

router.post('/', manage, async (req, res) => {
  const { name, email: emailInput, password, role = 'staff', permissions } = req.body || {};

  if (!name || !emailInput || !password) {
    return res.status(400).json({ error: 'name, email and password are required' });
  }
  const email = String(emailInput).trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Invalid email address' });
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }
  if (!ROLES.includes(role)) return res.status(400).json({ error: `role must be one of: ${ROLES.join(', ')}` });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

  const passwordHash = await bcrypt.hash(password, 10);
  const result = db
    .prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(name.trim(), email, passwordHash, role);

  if (permissions) setPermissions(result.lastInsertRowid, permissions);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  logActivity({ userName: req.user.name, action: 'created', entityType: 'user', entityId: user.id, entityLabel: `${user.name} (${role})` });
  res.status(201).json({ user: publicUser(user), permissions: getPermissions(user.id) });
});

router.put('/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'User not found' });

  const { name, email: emailInput, role, active, permissions } = req.body || {};
  if (!name || !emailInput) return res.status(400).json({ error: 'name and email are required' });
  const email = String(emailInput).trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Invalid email address' });

  const nextRole = ROLES.includes(role) ? role : existing.role;
  if (!ROLES.includes(nextRole)) return res.status(400).json({ error: `role must be one of: ${ROLES.join(', ')}` });
  const nextActive = active === false ? 0 : 1;

  const emailTaken = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, existing.id);
  if (emailTaken) return res.status(409).json({ error: 'An account with this email already exists' });

  const wasActiveAdmin = existing.role === 'admin' && existing.active === 1;
  const willBeActiveAdmin = nextRole === 'admin' && nextActive === 1;
  if (wasActiveAdmin && !willBeActiveAdmin && activeAdminCount(existing.id) === 0) {
    return res.status(409).json({ error: 'Cannot remove the last active admin — promote another user to admin first' });
  }

  db.prepare(
    `UPDATE users SET name = ?, email = ?, role = ?, active = ? WHERE id = ?`,
  ).run(name.trim(), email, nextRole, nextActive, existing.id);

  if (permissions) setPermissions(existing.id, permissions);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(existing.id);
  logActivity({ userName: req.user.name, action: 'updated', entityType: 'user', entityId: user.id, entityLabel: user.name });
  res.json({ user: publicUser(user), permissions: getPermissions(user.id) });
});

router.post('/:id/reset-password', manage, async (req, res) => {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'User not found' });

  const { password } = req.body || {};
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  db.prepare(
    `UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?`,
  ).run(passwordHash, existing.id);

  logActivity({ userName: req.user.name, action: 'reset password for', entityType: 'user', entityId: existing.id, entityLabel: existing.name });
  res.status(204).end();
});

router.delete('/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'User not found' });

  if (existing.id === req.user.id) {
    return res.status(400).json({ error: 'You cannot delete your own account' });
  }
  if (existing.role === 'admin' && existing.active === 1 && activeAdminCount(existing.id) === 0) {
    return res.status(409).json({ error: 'Cannot delete the last active admin — promote another user to admin first' });
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(existing.id);
  logActivity({ userName: req.user.name, action: 'deleted', entityType: 'user', entityId: existing.id, entityLabel: existing.name });
  res.status(204).end();
});

router.get('/meta/modules', view, (req, res) => {
  res.json({ modules: MODULES });
});

module.exports = router;
