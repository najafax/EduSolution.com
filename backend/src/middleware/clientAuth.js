const jwt = require('jsonwebtoken');
const db = require('../db');

// The client-portal counterpart to middleware/auth.js's requireAuth — same
// shape (re-fetch the live row every request, reject on inactive or a token
// issued before the last password change), but keyed to
// client_portal_accounts instead of users, and carrying a `type: 'client'`
// claim so a client token can never be replayed against a staff-only route
// (or vice versa) even though both are signed with the same JWT_SECRET.
function requireClientAuth(req, res, next) {
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
  if (payload.type !== 'client') {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const account = db
    .prepare(
      `SELECT client_portal_accounts.*, clients.name AS client_name
       FROM client_portal_accounts
       JOIN clients ON clients.id = client_portal_accounts.client_id
       WHERE client_portal_accounts.id = ?`,
    )
    .get(payload.id);
  if (!account) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  if (!account.active) {
    return res.status(401).json({ error: 'This account has been deactivated' });
  }
  if (payload.iat) {
    const iatStr = new Date(payload.iat * 1000).toISOString().slice(0, 19).replace('T', ' ');
    if (iatStr < account.password_changed_at) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  }

  req.clientAccount = account;
  next();
}

module.exports = { requireClientAuth };
