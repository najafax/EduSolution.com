import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import Accordion from '../../components/Accordion';
import KpiCard from '../../components/KpiCard';
import MeterBar from '../../components/MeterBar';
import RevenueTrendChart from '../../components/RevenueTrendChart';
import StatusBreakdownChart from '../../components/StatusBreakdownChart';
import { InvoiceIcon, CheckCircleIcon, ClockIcon, AlertTriangleIcon, ExpenseIcon, TrendUpIcon, TrendDownIcon } from '../../components/icons';
import { money } from '../../lib/money';

export default function Financials() {
  const { token } = useAuth();
  const [summary, setSummary] = useState(null);
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.financials.summary(token).then(setSummary).catch((err) => setError(err.message));
    api.settings.get(token).then(({ settings }) => setSettings(settings)).catch(() => {});
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
  if (!summary) return <div className="px-4 py-10 text-sm text-slate-500 dark:text-slate-400 sm:px-6 lg:px-8">Loading…</div>;

  const symbol = settings?.currency_symbol || '$';
  const collectedPct = summary.totalInvoiced > 0 ? (summary.totalPaid / summary.totalInvoiced) * 100 : 0;
  const outstandingPct = summary.totalInvoiced > 0 ? (summary.totalOutstanding / summary.totalInvoiced) * 100 : 0;
  const marginPct = summary.totalPaid > 0 ? (summary.netProfit / summary.totalPaid) * 100 : null;
  const isProfitable = summary.netProfit >= 0;

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
  ];

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Financials</h1>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">A live view of what's owed, what's been paid, and where you stand.</p>

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
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
            <div className="-mx-6 overflow-x-auto">
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
                        <button type="button" onClick={() => handleDownloadReceipt(p.invoice_id, p.id)} className="text-indigo-600 hover:text-indigo-500">
                          {p.receipt_number}
                        </button>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <Link to={`/invoices/${p.invoice_id}`} className="text-indigo-600 hover:text-indigo-500">
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
          )}
        </Accordion>
      </div>
    </div>
  );
}
