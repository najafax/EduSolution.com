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
