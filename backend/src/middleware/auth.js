const jwt = require('jsonwebtoken');
const db = require('../db');
const { hasPermission } = require('../lib/permissions');

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

  // Re-fetch the live row rather than trusting the JWT for anything beyond
  // "this token was validly issued for this user id" — role changes,
  // deactivation, and profile edits all need to take effect on the very
  // next request, not after the token's 7-day expiry.
  const user = db
    .prepare('SELECT id, name, email, role, active, notify_overdue FROM users WHERE id = ?')
    .get(payload.id);
  if (!user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  if (!user.active) {
    return res.status(401).json({ error: 'This account has been deactivated' });
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

module.exports = { requireAuth, requirePermission };
