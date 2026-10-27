// A client's `email` column can hold several addresses, separated by commas
// (or semicolons / new lines). Stored as one normalised "a@x.com, b@y.com"
// string so nothing else in the schema changes; every send goes to all of them.
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

function splitEmails(value) {
  return String(value || '')
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// -> { ok: true, value: 'a@x.com, b@y.com', list: [...] } or { ok: false, message }
function normalizeEmails(value) {
  const list = [];
  const seen = new Set();
  for (const e of splitEmails(value)) {
    if (!EMAIL_RE.test(e)) return { ok: false, message: `"${e}" is not a valid email address` };
    if (!seen.has(e.toLowerCase())) {
      seen.add(e.toLowerCase());
      list.push(e);
    }
  }
  if (list.length === 0) return { ok: false, message: 'at least one email is required' };
  return { ok: true, value: list.join(', '), list };
}

// The first address: used wherever one login identity is needed (portal invite).
const primaryEmail = (value) => splitEmails(value)[0] || '';

module.exports = { splitEmails, normalizeEmails, primaryEmail, EMAIL_RE };
