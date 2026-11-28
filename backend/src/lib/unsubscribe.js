const crypto = require('crypto');

// Stateless unsubscribe links for shop sale emails: the token is an HMAC of the
// client id, so there is nothing to store and a link can't be guessed or reused
// for another client. (JWT_SECRET is the server's one signing secret.)
function secret() {
  return process.env.JWT_SECRET || 'dev-secret';
}

function tokenFor(clientId) {
  return crypto.createHmac('sha256', secret()).update(`unsub:${Number(clientId)}`).digest('hex').slice(0, 32);
}

function verify(clientId, token) {
  const id = Number(clientId);
  if (!Number.isInteger(id) || id <= 0 || typeof token !== 'string' || token.length !== 32) return false;
  const a = Buffer.from(tokenFor(id));
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function apiBase() {
  if (process.env.PUBLIC_API_URL) return process.env.PUBLIC_API_URL.replace(/\/+$/, '');
  return (process.env.CLIENT_ORIGIN || '').replace(/\/+$/, '').replace('://www.', '://api.');
}

// The page a person lands on when they click the link in the email.
function pageUrl(clientId) {
  const origin = (process.env.CLIENT_ORIGIN || '').replace(/\/+$/, '');
  return `${origin}/unsubscribe?c=${Number(clientId)}&t=${tokenFor(clientId)}`;
}

// The address mail apps call for one-click unsubscribe (List-Unsubscribe header).
function oneClickUrl(clientId) {
  return `${apiBase()}/api/public/shop/unsubscribe?c=${Number(clientId)}&t=${tokenFor(clientId)}`;
}

module.exports = { tokenFor, verify, pageUrl, oneClickUrl };
