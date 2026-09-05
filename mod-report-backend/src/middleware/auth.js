const jwt = require('jsonwebtoken');
const db = require('../db');

// Single-tier auth — this app has no admin/staff role split (see db's own
// note on why), so the only question requireAuth answers is "is this a
// valid, still-active login," the same shape the main EduSolution app's
// requireAuth uses for that part, minus its permission/session-revocation
// machinery this smaller app has no equivalent tables for.
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

  const user = db.prepare('SELECT id, name, email, active, password_changed_at FROM users WHERE id = ?').get(payload.id);
  if (!user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  if (!user.active) {
    return res.status(401).json({ error: 'This account has been deactivated' });
  }
  // Same "tokens minted before the most recent password change are stale"
  // check the main app's requireAuth uses, and for the same reason (a
  // stolen token shouldn't keep working for its full lifetime after a
  // reset) — see that file's own comment for the UTC-string-comparison
  // rationale this mirrors exactly.
  if (payload.iat) {
    const iatStr = new Date(payload.iat * 1000).toISOString().slice(0, 19).replace('T', ' ');
    if (iatStr < user.password_changed_at) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  }

  req.user = user;
  next();
}

module.exports = { requireAuth };
