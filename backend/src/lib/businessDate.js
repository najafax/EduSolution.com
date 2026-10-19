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

module.exports = { todayStr };
