import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import KpiCard from '../../components/KpiCard';
import MobileListAccordion from '../../components/MobileListAccordion';
import YearlyBarChart from '../../components/YearlyBarChart';
import BreakdownBars from '../../components/BreakdownBars';
import { InvoiceIcon, TrendUpIcon, AlertTriangleIcon, CheckCircleIcon, ClockIcon } from '../../components/icons';
import { money } from '../../lib/money';

const ISSUED_COLOR = '#0e7c86';
const PAYMENTS_COLOR = '#059669';
const YEARLY_SERIES = [
  { key: 'issued', label: 'Invoices issued', color: ISSUED_COLOR },
  { key: 'paymentsReceived', label: 'Payments received', color: PAYMENTS_COLOR },
];

// Same STATUS_META/color pairing as components/StatusBreakdownChart.jsx
// (status is state, not series identity — colors are the app's reserved
// status palette, same as StatusBadge/lib/pdf.js), just fed through the
// shared BreakdownBars instead of that fixed-shape component, since this
// page's other panel (the yearly chart) already needs the generic one.
const STATUS_ROWS = [
  { key: 'draft', label: 'Draft', color: '#94a3b8' },
  { key: 'sent', label: 'Sent', color: '#0e7c86' },
  { key: 'paid', label: 'Paid', color: '#059669' },
  { key: 'void', label: 'Void', color: '#dc2626' },
];

export default function InvoiceAnalytics() {
  const { token, can } = useAuth();
  const canView = can('invoices', 'view');
  const [data, setData] = useState(null);
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!canView) return;
    api.invoices
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
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Invoice analytics</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Billing and collections by year, going back to your earliest invoice.</p>
        </div>
        <Link
          to="/invoices"
          className="min-h-11 flex items-center rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Back to invoices
        </Link>
      </div>

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard icon={<InvoiceIcon />} label="Total invoices" value={data.totals.totalInvoices} tone="neutral" />
        <KpiCard icon={<TrendUpIcon />} label="Issued this year" value={thisYear?.issued ?? 0} tone="positive" />
        <KpiCard icon={<InvoiceIcon />} label="Invoiced this year" value={money(symbol, thisYear?.amountInvoiced ?? 0)} tone="neutral" />
        <KpiCard icon={<CheckCircleIcon />} label="Collected this year" value={money(symbol, thisYear?.amountCollected ?? 0)} tone="positive" />
        <KpiCard icon={<AlertTriangleIcon />} label="Voided this year" value={thisYear?.voided ?? 0} tone="negative" />
        <KpiCard icon={<ClockIcon />} label="Outstanding now" value={money(symbol, data.totals.totalOutstanding)} tone="warning" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2 dark:border-slate-700 dark:bg-slate-900">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Invoices issued &amp; payments received by year</h2>
          <div className="mt-4">
            <YearlyBarChart
              data={data.byYear}
              series={YEARLY_SERIES}
              emptyMessage="No invoice activity yet."
              ariaLabel="Invoices issued and payments received per year"
            />
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Status breakdown</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Current invoices, by status.</p>
          <div className="mt-4">
            <BreakdownBars
              emptyMessage="No invoices yet."
              rows={STATUS_ROWS.map((r) => ({ ...r, value: data.byStatus[r.key] || 0 }))}
            />
          </div>
          <dl className="mt-5 space-y-1.5 border-t border-slate-100 pt-4 text-xs dark:border-slate-800">
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Total invoiced (all-time)</dt>
              <dd className="font-medium text-slate-900 dark:text-white">{money(symbol, data.totals.totalInvoiced)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Total collected (all-time)</dt>
              <dd className="font-medium text-slate-900 dark:text-white">{money(symbol, data.totals.totalCollected)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Outstanding now</dt>
              <dd className="font-medium text-slate-900 dark:text-white">{money(symbol, data.totals.totalOutstanding)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Voided (all-time)</dt>
              <dd className="font-medium text-slate-900 dark:text-white">{data.totals.totalVoided}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Year by year</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            "Amount invoiced" excludes voided invoices, matching the Financials page's own convention. "Collected" is an exact
            figure from recorded payments, not an estimate.
          </p>
        </div>
        <div className="hidden overflow-x-auto sm:block">
          <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
            <thead>
              <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                <th className="px-5 py-3">Year</th>
                <th className="px-4 py-3 text-right">Issued</th>
                <th className="px-4 py-3 text-right">Amount invoiced</th>
                <th className="px-4 py-3 text-right">Payments</th>
                <th className="px-4 py-3 text-right">Collected</th>
                <th className="px-5 py-3 text-right">Voided</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.byYear.map((y) => (
                <tr key={y.year}>
                  <td className="px-5 py-3 font-medium text-slate-900 dark:text-white">{y.year}</td>
                  <td className="px-4 py-3 text-right dark:text-white">{y.issued}</td>
                  <td className="px-4 py-3 text-right dark:text-white">{money(symbol, y.amountInvoiced)}</td>
                  <td className="px-4 py-3 text-right dark:text-white">{y.paymentsReceived}</td>
                  <td className="px-4 py-3 text-right dark:text-white">{money(symbol, y.amountCollected)}</td>
                  <td className="px-5 py-3 text-right dark:text-white">{y.voided}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-2.5 p-4 sm:hidden">
          {data.byYear.map((y) => (
            <MobileListAccordion
              key={y.year}
              name="invoice-analytics-years"
              summary={
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-slate-900 dark:text-white">{y.year}</span>
                  <span className="text-slate-500 dark:text-slate-400">
                    {y.issued} issued · {y.paymentsReceived} payments
                  </span>
                </div>
              }
            >
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Amount invoiced</dt>
                <dd className="text-slate-900 dark:text-white">{money(symbol, y.amountInvoiced)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Collected</dt>
                <dd className="text-slate-900 dark:text-white">{money(symbol, y.amountCollected)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Voided</dt>
                <dd className="text-slate-900 dark:text-white">{y.voided}</dd>
              </div>
            </MobileListAccordion>
          ))}
        </div>
      </div>

      {data.topClients.length > 0 && (
        <div className="mt-6 rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Top clients by invoiced amount</h2>
          </div>
          <div className="hidden overflow-x-auto sm:block">
            <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
              <thead>
                <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                  <th className="px-5 py-3">Client</th>
                  <th className="px-4 py-3 text-right">Invoices</th>
                  <th className="px-5 py-3 text-right">Total invoiced</th>
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
                    <td className="px-4 py-3 text-right dark:text-white">{c.invoice_count}</td>
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
                name="invoice-analytics-clients"
                summary={
                  <div className="flex items-center justify-between gap-3">
                    <Link to="/clients" className="text-lagoon-600 hover:text-lagoon-500" onClick={(e) => e.stopPropagation()}>
                      {c.name}
                    </Link>
                    <span className="text-slate-500 dark:text-slate-400">{c.invoice_count} invoices</span>
                  </div>
                }
              >
                <div className="flex justify-between">
                  <dt className="text-slate-500 dark:text-slate-400">Total invoiced</dt>
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
