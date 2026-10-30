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

// Adds whole months/years to a YYYY-MM-DD date in pure UTC calendar math,
// clamping to the target month's last day (Jan 31 + 1 month = Feb 28/29).
// Independent of the server's timezone.
function addMonths(dateStr, months) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

const addYears = (dateStr, years) => addMonths(dateStr, years * 12);

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

// Books start here: period figures (net profit, totals, reports defaults) never
// count anything dated earlier.
const BOOKS_START = '2025-01-01';

module.exports = { BOOKS_START, todayStr, businessYear, addDays, addMonths, addYears, yesterdayStr, recentMonthKeys, previousMonthRange };
