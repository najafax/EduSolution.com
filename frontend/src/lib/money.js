// Shared currency formatter for Dashboard/Financials KPIs and payment
// lists: full precision (two decimals) below one million, a compact
// "1.3m"/"2b"-style suffix at or above it — large totals stay scannable
// at a glance instead of running to 7+ digits. Negative values (e.g. a
// net loss) keep the sign in front of the currency symbol, matching how
// these pages already displayed negative amounts.
export function money(symbol, value) {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${sign}${symbol}${compact(abs / 1_000_000_000)}b`;
  if (abs >= 1_000_000) return `${sign}${symbol}${compact(abs / 1_000_000)}m`;
  return `${sign}${symbol}${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// One decimal place, trimmed to a bare integer when it'd otherwise read
// "2.0" — "$2m" reads cleaner than "$2.0m".
function compact(value) {
  const rounded = value.toFixed(1);
  return rounded.endsWith('.0') ? rounded.slice(0, -2) : rounded;
}
