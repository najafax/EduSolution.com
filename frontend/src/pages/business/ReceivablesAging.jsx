import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import KpiCard from '../../components/KpiCard';
import PageToolbar from '../../components/PageToolbar';
import MobileListAccordion from '../../components/MobileListAccordion';
import EmptyState from '../../components/EmptyState';
import { ClockIcon, AlertTriangleIcon, DownloadIcon } from '../../components/icons';
import { todayStr } from '../../lib/date';

// Who owes what, and for how long. A point-in-time snapshot of sent invoices
// that still have a balance, bucketed by days past due date. Computed
// server-side (lib/receivablesAging.js); draft and void invoices are not
// receivables and are never included.
const BUCKET_STYLE = {
  current: { bar: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-400', tone: 'positive' },
  d1_30: { bar: 'bg-amber-400', text: 'text-amber-700 dark:text-amber-400', tone: 'warning' },
  d31_60: { bar: 'bg-orange-500', text: 'text-orange-700 dark:text-orange-400', tone: 'warning' },
  d61_90: { bar: 'bg-red-400', text: 'text-red-600 dark:text-red-400', tone: 'negative' },
  d90plus: { bar: 'bg-red-700', text: 'text-red-700 dark:text-red-400', tone: 'negative' },
};

function money(symbol, n) {
  return `${symbol}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function ReceivablesAging() {
  const { token, can } = useAuth();
  const canView = can('financials', 'view');
  const [asOf, setAsOf] = useState(todayStr());
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [symbol, setSymbol] = useState('$');
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    api.settings
      .getSummary(token)
      .then(({ settings }) => setSymbol(settings?.currency_symbol || '$'))
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!canView) return;
    setError('');
    api.reports
      .receivablesAging(asOf, token)
      .then(setData)
      .catch((err) => setError(err.message));
  }, [token, canView, asOf]);

  if (!canView) {
    return <div className="px-4 py-10 text-sm text-slate-500 dark:text-slate-400 sm:px-6 lg:px-8">You are not authorized to view this page.</div>;
  }
  if (error && !data) return <div className="px-4 py-10 text-sm text-red-600 dark:text-red-400 sm:px-6 lg:px-8">{error}</div>;
  if (!data) return <div className="px-4 py-10 text-sm text-slate-500 dark:text-slate-400 sm:px-6 lg:px-8">Loading…</div>;

  const buckets = data.buckets;
  const hasAny = data.clients.length > 0;

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8 xl:py-6">
      <PageToolbar
        title="Receivables aging"
        search={
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
            <span className="shrink-0">As of</span>
            <input
              type="date"
              value={asOf}
              max={todayStr()}
              onChange={(e) => e.target.value && setAsOf(e.target.value)}
              className="min-h-11 w-full rounded-md border border-slate-300 px-3 text-base dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            />
          </label>
        }
        actions={
          <button
            onClick={() => api.reports.receivablesAgingPdf(asOf, token).catch((e) => setError(e.message))}
            className="flex min-h-11 items-center gap-1.5 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <DownloadIcon width={16} height={16} />
            Download PDF
          </button>
        }
      />

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-4 rounded-3xl bg-white p-4 shadow-sm dark:border dark:border-slate-700 dark:bg-slate-900 sm:hidden">
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Total receivable</p>
        <p className="font-display text-2xl font-extrabold tabular-nums text-slate-900 dark:text-white">{money(symbol, data.total)}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">{data.invoiceCount} open invoice{data.invoiceCount === 1 ? '' : 's'}</p>
        <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
          {buckets.map((b) => (
            <li key={b.key} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                <span className={`h-2.5 w-2.5 rounded-full ${BUCKET_STYLE[b.key].bar}`} />
                {b.label}
                <span className="text-xs text-slate-400">{b.count}</span>
              </span>
              <span className={`tabular-nums ${b.amount > 0 ? BUCKET_STYLE[b.key].text : 'text-slate-400'}`}>{money(symbol, b.amount)}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4 hidden grid-cols-3 gap-3 sm:grid xl:grid-cols-6">
        <KpiCard
          icon={<ClockIcon />}
          label="Total receivable"
          value={money(symbol, data.total)}
          sub={`${data.invoiceCount} open invoice${data.invoiceCount === 1 ? '' : 's'}`}
          className="sm:col-span-3 xl:col-span-1"
        />
        {buckets.map((b) => (
          <KpiCard
            key={b.key}
            icon={<AlertTriangleIcon />}
            label={b.key === 'current' ? 'Current' : b.label}
            value={money(symbol, b.amount)}
            sub={b.key === 'current' ? 'Not yet due' : `${b.count} invoice${b.count === 1 ? '' : 's'}`}
            tone={b.amount > 0 ? BUCKET_STYLE[b.key].tone : 'neutral'}
          />
        ))}
      </div>

      {hasAny && (
        <div className="mt-4 rounded-3xl bg-white p-5 shadow-sm dark:border dark:border-slate-700 dark:bg-slate-900">
          <div className="flex h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            {buckets.map((b) =>
              b.amount > 0 ? (
                <div key={b.key} className={BUCKET_STYLE[b.key].bar} style={{ width: `${(b.amount / data.total) * 100}%` }} title={`${b.label}: ${money(symbol, b.amount)}`} />
              ) : null,
            )}
          </div>
          <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">
            {data.overdueTotal > 0
              ? `${money(symbol, data.overdueTotal)} is overdue (${Math.round((data.overdueTotal / data.total) * 100)}% of receivables), on average ${data.avgDaysOverdue} days past due.`
              : 'Nothing is overdue.'}
          </p>
        </div>
      )}

      <div className="mt-4 rounded-3xl bg-white shadow-sm dark:border dark:border-slate-700 dark:bg-slate-900">
        {!hasAny ? (
          <EmptyState icon={<ClockIcon />} title="No outstanding invoices." message="Sent invoices with a balance appear here, grouped by how overdue they are." />
        ) : (
          <>
            <div className="hidden overflow-x-auto sm:block">
              <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                    <th className="px-4 py-3">Client</th>
                    {buckets.map((b) => (
                      <th key={b.key} className="px-4 py-3 text-right">{b.key === 'current' ? 'Current' : b.label.replace(' days', '')}</th>
                    ))}
                    <th className="px-4 py-3 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data.clients.map((c) => (
                    <FragmentRow key={c.client_id} c={c} buckets={buckets} symbol={symbol} open={expanded === c.client_id} onToggle={() => setExpanded(expanded === c.client_id ? null : c.client_id)} />
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold text-slate-900 dark:text-white">
                    <td className="px-4 py-3">Total</td>
                    {buckets.map((b) => (
                      <td key={b.key} className="px-4 py-3 text-right tabular-nums">{money(symbol, b.amount)}</td>
                    ))}
                    <td className="px-4 py-3 text-right tabular-nums">{money(symbol, data.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="flex flex-col gap-2.5 p-2 sm:hidden">
              {data.clients.map((c) => (
                <MobileListAccordion
                  key={c.client_id}
                  name="aging-clients"
                  summary={
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate font-medium text-slate-900 dark:text-white">{c.client_name}</span>
                      <span className="shrink-0 tabular-nums text-slate-700 dark:text-slate-200">{money(symbol, c.total)}</span>
                    </div>
                  }
                >
                  {buckets.map((b) =>
                    c[b.key] > 0 ? (
                      <div key={b.key} className="flex justify-between">
                        <dt className="text-slate-500 dark:text-slate-400">{b.label}</dt>
                        <dd className={BUCKET_STYLE[b.key].text}>{money(symbol, c[b.key])}</dd>
                      </div>
                    ) : null,
                  )}
                  {c.invoices.map((i) => (
                    <div key={i.id} className="flex justify-between border-t border-slate-100 pt-2 dark:border-slate-800">
                      <dt>
                        <Link to={`/invoices/${i.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-lagoon-600">{i.number}</Link>
                        <span className="ml-2 text-xs text-slate-500">{i.days_overdue > 0 ? `${i.days_overdue}d overdue` : `due ${i.due_date}`}</span>
                      </dt>
                      <dd className="tabular-nums text-slate-900 dark:text-white">{money(symbol, i.balance)}</dd>
                    </div>
                  ))}
                </MobileListAccordion>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// A client row that expands to list its open invoices (desktop).
function FragmentRow({ c, buckets, symbol, open, onToggle }) {
  return (
    <>
      <tr onClick={onToggle} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800">
        <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900 dark:text-white">
          <span className="mr-2 inline-block w-3 text-slate-400">{open ? '▾' : '▸'}</span>
          {c.client_name}
        </td>
        {buckets.map((b) => (
          <td key={b.key} className={`whitespace-nowrap px-4 py-3 text-right tabular-nums ${c[b.key] > 0 ? BUCKET_STYLE[b.key].text : 'text-slate-300 dark:text-slate-600'}`}>
            {c[b.key] > 0 ? money(symbol, c[b.key]) : '—'}
          </td>
        ))}
        <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-slate-900 dark:text-white">{money(symbol, c.total)}</td>
      </tr>
      {open &&
        c.invoices.map((i) => (
          <tr key={i.id} className="bg-slate-50/60 text-xs dark:bg-slate-800/40">
            <td className="px-4 py-2 pl-10">
              <Link to={`/invoices/${i.id}`} className="font-medium text-lagoon-600 hover:text-lagoon-500">{i.number}</Link>
              <span className="ml-2 text-slate-500">due {i.due_date}</span>
            </td>
            <td colSpan={buckets.length} className="px-4 py-2 text-right text-slate-500">
              {i.days_overdue > 0 ? `${i.days_overdue} days overdue` : 'not yet due'}
            </td>
            <td className="px-4 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">{money(symbol, i.balance)}</td>
          </tr>
        ))}
    </>
  );
}
