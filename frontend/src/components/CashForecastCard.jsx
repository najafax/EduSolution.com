import { money } from '../lib/money';

// Expected cash over the next 30/60/90 days (GET /api/dashboard/overview →
// cashForecast, built by backend lib/cashForecast.js). A projection, so the
// card says what is and isn't in it.
const IN_ROWS = [
  ['invoicesIn', 'Unpaid invoices due'],
  ['recurringIn', 'Recurring invoices'],
  ['licensesIn', 'License renewals'],
];
const OUT_ROWS = [
  ['supplierOut', 'Supplier costs owed'],
  ['supplierEstOut', 'Supplier costs (estimated)'],
  ['expensesOut', 'Typical expenses'],
];

export default function CashForecastCard({ forecast, symbol }) {
  if (!forecast) return null;
  const { buckets, overdue, openingBalance, lowestBalance, supplier } = forecast;
  const goesNegative = lowestBalance < 0;

  return (
    <section className="mt-6 rounded-[28px] bg-white p-6 shadow-sm dark:bg-slate-900">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-base font-extrabold text-slate-900 dark:text-white">Cash forecast</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">Starting from {money(symbol, openingBalance)} in the bank</p>
      </div>

      {goesNegative && (
        <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          On these numbers the balance dips to {money(symbol, lowestBalance)}.
        </p>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {buckets.map((b) => (
          <div key={b.days} className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800/60">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Next {b.days} days</p>
            <p
              className={`mt-1 font-display text-2xl font-extrabold tabular-nums ${
                b.projectedBalance < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-white'
              }`}
            >
              {money(symbol, b.projectedBalance)}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">projected balance</p>
            <dl className="mt-3 space-y-1 text-sm">
              {IN_ROWS.filter(([k]) => b[k] > 0).map(([k, label]) => (
                <div key={k} className="flex justify-between gap-2">
                  <dt className="text-slate-600 dark:text-slate-300">{label}</dt>
                  <dd className="tabular-nums text-emerald-700 dark:text-emerald-400">+{money(symbol, b[k])}</dd>
                </div>
              ))}
              {OUT_ROWS.filter(([k]) => b[k] > 0).map(([k, label]) => (
                <div key={k} className="flex justify-between gap-2">
                  <dt className="text-slate-600 dark:text-slate-300">{label}</dt>
                  <dd className="tabular-nums text-red-600 dark:text-red-400">−{money(symbol, b[k])}</dd>
                </div>
              ))}
              {b.cashIn === 0 && b.cashOut === 0 && <p className="text-slate-500 dark:text-slate-400">Nothing expected.</p>}
            </dl>
          </div>
        ))}
      </div>

      <ul className="mt-4 space-y-1 text-xs text-slate-500 dark:text-slate-400">
        {overdue.count > 0 && (
          <li>
            Not counted: {money(symbol, overdue.amount)} from {overdue.count} overdue invoice{overdue.count === 1 ? '' : 's'}.
          </li>
        )}
        {supplier.toPayUsd > 0 && (
          <li>
            Supplier costs are ${supplier.toPayUsd.toFixed(2)} still to buy
            {supplier.rate ? ` at ${supplier.rate}` : ' (no USD purchase yet to price it, so not counted)'}, shown in the first 30 days.
          </li>
        )}
        {supplier.estimateSharePct > 0 && (
          <li>
            Estimated supplier costs assume {supplier.estimateSharePct}% of recurring invoices and license renewals goes to suppliers, based on the
            last 12 months.
          </li>
        )}
        <li>Typical expenses are the average of the last 90 days. Owner draws and payouts are not forecast.</li>
      </ul>
    </section>
  );
}
