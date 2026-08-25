// Today's date as YYYY-MM-DD in the browser's local timezone. Deliberately
// NOT `new Date().toISOString().slice(0, 10)` — toISOString() always
// converts to UTC, so for any timezone ahead of UTC (e.g. the Maldives,
// UTC+5, this app's primary market) that returns *yesterday's* date for
// several hours after local midnight, silently backdating anything a user
// creates in the early morning.
export function todayStr() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Same local-timezone fix, `days` in the future — used for default
// due/expiry dates.
export function todayPlus(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// The 1st of the current local-calendar month — the default "from" date
// for Reports.jsx's date-range picker (paired with todayStr() as "to").
export function startOfMonthStr() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
}

// A short relative-time string ("just now", "5 minutes ago", "3 days ago")
// for a SQLite `datetime('now')` timestamp (a space-separated
// "YYYY-MM-DD HH:MM:SS" UTC string, not ISO 8601) — used by
// QuoteDetail.jsx/InvoiceDetail.jsx's "Viewed by client …" line
// (client_viewed_at). `dateStr.replace(' ', 'T') + 'Z'` turns that into
// something `Date` parses as UTC rather than as local time, which is what
// it would otherwise assume for a string with no timezone marker at all —
// the same UTC-vs-local pitfall todayStr()'s own comment warns about, just
// in the opposite direction (this needs to *force* UTC, not avoid it).
// Caps out at "X months ago" rather than continuing into years, since a
// document viewed that long ago has no real need for finer-grained aging.
export function timeAgo(dateStr) {
  if (!dateStr) return '';
  const then = new Date(dateStr.replace(' ', 'T') + 'Z');
  const seconds = Math.max(0, Math.round((Date.now() - then.getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.round(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}
