const { Router } = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { MODULES, isAdminRole, getPermissions, setPermissions } = require('../lib/permissions');
const { logActivity } = require('../lib/activity');

const router = Router();
router.use(requireAuth);
const view = requirePermission('users', 'view');
const manage = requirePermission('users', 'manage');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = ['admin', 'staff', 'super_admin'];
const MIN_PASSWORD_LENGTH = 8;

// A regular admin keeps this route's own `manage` gate (full CRUD on staff
// accounts, unchanged) but is blocked from touching admin/super_admin
// *accounts* themselves — creating one, editing one's fields/permissions,
// resetting one's password, deleting one, or promoting anyone (including
// themselves) into either tier. Only an existing super_admin can do any of
// that; a plain 'admin' passing this check would just 403 below. This is
// deliberately independent of the `users` module grant system entirely
// (like requireAdmin elsewhere) — no staff permission can ever unlock it.
function assertSuperAdminForAdminTier(req, res, ...roles) {
  if (roles.some(isAdminRole) && req.user.role !== 'super_admin') {
    res.status(403).json({ error: 'Only a super admin can manage admin accounts' });
    return false;
  }
  return true;
}

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

// Counts both admin-tier roles together — a business with zero plain
// 'admin' accounts but at least one active 'super_admin' isn't actually
// locked out of full business-data access, since super_admin already
// implies everything admin does (see lib/permissions.js's isAdminRole).
function activeAdminCount(excludingUserId) {
  const row = db
    .prepare("SELECT COUNT(*) AS c FROM users WHERE role IN ('admin', 'super_admin') AND active = 1 AND id != ?")
    .get(excludingUserId ?? -1);
  return row.c;
}

// Separate from activeAdminCount above: this specifically guards against
// ever having zero active super_admins, which — unlike running out of
// plain admins — really would be unrecoverable in-app (nobody left who can
// create/edit/delete another admin or super_admin account, or promote
// anyone into either tier; the only way back would be the CLI bootstrap
// path in scripts/create-user.js).
function activeSuperAdminCount(excludingUserId) {
  const row = db
    .prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'super_admin' AND active = 1 AND id != ?")
    .get(excludingUserId ?? -1);
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
  if (!assertSuperAdminForAdminTier(req, res, role)) return;

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
  if (!assertSuperAdminForAdminTier(req, res, existing.role, nextRole)) return;

  const emailTaken = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, existing.id);
  if (emailTaken) return res.status(409).json({ error: 'An account with this email already exists' });

  const wasActiveAdmin = isAdminRole(existing.role) && existing.active === 1;
  const willBeActiveAdmin = isAdminRole(nextRole) && nextActive === 1;
  if (wasActiveAdmin && !willBeActiveAdmin && activeAdminCount(existing.id) === 0) {
    return res.status(409).json({ error: 'Cannot remove the last active admin — promote another user to admin first' });
  }

  // Separate from the admin-tier-wide guard above: even if another admin
  // remains, demoting/deactivating the last super_admin would still strand
  // the app with nobody who can manage admin accounts going forward.
  const wasActiveSuperAdmin = existing.role === 'super_admin' && existing.active === 1;
  const willBeActiveSuperAdmin = nextRole === 'super_admin' && nextActive === 1;
  if (wasActiveSuperAdmin && !willBeActiveSuperAdmin && activeSuperAdminCount(existing.id) === 0) {
    return res.status(409).json({ error: 'Cannot remove the last active super admin — promote another user to super admin first' });
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
  if (!assertSuperAdminForAdminTier(req, res, existing.role)) return;

  const { password } = req.body || {};
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  db.prepare(
    `UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL, password_changed_at = datetime('now') WHERE id = ?`,
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
  if (!assertSuperAdminForAdminTier(req, res, existing.role)) return;
  if (isAdminRole(existing.role) && existing.active === 1 && activeAdminCount(existing.id) === 0) {
    return res.status(409).json({ error: 'Cannot delete the last active admin — promote another user to admin first' });
  }
  if (existing.role === 'super_admin' && existing.active === 1 && activeSuperAdminCount(existing.id) === 0) {
    return res.status(409).json({ error: 'Cannot delete the last active super admin — promote another user to super admin first' });
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(existing.id);
  logActivity({ userName: req.user.name, action: 'deleted', entityType: 'user', entityId: existing.id, entityLabel: existing.name });
  res.status(204).end();
});

router.get('/meta/modules', view, (req, res) => {
  res.json({ modules: MODULES });
});

module.exports = router;
