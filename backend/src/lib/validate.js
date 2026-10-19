// Shared input checks for the money-bearing routes: real calendar dates and
// amounts held to whole cents. A malformed date (e.g. "tomorrow") used to be
// accepted and then silently fell out of every BETWEEN-based report.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// True only for a real calendar date written YYYY-MM-DD (rejects 2026-02-31).
function isValidDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// Returns an error string, or null when `value` is a valid date.
function dateError(value, label) {
  return isValidDate(value) ? null : `${label} must be a valid date (YYYY-MM-DD)`;
}

module.exports = { DATE_RE, round2, isValidDate, dateError };
