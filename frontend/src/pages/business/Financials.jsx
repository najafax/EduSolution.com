import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import Accordion from '../../components/Accordion';
import KpiCard from '../../components/KpiCard';
import MeterBar from '../../components/MeterBar';
import RevenueTrendChart from '../../components/RevenueTrendChart';
import StatusBreakdownChart from '../../components/StatusBreakdownChart';
import StatusFilterChips from '../../components/StatusFilterChips';
import { InvoiceIcon, CheckCircleIcon, ClockIcon, AlertTriangleIcon, ExpenseIcon, TrendUpIcon, TrendDownIcon, BankIcon, UsersIcon } from '../../components/icons';
import { money } from '../../lib/money';
import { todayStr, startOfMonthStr } from '../../lib/date';
import MobileListAccordion from '../../components/MobileListAccordion';

// Every card/chart/list on this page is scoped to whichever period is
// selected here (see routes/financials.js's own `from`/`to` handling) —
// 'all_time' is the one option that sends no range at all, matching this
// endpoint's original, pre-filter behavior exactly (and what Dashboard.jsx's
// own call to the same endpoint still gets, unconditionally).
const PERIOD_OPTIONS = [
  { value: 'this_year', label: 'This year' },
  { value: 'last_year', label: 'Last year' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'all_time', label: 'All time' },
];

// Computed fresh from `period` on every call (not memoized) so "This
// year"/"This month" stay relative to today rather than to whenever the
// page first loaded — same reasoning Reports.jsx's own PRESETS documents
// for its identical "This month"/"Last month" math, reused here rather
// than duplicated logic drifting apart from it.
function periodRange(period) {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth();
  const fmt = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  switch (period) {
    case 'this_year':
      return { from: `${y}-01-01`, to: todayStr() };
    case 'last_year':
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    case 'this_month':
      return { from: startOfMonthStr(), to: todayStr() };
    case 'last_month':
      return { from: fmt(new Date(y, m - 1, 1)), to: fmt(new Date(y, m, 0)) };
    case 'all_time':
    default:
      return { from: null, to: null };
  }
}

export default function Financials() {
  const { token } = useAuth();
  const [period, setPeriod] = useState('this_year');
  const [summary, setSummary] = useState(null);
  const [settings, setSettings] = useState(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // No `setSummary(null)` here on a period change — the previous
    // period's figures stay on screen until the new ones arrive, so
    // switching tabs swaps the numbers directly instead of flashing back
    // to the page's "Loading…" state (same "only show the loading state on
    // the very first load" convention lib/useDebouncedValue.js documents
    // for every other page's own search/filter refetches).
    api.financials.summary(token, periodRange(period)).then(setSummary).catch((err) => setError(err.message));
  }, [token, period]);

  useEffect(() => {
    // .finally flips settingsLoaded whether the fetch succeeds or fails
    // (e.g. a staff user without settings:view) — the loading gate below
    // waits on this too, so every money figure on this page paints with
    // the real currency symbol on first render instead of flashing '$'
    // for a frame while settings is still in flight (see Dashboard.jsx's
    // own note on this same race for the full story). Independent of the
    // period effect above — settings never change with the filter.
    api.settings
      .get(token)
      .then(({ settings }) => setSettings(settings))
      .catch(() => {})
      .finally(() => setSettingsLoaded(true));
  }, [token]);

  async function handleDownloadReceipt(invoiceId, paymentId) {
    setError('');
    try {
      await api.invoices.openReceiptPdf(invoiceId, paymentId, token);
    } catch (err) {
      setError(err.message);
    }
  }

  if (error && !summary) return <div className="px-4 py-10 text-sm text-red-600 dark:text-red-400 sm:px-6 lg:px-8">{error}</div>;
  if (!summary || !settingsLoaded) return <div className="px-4 py-10 text-sm text-slate-500 dark:text-slate-400 sm:px-6 lg:px-8">Loading…</div>;

  const symbol = settings?.currency_symbol || '$';
  const collectedPct = summary.totalInvoiced > 0 ? (summary.totalPaid / summary.totalInvoiced) * 100 : 0;
  const outstandingPct = summary.totalInvoiced > 0 ? (summary.totalOutstanding / summary.totalInvoiced) * 100 : 0;
  // Divides by cashRevenue, not totalPaid — netProfit is itself computed
  // cash-basis (payments received in the period, see routes/financials.js's
  // own note), so the margin has to divide by that same revenue figure
  // rather than totalPaid's accrual one, or the two wouldn't reconcile.
  const marginPct = summary.cashRevenue > 0 ? (summary.netProfit / summary.cashRevenue) * 100 : null;
  const isProfitable = summary.netProfit >= 0;
  const isPositiveBalance = summary.bankBalance >= 0;

  const cards = [
    {
      key: 'invoiced',
      label: 'Invoiced',
      value: money(symbol, summary.totalInvoiced),
      icon: <InvoiceIcon />,
      tone: 'neutral',
    },
    {
      key: 'paid',
      label: 'Paid',
      value: money(symbol, summary.totalPaid),
      sub: summary.totalInvoiced > 0 ? `${collectedPct.toFixed(0)}% collected` : null,
      icon: <CheckCircleIcon />,
      tone: 'positive',
    },
    {
      key: 'outstanding',
      label: 'Outstanding',
      value: money(symbol, summary.totalOutstanding),
      sub: summary.totalInvoiced > 0 ? `${outstandingPct.toFixed(0)}% of invoiced` : null,
      icon: <ClockIcon />,
      tone: 'neutral',
    },
    {
      key: 'overdue',
      label: 'Overdue',
      value: money(symbol, summary.overdueAmount),
      sub: `${summary.overdueCount} invoice${summary.overdueCount === 1 ? '' : 's'}`,
      icon: <AlertTriangleIcon />,
      tone: summary.overdueCount > 0 ? 'negative' : 'neutral',
    },
    {
      key: 'expenses',
      label: 'Expenses',
      value: money(symbol, summary.totalExpenses),
      icon: <ExpenseIcon />,
      tone: 'neutral',
    },
    {
      key: 'profit',
      label: 'Net profit',
      value: money(symbol, summary.netProfit),
      sub: marginPct !== null ? `${marginPct.toFixed(0)}% margin` : null,
      icon: isProfitable ? <TrendUpIcon /> : <TrendDownIcon />,
      tone: isProfitable ? 'positive' : 'negative',
    },
    {
      key: 'capitalContributions',
      label: 'Capital contributions',
      value: money(symbol, summary.totalCapitalContributions),
      sub: 'Owner/partner money put in',
      icon: <UsersIcon />,
      tone: 'neutral',
    },
    {
      key: 'ownerDraws',
      label: 'Owner draws (net)',
      value: money(symbol, summary.totalOwnerDraws - summary.totalOwnerReturns),
      sub: 'Taken out, minus returned',
      icon: <TrendDownIcon />,
      tone: summary.totalOwnerDraws - summary.totalOwnerReturns > 0 ? 'warning' : 'neutral',
    },
    {
      key: 'bankBalance',
      label: 'Bank balance',
      value: money(symbol, summary.bankBalance),
      // Bank balance is a running total, not a period sum — a period
      // filter moves *when* it's measured (see routes/financials.js's own
      // note) rather than narrowing it, so its sub text says so whenever
      // that "as of" date isn't just today (the this-year/all-time case,
      // where it reads the same as it always has).
      sub:
        summary.bankBalanceAsOf && summary.bankBalanceAsOf !== todayStr()
          ? `As of ${summary.bankBalanceAsOf}`
          : 'Starting balance + net profit + contributions − owner draws',
      icon: <BankIcon />,
      tone: isPositiveBalance ? 'positive' : 'negative',
    },
  ];

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Financials</h1>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">A live view of what's owed, what's been paid, and where you stand.</p>

      <div className="mt-4">
        <StatusFilterChips options={PERIOD_OPTIONS} value={period} onChange={setPeriod} />
      </div>

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-6 grid grid-cols-2 gap-4">
        {cards.map((card) => (
          <KpiCard key={card.key} label={card.label} value={card.value} sub={card.sub} icon={card.icon} tone={card.tone} />
        ))}
      </div>

      {summary.totalInvoiced > 0 && (
        <div className="mt-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <MeterBar
            label="Collection rate"
            pct={collectedPct}
            color={collectedPct >= 80 ? 'emerald' : collectedPct >= 50 ? 'amber' : 'red'}
            sub={`${money(symbol, summary.totalPaid)} collected of ${money(symbol, summary.totalInvoiced)} invoiced`}
          />
        </div>
      )}

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
            <p className="text-sm text-slate-500 dark:text-slate-400">No payments recorded yet.</p>
          ) : (
            <>
              <div className="-mx-6 hidden overflow-x-auto sm:block">
                <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
                  <thead>
                    <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                      <th className="px-6 py-3">Receipt</th>
                      <th className="px-4 py-3">Invoice</th>
                      <th className="px-4 py-3">Client</th>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {summary.recentPayments.map((p) => (
                      <tr key={p.id}>
                        <td className="whitespace-nowrap px-6 py-3 font-medium">
                          <button type="button" onClick={() => handleDownloadReceipt(p.invoice_id, p.id)} className="text-lagoon-600 hover:text-lagoon-500">
                            {p.receipt_number}
                          </button>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <Link to={`/invoices/${p.invoice_id}`} className="text-lagoon-600 hover:text-lagoon-500">
                            {p.invoice_number}
                          </Link>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-400">{p.client_name}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-400">{p.paid_at}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-slate-900 dark:text-white">{money(symbol, p.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col gap-2.5 sm:hidden">
                {summary.recentPayments.map((p) => (
                  <MobileListAccordion
                    key={p.id}
                    name="financials-recent-payments"
                    summary={
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <Link
                            to={`/invoices/${p.invoice_id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="font-medium text-lagoon-600 hover:text-lagoon-500"
                          >
                            {p.invoice_number}
                          </Link>
                          <p className="truncate text-slate-500 dark:text-slate-400">{p.client_name}</p>
                        </div>
                        <p className="shrink-0 text-slate-900 dark:text-white">{money(symbol, p.amount)}</p>
                      </div>
                    }
                  >
                    <div className="flex justify-between">
                      <dt className="text-slate-500 dark:text-slate-400">Receipt</dt>
                      <dd>
                        <button
                          type="button"
                          onClick={() => handleDownloadReceipt(p.invoice_id, p.id)}
                          className="text-lagoon-600 hover:text-lagoon-500"
                        >
                          {p.receipt_number}
                        </button>
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-slate-500 dark:text-slate-400">Date</dt>
                      <dd className="text-slate-900 dark:text-white">{p.paid_at}</dd>
                    </div>
                  </MobileListAccordion>
                ))}
              </div>
            </>
          )}
        </Accordion>
      </div>
    </div>
  );
}
