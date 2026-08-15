import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import StatusBadge from '../components/StatusBadge';

export default function PublicQuote() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  function load() {
    api.public
      .getQuote(token)
      .then(setData)
      .catch((err) => setError(err.message));
  }

  useEffect(load, [token]);

  async function respond(response) {
    setBusy(true);
    setError('');
    try {
      await api.public.respondQuote(token, response);
      setNotice(response === 'accepted' ? 'Thanks — you accepted this quote.' : 'You declined this quote.');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleViewPdf() {
    setError('');
    try {
      await api.public.openQuotePdf(token);
    } catch (err) {
      setError(err.message);
    }
  }

  if (error && !data) return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-sm text-red-600 dark:text-red-400 sm:px-6">{error}</div>;
  if (!data) return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-sm text-slate-500 dark:text-slate-400 sm:px-6">Loading…</div>;

  const { quote, items, client, settings } = data;
  const symbol = settings?.currency_symbol || '$';
  const canRespond = ['draft', 'sent'].includes(quote.status);

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm sm:p-8 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{settings?.business_name}</p>
            <h1 className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">Quote {quote.number}</h1>
          </div>
          <StatusBadge status={quote.status} />
        </div>

        <div className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <p className="font-medium text-slate-500 dark:text-slate-400">Prepared for</p>
            <p className="text-slate-900 dark:text-white">{client.name}</p>
          </div>
          <div>
            <p className="font-medium text-slate-500 dark:text-slate-400">Issue date</p>
            <p className="text-slate-900 dark:text-white">{quote.issue_date}</p>
            {quote.expiry_date && (
              <>
                <p className="mt-2 font-medium text-slate-500 dark:text-slate-400">Expires</p>
                <p className="text-slate-900 dark:text-white">{quote.expiry_date}</p>
              </>
            )}
          </div>
        </div>

        <div className="mt-6 -mx-6 overflow-x-auto sm:-mx-8">
          <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
            <thead>
              <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                <th className="px-6 py-3 sm:px-8">Description</th>
                <th className="px-4 py-3 text-right">Qty</th>
                <th className="px-4 py-3 text-right">Unit price</th>
                <th className="px-4 py-3 text-right sm:pr-8">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="px-6 py-3 sm:px-8 dark:text-white">{item.description}</td>
                  <td className="px-4 py-3 text-right dark:text-white">{item.quantity}</td>
                  <td className="px-4 py-3 text-right dark:text-white">{symbol}{item.unit_price.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right sm:pr-8 dark:text-white">{symbol}{item.amount.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-slate-200 px-6 py-3 text-right text-sm sm:px-8 dark:border-slate-700">
            <p className="text-slate-600 dark:text-slate-400">Subtotal: {symbol}{quote.subtotal.toFixed(2)}</p>
            {quote.discount_amount > 0 && (
              <p className="text-slate-600 dark:text-slate-400">
                Discount {quote.discount_type === 'percentage' ? `(${quote.discount_value}%)` : ''}: -{symbol}
                {quote.discount_amount.toFixed(2)}
              </p>
            )}
            {quote.tax_rate > 0 && <p className="text-slate-600 dark:text-slate-400">Tax ({quote.tax_rate}%): {symbol}{quote.tax_amount.toFixed(2)}</p>}
            <p className="mt-1 text-base font-semibold text-slate-900 dark:text-white">Total: {symbol}{quote.total.toFixed(2)}</p>
          </div>
        </div>

        {quote.notes && (
          <div className="mt-6 border-t border-slate-200 pt-4 text-sm dark:border-slate-700">
            <p className="font-medium text-slate-500 dark:text-slate-400">Notes</p>
            <p className="mt-1 whitespace-pre-line text-slate-600 dark:text-slate-400">{quote.notes}</p>
          </div>
        )}

        {notice && <p className="mt-6 text-sm text-emerald-600 dark:text-emerald-400">{notice}</p>}
        {error && <p className="mt-6 text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="mt-8 flex flex-wrap gap-3">
          <button
            onClick={handleViewPdf}
            className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Download PDF
          </button>
          {canRespond && (
            <>
              <button
                onClick={() => respond('accepted')}
                disabled={busy}
                className="min-h-11 rounded-md bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
              >
                Accept quote
              </button>
              <button
                onClick={() => respond('declined')}
                disabled={busy}
                className="min-h-11 rounded-md border border-red-300 px-4 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
              >
                Decline
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
