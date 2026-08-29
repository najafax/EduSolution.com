const jwt = require('jsonwebtoken');
const db = require('../db');
const { hasPermission, isAdminRole } = require('../lib/permissions');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  // Staff and client-portal tokens are signed with the same JWT_SECRET, so
  // verifying the signature alone isn't enough to prove "this is a staff
  // token" — a client token's `id` is a client_portal_accounts row id,
  // which could coincidentally match a real staff user's id in `users`.
  // Reject anything carrying the client-portal discriminator (see
  // middleware/clientAuth.js's own reverse check) before it ever reaches
  // the users lookup below.
  if (payload.type === 'client') {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // Re-fetch the live row rather than trusting the JWT for anything beyond
  // "this token was validly issued for this user id" — role changes,
  // deactivation, and profile edits all need to take effect on the very
  // next request, not after the token's 7-day expiry.
  const user = db
    .prepare('SELECT id, name, email, role, active, notify_overdue, password_changed_at FROM users WHERE id = ?')
    .get(payload.id);
  if (!user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  if (!user.active) {
    return res.status(401).json({ error: 'This account has been deactivated' });
  }
  // Tokens issued before the most recent password change/reset are stale —
  // reject them so a token stolen pre-reset can't keep working for the rest
  // of its 7-day lifetime. Compare as same-format UTC strings (not via
  // `new Date(sqliteString)`, which V8 parses as local time for the
  // space-separated `datetime('now')` format and would drift by the
  // server's UTC offset).
  if (payload.iat) {
    const iatStr = new Date(payload.iat * 1000).toISOString().slice(0, 19).replace('T', ' ');
    if (iatStr < user.password_changed_at) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  }

  req.user = user;
  next();
}

// Usage: router.get('/', requirePermission('clients', 'view'), handler).
// Must run after requireAuth (needs req.user). Admins always pass; staff
// are checked against their granted permissions, default-deny.
function requirePermission(module, level = 'view') {
  return (req, res, next) => {
    if (!hasPermission(req.user, module, level)) {
      const action = level === 'manage' ? 'manage' : 'view';
      return res.status(403).json({ error: `You do not have permission to ${action} ${module.replace(/_/g, ' ')}` });
    }
    next();
  };
}

// Stricter than requirePermission: bypasses the per-module grant system
// entirely and checks the account's actual role. Reserved for actions no
// staff grant should ever unlock — e.g. bulk-deleting all business data —
// unlike every other gated route in this app, which a staff member can be
// granted access to via user_permissions. Passes for either admin tier
// (isAdminRole) since super_admin is a strict superset of admin. Must run
// after requireAuth.
function requireAdmin(req, res, next) {
  if (!isAdminRole(req.user.role)) {
    return res.status(403).json({ error: 'Only an admin can do this' });
  }
  next();
}

module.exports = { requireAuth, requirePermission, requireAdmin };
