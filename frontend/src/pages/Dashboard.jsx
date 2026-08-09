import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import RevenueTrendChart from '../components/RevenueTrendChart';
import StatusBreakdownChart from '../components/StatusBreakdownChart';

const SHORTCUTS = [
  { to: '/clients', label: 'Clients' },
  { to: '/quotes', label: 'Quotes' },
  { to: '/invoices', label: 'Invoices' },
  { to: '/financials', label: 'Financials' },
  { to: '/settings', label: 'Settings' },
];

export default function Dashboard() {
  const { user, token } = useAuth();
  const [summary, setSummary] = useState(null);
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.financials.summary(token).then(setSummary).catch((err) => setError(err.message));
    api.settings.get(token).then(({ settings }) => setSettings(settings));
  }, [token]);

  const symbol = settings?.currency_symbol || '$';

  const kpis = summary
    ? [
        { label: 'Clients', value: summary.clientCount, isMoney: false },
        { label: 'Total invoiced', value: summary.totalInvoiced, isMoney: true },
        { label: 'Total paid', value: summary.totalPaid, isMoney: true },
        { label: 'Outstanding', value: summary.totalOutstanding, isMoney: true },
        {
          label: 'Overdue',
          value: summary.overdueAmount,
          isMoney: true,
          sub: `${summary.overdueCount} invoice${summary.overdueCount === 1 ? '' : 's'}`,
          warn: summary.overdueCount > 0,
        },
      ]
    : [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-bold text-slate-900">Welcome, {user?.name}</h1>
      <p className="mt-1 text-sm text-slate-600">{user?.email}</p>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {!summary ? (
        <p className="mt-8 text-sm text-slate-500">Loading…</p>
      ) : (
        <>
          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {kpis.map((kpi) => (
              <div key={kpi.label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-medium uppercase text-slate-500">{kpi.label}</p>
                <p className={`mt-1 text-xl font-semibold ${kpi.warn ? 'text-red-600' : 'text-slate-900'}`}>
                  {kpi.isMoney ? `${symbol}${kpi.value.toFixed(2)}` : kpi.value}
                </p>
                {kpi.sub && <p className="mt-0.5 text-xs text-slate-500">{kpi.sub}</p>}
              </div>
            ))}
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
              <h2 className="text-sm font-semibold text-slate-900">Revenue, last 6 months</h2>
              <div className="mt-4">
                <RevenueTrendChart data={summary.monthlyTrend} currencySymbol={symbol} />
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Invoices by status</h2>
              <div className="mt-4">
                <StatusBreakdownChart counts={summary.invoiceCounts} />
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-lg border border-slate-200 bg-white shadow-sm">
            <h2 className="px-6 py-4 text-sm font-semibold text-slate-900">Recent payments</h2>
            {summary.recentPayments.length === 0 ? (
              <p className="border-t border-slate-200 px-6 py-4 text-sm text-slate-500">No payments recorded yet.</p>
            ) : (
              <div className="divide-y divide-slate-100 border-t border-slate-200">
                {summary.recentPayments.slice(0, 5).map((p) => (
                  <div key={p.id} className="flex flex-col gap-1 px-6 py-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                    <div>
                      <Link to={`/invoices/${p.invoice_id}`} className="font-medium text-indigo-600 hover:text-indigo-500">
                        {p.invoice_number}
                      </Link>
                      <span className="ml-2 text-slate-500">{p.client_name}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-slate-500">{p.paid_at}</span>
                      <span className="font-medium text-slate-900">
                        {symbol}
                        {p.amount.toFixed(2)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            {SHORTCUTS.map((s) => (
              <Link
                key={s.to}
                to={s.to}
                className="min-h-11 flex items-center rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                {s.label}
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
