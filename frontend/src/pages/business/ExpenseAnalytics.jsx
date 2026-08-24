import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import KpiCard from '../../components/KpiCard';
import MobileListAccordion from '../../components/MobileListAccordion';
import YearlyBarChart from '../../components/YearlyBarChart';
import { ExpenseIcon, TrendUpIcon, RefreshIcon, BankIcon, ReportIcon } from '../../components/icons';

const TOTAL_COLOR = '#0e7c86';
const EXCHANGE_COLOR = '#f59e0b';
const YEARLY_SERIES = [
  { key: 'total', label: 'Total expenses', color: TOTAL_COLOR },
  { key: 'currencyExchangeSpent', label: 'Currency exchange', color: EXCHANGE_COLOR },
];

// One color per category, cycled if the fixed CATEGORIES list (see
// routes/expenses.js) ever grows past this — same reserved-palette
// approach KpiCard's `tone`s use, just per-category instead of per-metric.
const CATEGORY_COLORS = ['#0e7c86', '#059669', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#475569', '#ea580c'];

export default function ExpenseAnalytics() {
  const { token, can } = useAuth();
  const canView = can('expenses', 'view');
  const [data, setData] = useState(null);
  const [settings, setSettings] = useState(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!canView) return;
    api.expenses
      .analytics(token)
      .then(setData)
      .catch((err) => setError(err.message));
    // .finally flips settingsLoaded whether the fetch succeeds or fails —
    // the loading gate below waits on this too, so money figures never
    // flash '$' before the real currency symbol arrives (see Dashboard.jsx's
    // own note on this race for the full story).
    api.settings
      .get(token)
      .then(({ settings }) => setSettings(settings))
      .catch(() => {})
      .finally(() => setSettingsLoaded(true));
  }, [token, canView]);

  if (!canView) {
    return <div className="px-4 py-10 text-sm text-slate-500 dark:text-slate-400 sm:px-6 lg:px-8">You are not authorized to view this page.</div>;
  }

  const symbol = settings?.currency_symbol || '$';
  const currentYear = new Date().getFullYear();
  const thisYear = data?.byYear.find((y) => y.year === currentYear);

  if (error && !data) return <div className="px-4 py-10 text-sm text-red-600 dark:text-red-400 sm:px-6 lg:px-8">{error}</div>;
  if (!data || !settingsLoaded) return <div className="px-4 py-10 text-sm text-slate-500 dark:text-slate-400 sm:px-6 lg:px-8">Loading…</div>;

  const categoryRows = Object.entries(data.byCategory)
    .filter(([, amount]) => amount > 0)
    .sort(([, a], [, b]) => b - a)
    .map(([category, amount], i) => ({ category, amount, color: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }));
  const maxCategoryAmount = Math.max(1, ...categoryRows.map((r) => r.amount));

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Expense analytics</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Spending by category and year, plus a full breakdown of every currency exchange.
          </p>
        </div>
        <Link
          to="/expenses"
          className="min-h-11 flex items-center rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Back to expenses
        </Link>
      </div>

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KpiCard icon={<ExpenseIcon />} label="Total expenses" value={`${symbol}${data.totals.totalAmount.toFixed(2)}`} tone="neutral" />
        <KpiCard icon={<TrendUpIcon />} label="This year" value={`${symbol}${(thisYear?.total ?? 0).toFixed(2)}`} tone="neutral" />
        <KpiCard
          icon={<BankIcon />}
          label="USD received (all-time)"
          value={`$${data.totals.totalCurrencyExchangeUsd.toFixed(2)}`}
          sub={`from ${symbol}${data.totals.totalCurrencyExchangeSpent.toFixed(2)} exchanged`}
          tone="positive"
        />
        <KpiCard
          icon={<RefreshIcon />}
          label="Avg. exchange rate"
          value={data.totals.averageExchangeRate !== null ? data.totals.averageExchangeRate.toFixed(2) : '—'}
          sub={`${data.totals.exchangeTransactionCount} exchange${data.totals.exchangeTransactionCount === 1 ? '' : 's'}`}
          tone="neutral"
        />
        <KpiCard icon={<ReportIcon />} label="Records (all-time)" value={data.totals.totalCount} tone="neutral" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2 dark:border-slate-700 dark:bg-slate-900">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Total spend &amp; currency exchange by year</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Both figures in local currency — see the panel below for USD received.</p>
          <div className="mt-4">
            <YearlyBarChart data={data.byYear} series={YEARLY_SERIES} emptyMessage="No expenses yet." ariaLabel="Total expenses and currency exchange per year" />
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">By category</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">All-time totals.</p>
          <div className="mt-4">
            {categoryRows.length === 0 ? (
              <p className="flex h-24 items-center justify-center text-sm text-slate-400 dark:text-slate-500">No expenses yet.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {categoryRows.map((r) => (
                  <div key={r.category} className="flex items-center gap-3">
                    <span className="w-28 shrink-0 text-xs font-medium capitalize leading-tight text-slate-600 dark:text-slate-400">{r.category}</span>
                    <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div className="h-full rounded-full" style={{ width: `${(r.amount / maxCategoryAmount) * 100}%`, background: r.color }} />
                    </div>
                    <span className="w-20 shrink-0 text-right text-xs font-semibold text-slate-900 dark:text-white">
                      {symbol}
                      {r.amount.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Year by year</h2>
        </div>
        <div className="hidden overflow-x-auto sm:block">
          <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
            <thead>
              <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                <th className="px-5 py-3">Year</th>
                <th className="px-4 py-3 text-right">Records</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-right">Currency exchange</th>
                <th className="px-5 py-3 text-right">USD received</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.byYear.map((y) => (
                <tr key={y.year}>
                  <td className="px-5 py-3 font-medium text-slate-900 dark:text-white">{y.year}</td>
                  <td className="px-4 py-3 text-right dark:text-white">{y.count}</td>
                  <td className="px-4 py-3 text-right dark:text-white">
                    {symbol}
                    {y.total.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right dark:text-white">
                    {symbol}
                    {y.currencyExchangeSpent.toFixed(2)}
                  </td>
                  <td className="px-5 py-3 text-right dark:text-white">${y.currencyExchangeUsd.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-2.5 p-4 sm:hidden">
          {data.byYear.map((y) => (
            <MobileListAccordion
              key={y.year}
              name="expense-analytics-years"
              summary={
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-slate-900 dark:text-white">{y.year}</span>
                  <span className="text-slate-500 dark:text-slate-400">
                    {symbol}
                    {y.total.toFixed(2)}
                  </span>
                </div>
              }
            >
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Records</dt>
                <dd className="text-slate-900 dark:text-white">{y.count}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Currency exchange</dt>
                <dd className="text-slate-900 dark:text-white">
                  {symbol}
                  {y.currencyExchangeSpent.toFixed(2)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">USD received</dt>
                <dd className="text-slate-900 dark:text-white">${y.currencyExchangeUsd.toFixed(2)}</dd>
              </div>
            </MobileListAccordion>
          ))}
        </div>
      </div>

      {data.topPayees.length > 0 && (
        <div className="mt-6 rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Top payees</h2>
          </div>
          <div className="hidden overflow-x-auto sm:block">
            <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
              <thead>
                <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                  <th className="px-5 py-3">Payee</th>
                  <th className="px-4 py-3 text-right">Expenses</th>
                  <th className="px-5 py-3 text-right">Total paid</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.topPayees.map((p) => (
                  <tr key={p.payee}>
                    <td className="px-5 py-3 dark:text-white">{p.payee}</td>
                    <td className="px-4 py-3 text-right dark:text-white">{p.expense_count}</td>
                    <td className="px-5 py-3 text-right dark:text-white">
                      {symbol}
                      {p.total_amount.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-2.5 p-4 sm:hidden">
            {data.topPayees.map((p) => (
              <MobileListAccordion
                key={p.payee}
                name="expense-analytics-payees"
                summary={
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate font-medium text-slate-900 dark:text-white">{p.payee}</span>
                    <span className="text-slate-500 dark:text-slate-400">
                      {symbol}
                      {p.total_amount.toFixed(2)}
                    </span>
                  </div>
                }
              >
                <div className="flex justify-between">
                  <dt className="text-slate-500 dark:text-slate-400">Expenses</dt>
                  <dd className="text-slate-900 dark:text-white">{p.expense_count}</dd>
                </div>
              </MobileListAccordion>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Currency exchange transactions</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Every currency exchange expense, with its rate, USD received, payee account, and destination.</p>
        </div>
        {data.currencyExchangeTransactions.length === 0 ? (
          <p className="p-5 text-sm text-slate-500 dark:text-slate-400">No currency exchange expenses recorded yet.</p>
        ) : (
          <>
            <div className="hidden overflow-x-auto sm:block">
              <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                    <th className="px-5 py-3">Date</th>
                    <th className="px-4 py-3">Description</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3 text-right">Rate</th>
                    <th className="px-4 py-3 text-right">USD received</th>
                    <th className="px-4 py-3">Payee account</th>
                    <th className="px-5 py-3">USD destination</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data.currencyExchangeTransactions.map((t) => (
                    <tr key={t.id}>
                      <td className="whitespace-nowrap px-5 py-3 text-slate-600 dark:text-slate-400">{t.expense_date}</td>
                      <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{t.description}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right dark:text-white">
                        {symbol}
                        {t.amount.toFixed(2)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right dark:text-white">{t.exchange_rate ?? '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-medium dark:text-white">
                        {t.amount_usd !== null ? `$${t.amount_usd.toFixed(2)}` : '—'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-400">{t.payee_account_number || '—'}</td>
                      <td className="px-5 py-3 text-slate-600 dark:text-slate-400">{t.usd_destination || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-2.5 p-4 sm:hidden">
              {data.currencyExchangeTransactions.map((t) => (
                <MobileListAccordion
                  key={t.id}
                  name="expense-analytics-exchanges"
                  summary={
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-slate-900 dark:text-white">{t.description}</p>
                        <p className="text-slate-500 dark:text-slate-400">{t.expense_date}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-slate-900 dark:text-white">
                          {symbol}
                          {t.amount.toFixed(2)}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{t.amount_usd !== null ? `$${t.amount_usd.toFixed(2)}` : '—'}</p>
                      </div>
                    </div>
                  }
                >
                  <div className="flex justify-between">
                    <dt className="text-slate-500 dark:text-slate-400">Exchange rate</dt>
                    <dd className="text-slate-900 dark:text-white">{t.exchange_rate ?? '—'}</dd>
                  </div>
                  {t.payee_account_number && (
                    <div className="flex justify-between">
                      <dt className="text-slate-500 dark:text-slate-400">Payee account</dt>
                      <dd className="text-slate-900 dark:text-white">{t.payee_account_number}</dd>
                    </div>
                  )}
                  {t.usd_destination && (
                    <div className="flex justify-between">
                      <dt className="text-slate-500 dark:text-slate-400">USD destination</dt>
                      <dd className="text-slate-900 dark:text-white">{t.usd_destination}</dd>
                    </div>
                  )}
                </MobileListAccordion>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
