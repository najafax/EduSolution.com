import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import RevenueTrendChart from '../components/RevenueTrendChart';
import StatusBreakdownChart from '../components/StatusBreakdownChart';
import Accordion from '../components/Accordion';
import KpiCard from '../components/KpiCard';
import { UsersIcon, InvoiceIcon, CheckCircleIcon, ClockIcon, AlertTriangleIcon, TrendUpIcon, TrendDownIcon } from '../components/icons';

function money(symbol, value) {
  const sign = value < 0 ? '-' : '';
  return `${sign}${symbol}${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const SHORTCUTS = [
  { to: '/clients', label: 'Clients', module: 'clients' },
  { to: '/quotes', label: 'Quotes', module: 'quotes' },
  { to: '/invoices', label: 'Invoices', module: 'invoices' },
  { to: '/recurring-invoices', label: 'Recurring', module: 'recurring_invoices' },
  { to: '/expenses', label: 'Expenses', module: 'expenses' },
  { to: '/financials', label: 'Financials', module: 'financials' },
  { to: '/settings', label: 'Settings', module: 'settings' },
];

export default function Dashboard() {
  const { user, token, can } = useAuth();
  const [summary, setSummary] = useState(null);
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');

  const canViewFinancials = can('financials', 'view');

  useEffect(() => {
    if (canViewFinancials) {
      api.financials.summary(token).then(setSummary).catch((err) => setError(err.message));
    }
    api.settings.get(token).then(({ settings }) => setSettings(settings)).catch(() => {});
  }, [token, canViewFinancials]);

  const symbol = settings?.currency_symbol || '$';
  const visibleShortcuts = SHORTCUTS.filter((s) => can(s.module, 'view'));

  const isProfitable = summary && summary.netProfit >= 0;
  const kpis = summary
    ? [
        { key: 'clients', label: 'Clients', value: summary.clientCount, icon: <UsersIcon />, tone: 'neutral' },
        { key: 'invoiced', label: 'Invoiced', value: money(symbol, summary.totalInvoiced), icon: <InvoiceIcon />, tone: 'neutral' },
        { key: 'paid', label: 'Paid', value: money(symbol, summary.totalPaid), icon: <CheckCircleIcon />, tone: 'positive' },
        { key: 'outstanding', label: 'Outstanding', value: money(symbol, summary.totalOutstanding), icon: <ClockIcon />, tone: 'neutral' },
        {
          key: 'overdue',
          label: 'Overdue',
          value: money(symbol, summary.overdueAmount),
          sub: `${summary.overdueCount} invoice${summary.overdueCount === 1 ? '' : 's'}`,
          icon: <AlertTriangleIcon />,
          tone: summary.overdueCount > 0 ? 'negative' : 'neutral',
        },
        {
          key: 'profit',
          label: 'Net profit',
          value: money(symbol, summary.netProfit),
          icon: isProfitable ? <TrendUpIcon /> : <TrendDownIcon />,
          tone: isProfitable ? 'positive' : 'negative',
        },
      ]
    : [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-bold text-slate-900">Welcome, {user?.name}</h1>
      <p className="mt-1 text-sm text-slate-600">{user?.email}</p>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {!canViewFinancials ? (
        <div className="mt-8 flex flex-wrap gap-2">
          {visibleShortcuts.map((s) => (
            <Link
              key={s.to}
              to={s.to}
              className="min-h-11 flex items-center rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              {s.label}
            </Link>
          ))}
          {visibleShortcuts.length === 0 && (
            <p className="text-sm text-slate-500">
              Nothing to show yet — ask an admin to grant you access to what you need.
            </p>
          )}
        </div>
      ) : !summary ? (
        <p className="mt-8 text-sm text-slate-500">Loading…</p>
      ) : (
        <>
          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {kpis.map((kpi) => (
              <KpiCard key={kpi.key} label={kpi.label} value={kpi.value} sub={kpi.sub} icon={kpi.icon} tone={kpi.tone} />
            ))}
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Accordion title="Revenue, last 6 months">
                <RevenueTrendChart data={summary.monthlyTrend} currencySymbol={symbol} />
              </Accordion>
            </div>

            <Accordion title="Invoices by status">
              <StatusBreakdownChart counts={summary.invoiceCounts} />
            </Accordion>
          </div>

          <div className="mt-6">
            <Accordion title="Recent payments">
              {summary.recentPayments.length === 0 ? (
                <p className="text-sm text-slate-500">No payments recorded yet.</p>
              ) : (
                <div className="-mx-6 divide-y divide-slate-100">
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
            </Accordion>
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            {visibleShortcuts.map((s) => (
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
