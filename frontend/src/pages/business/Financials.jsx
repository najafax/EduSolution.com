import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import Accordion from '../../components/Accordion';

export default function Financials() {
  const { token } = useAuth();
  const [summary, setSummary] = useState(null);
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.financials.summary(token).then(setSummary).catch((err) => setError(err.message));
    api.settings.get(token).then(({ settings }) => setSettings(settings));
  }, [token]);

  if (error) return <div className="mx-auto max-w-5xl px-4 py-10 text-sm text-red-600 sm:px-6">{error}</div>;
  if (!summary) return <div className="mx-auto max-w-5xl px-4 py-10 text-sm text-slate-500 sm:px-6">Loading…</div>;

  const symbol = settings?.currency_symbol || '$';

  const cards = [
    { label: 'Total invoiced', value: summary.totalInvoiced },
    { label: 'Total paid', value: summary.totalPaid },
    { label: 'Outstanding', value: summary.totalOutstanding },
    { label: 'Overdue', value: summary.overdueAmount, sub: `${summary.overdueCount} invoice${summary.overdueCount === 1 ? '' : 's'}`, warn: summary.overdueCount > 0 },
    { label: 'Expenses', value: summary.totalExpenses },
    { label: 'Net profit', value: summary.netProfit, warn: summary.netProfit < 0 },
  ];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-bold text-slate-900">Financials</h1>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase text-slate-500">{card.label}</p>
            <p className={`mt-2 text-2xl font-semibold ${card.warn ? 'text-red-600' : 'text-slate-900'}`}>
              {symbol}{card.value.toFixed(2)}
            </p>
            {card.sub && <p className="mt-1 text-xs text-slate-500">{card.sub}</p>}
          </div>
        ))}
      </div>

      <div className="mt-8">
        <Accordion title="Recent payments">
          {summary.recentPayments.length === 0 ? (
            <p className="text-sm text-slate-500">No payments recorded yet.</p>
          ) : (
            <div className="-mx-6 overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase text-slate-500">
                    <th className="px-6 py-3">Receipt</th>
                    <th className="px-4 py-3">Invoice</th>
                    <th className="px-4 py-3">Client</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {summary.recentPayments.map((p) => (
                    <tr key={p.id}>
                      <td className="whitespace-nowrap px-6 py-3 font-medium text-slate-900">{p.receipt_number}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <Link to={`/invoices/${p.invoice_id}`} className="text-indigo-600 hover:text-indigo-500">
                          {p.invoice_number}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">{p.client_name}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">{p.paid_at}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-slate-900">{symbol}{p.amount.toFixed(2)}</td>
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
