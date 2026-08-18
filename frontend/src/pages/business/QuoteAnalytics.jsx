import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import KpiCard from '../../components/KpiCard';
import MobileListAccordion from '../../components/MobileListAccordion';
import YearlyBarChart from '../../components/YearlyBarChart';
import BreakdownBars from '../../components/BreakdownBars';
import { QuoteIcon, TrendUpIcon, AlertTriangleIcon, CheckCircleIcon } from '../../components/icons';
import { money } from '../../lib/money';

const CREATED_COLOR = '#0e7c86';
const ACCEPTED_COLOR = '#059669';
const YEARLY_SERIES = [
  { key: 'created', label: 'Quotes created', color: CREATED_COLOR },
  { key: 'accepted', label: 'Accepted', color: ACCEPTED_COLOR },
];

// Same status colors as pages/business/Quotes.jsx's own ACCENT map / StatusBadge.
const STATUS_ROWS = [
  { key: 'draft', label: 'Draft', color: '#94a3b8' },
  { key: 'sent', label: 'Sent', color: '#0e7c86' },
  { key: 'accepted', label: 'Accepted', color: '#059669' },
  { key: 'declined', label: 'Declined', color: '#dc2626' },
  { key: 'expired', label: 'Expired', color: '#d97706' },
];

export default function QuoteAnalytics() {
  const { token, can } = useAuth();
  const canView = can('quotes', 'view');
  const [data, setData] = useState(null);
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!canView) return;
    api.quotes
      .analytics(token)
      .then(setData)
      .catch((err) => setError(err.message));
    api.settings.get(token).then(({ settings }) => setSettings(settings)).catch(() => {});
  }, [token, canView]);

  if (!canView) {
    return <div className="px-4 py-10 text-sm text-slate-500 dark:text-slate-400 sm:px-6 lg:px-8">You are not authorized to view this page.</div>;
  }

  const symbol = settings?.currency_symbol || '$';
  const currentYear = new Date().getFullYear();
  const thisYear = data?.byYear.find((y) => y.year === currentYear);

  if (error && !data) return <div className="px-4 py-10 text-sm text-red-600 dark:text-red-400 sm:px-6 lg:px-8">{error}</div>;
  if (!data) return <div className="px-4 py-10 text-sm text-slate-500 dark:text-slate-400 sm:px-6 lg:px-8">Loading…</div>;

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Quote analytics</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Quoting activity and win rate by year, going back to your earliest quote.</p>
        </div>
        <Link
          to="/quotes"
          className="min-h-11 flex items-center rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Back to quotes
        </Link>
      </div>

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard icon={<QuoteIcon />} label="Total quotes" value={data.totals.totalQuotes} tone="neutral" />
        <KpiCard icon={<TrendUpIcon />} label="Created this year" value={thisYear?.created ?? 0} tone="positive" />
        <KpiCard icon={<QuoteIcon />} label="Quoted this year" value={money(symbol, thisYear?.amountQuoted ?? 0)} tone="neutral" />
        <KpiCard icon={<CheckCircleIcon />} label="Accepted this year" value={thisYear?.accepted ?? 0} tone="positive" />
        <KpiCard icon={<AlertTriangleIcon />} label="Declined this year" value={thisYear?.declined ?? 0} tone="negative" />
        <KpiCard
          icon={<CheckCircleIcon />}
          label="Win rate (all-time)"
          value={data.totals.winRate === null ? '—' : `${data.totals.winRate.toFixed(0)}%`}
          sub={data.totals.winRate === null ? 'No decisions yet' : `${data.totals.totalAccepted} of ${data.totals.totalAccepted + data.totals.totalDeclined} decided`}
          tone="neutral"
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2 dark:border-slate-700 dark:bg-slate-900">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Quotes created &amp; accepted by year</h2>
          <div className="mt-4">
            <YearlyBarChart
              data={data.byYear}
              series={YEARLY_SERIES}
              emptyMessage="No quote activity yet."
              ariaLabel="Quotes created and accepted per year"
            />
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Status breakdown</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Current quotes, by status.</p>
          <div className="mt-4">
            <BreakdownBars
              emptyMessage="No quotes yet."
              rows={STATUS_ROWS.map((r) => ({ ...r, value: data.byStatus[r.key] || 0 }))}
            />
          </div>
          <dl className="mt-5 space-y-1.5 border-t border-slate-100 pt-4 text-xs dark:border-slate-800">
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Total quoted (all-time)</dt>
              <dd className="font-medium text-slate-900 dark:text-white">{money(symbol, data.totals.totalQuoted)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Accepted (all-time)</dt>
              <dd className="font-medium text-slate-900 dark:text-white">{data.totals.totalAccepted}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Declined (all-time)</dt>
              <dd className="font-medium text-slate-900 dark:text-white">{data.totals.totalDeclined}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Converted to invoice (all-time)</dt>
              <dd className="font-medium text-slate-900 dark:text-white">{data.totals.totalConverted}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Year by year</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            "Accepted"/"Declined" are counted by when the client responded via the public quote link, or by the last edit date
            if a status was instead set manually — there's no separate "decision date" field to fall back on for that case.
          </p>
        </div>
        <div className="hidden overflow-x-auto sm:block">
          <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
            <thead>
              <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                <th className="px-5 py-3">Year</th>
                <th className="px-4 py-3 text-right">Created</th>
                <th className="px-4 py-3 text-right">Amount quoted</th>
                <th className="px-4 py-3 text-right">Accepted</th>
                <th className="px-4 py-3 text-right">Declined</th>
                <th className="px-5 py-3 text-right">Converted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.byYear.map((y) => (
                <tr key={y.year}>
                  <td className="px-5 py-3 font-medium text-slate-900 dark:text-white">{y.year}</td>
                  <td className="px-4 py-3 text-right dark:text-white">{y.created}</td>
                  <td className="px-4 py-3 text-right dark:text-white">{money(symbol, y.amountQuoted)}</td>
                  <td className="px-4 py-3 text-right dark:text-white">{y.accepted}</td>
                  <td className="px-4 py-3 text-right dark:text-white">{y.declined}</td>
                  <td className="px-5 py-3 text-right dark:text-white">{y.converted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-2.5 p-4 sm:hidden">
          {data.byYear.map((y) => (
            <MobileListAccordion
              key={y.year}
              name="quote-analytics-years"
              summary={
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-slate-900 dark:text-white">{y.year}</span>
                  <span className="text-slate-500 dark:text-slate-400">
                    {y.created} created · {y.accepted} accepted
                  </span>
                </div>
              }
            >
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Amount quoted</dt>
                <dd className="text-slate-900 dark:text-white">{money(symbol, y.amountQuoted)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Declined</dt>
                <dd className="text-slate-900 dark:text-white">{y.declined}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Converted</dt>
                <dd className="text-slate-900 dark:text-white">{y.converted}</dd>
              </div>
            </MobileListAccordion>
          ))}
        </div>
      </div>

      {data.topClients.length > 0 && (
        <div className="mt-6 rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Top clients by quoted amount</h2>
          </div>
          <div className="hidden overflow-x-auto sm:block">
            <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
              <thead>
                <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                  <th className="px-5 py-3">Client</th>
                  <th className="px-4 py-3 text-right">Quotes</th>
                  <th className="px-5 py-3 text-right">Total quoted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.topClients.map((c) => (
                  <tr key={c.id}>
                    <td className="px-5 py-3 dark:text-white">
                      <Link to="/clients" className="text-lagoon-600 hover:text-lagoon-500">
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right dark:text-white">{c.quote_count}</td>
                    <td className="px-5 py-3 text-right dark:text-white">{money(symbol, c.total_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-2.5 p-4 sm:hidden">
            {data.topClients.map((c) => (
              <MobileListAccordion
                key={c.id}
                name="quote-analytics-clients"
                summary={
                  <div className="flex items-center justify-between gap-3">
                    <Link to="/clients" className="text-lagoon-600 hover:text-lagoon-500" onClick={(e) => e.stopPropagation()}>
                      {c.name}
                    </Link>
                    <span className="text-slate-500 dark:text-slate-400">{c.quote_count} quotes</span>
                  </div>
                }
              >
                <div className="flex justify-between">
                  <dt className="text-slate-500 dark:text-slate-400">Total quoted</dt>
                  <dd className="text-slate-900 dark:text-white">{money(symbol, c.total_amount)}</dd>
                </div>
              </MobileListAccordion>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
