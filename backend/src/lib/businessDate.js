// "Today" as a business date (YYYY-MM-DD) in the business's own timezone.
//
// `new Date().toISOString().slice(0, 10)` is the UTC date, which for a
// Maldives (UTC+5) business is still *yesterday* between 00:00 and 05:00
// local — a payment recorded at 02:00 was dated the previous day, which
// skews overdue checks, month-end reports and the bank balance cut-off.
// BUSINESS_TIMEZONE overrides the default (an IANA name, e.g. Asia/Dubai).
const TZ = process.env.BUSINESS_TIMEZONE || 'Indian/Maldives';

function todayStr(now = new Date()) {
  try {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

// Calendar helpers anchored to the business date, never the server clock.
const businessYear = (now = new Date()) => Number(todayStr(now).slice(0, 4));

// Shifts a YYYY-MM-DD date by whole days (pure calendar arithmetic).
function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const yesterdayStr = (now = new Date()) => addDays(todayStr(now), -1);

// The last `count` calendar months including the current one, oldest first
// ('YYYY-MM').
function recentMonthKeys(count, now = new Date()) {
  const [y, m] = todayStr(now).split('-').map(Number);
  const keys = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
}

// First and last day of the month before the business month containing `now`.
function previousMonthRange(now = new Date()) {
  const [y, m] = todayStr(now).split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 2, 1));
  const last = new Date(Date.UTC(y, m - 1, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10), label: first };
}

module.exports = { todayStr, businessYear, addDays, yesterdayStr, recentMonthKeys, previousMonthRange };
