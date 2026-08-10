import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import StatusBadge from '../../components/StatusBadge';
import Accordion from '../../components/Accordion';

const todayPlus = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

export default function QuoteDetail() {
  const { token, can } = useAuth();
  const canManage = can('quotes', 'manage');
  const canManageInvoices = can('invoices', 'manage');
  const { id } = useParams();
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [showConvert, setShowConvert] = useState(false);
  const [dueDate, setDueDate] = useState(todayPlus(14));

  function load() {
    api.quotes
      .get(id, token)
      .then(setData)
      .catch((err) => setError(err.message));
  }

  useEffect(load, [id, token]);
  useEffect(() => {
    api.settings.get(token).then(({ settings }) => setSettings(settings)).catch(() => {});
  }, [token]);

  async function handleDownload() {
    setError('');
    try {
      await api.quotes.openPdf(id, token);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSend() {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await api.quotes.send(id, token);
      setNotice('Quote emailed to client.');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this quote?')) return;
    try {
      await api.quotes.remove(id, token);
      navigate('/quotes');
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDuplicate() {
    setError('');
    setBusy(true);
    try {
      const { quote } = await api.quotes.duplicate(id, token);
      navigate(`/quotes/${quote.id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function handleConvert(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { invoiceId } = await api.quotes.convertToInvoice(id, { due_date: dueDate }, token);
      navigate(`/invoices/${invoiceId}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  if (error && !data) return <div className="mx-auto max-w-3xl px-4 py-10 text-sm text-red-600 sm:px-6">{error}</div>;
  if (!data) return <div className="mx-auto max-w-3xl px-4 py-10 text-sm text-slate-500 sm:px-6">Loading…</div>;

  const { quote, items, client } = data;
  const symbol = settings?.currency_symbol || '$';

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{quote.number}</h1>
          <div className="mt-1">
            <StatusBadge status={quote.status} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage && (
            <Link to={`/quotes/${id}/edit`} className="min-h-11 flex items-center rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Edit
            </Link>
          )}
          <button onClick={handleDownload} className="min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Download PDF
          </button>
          {canManage && (
            <button onClick={handleSend} disabled={busy} className="min-h-11 rounded-md bg-indigo-600 px-3 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60">
              Email to client
            </button>
          )}
          {canManage && canManageInvoices && !quote.converted_invoice_id && (
            <button onClick={() => setShowConvert((v) => !v)} className="min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Convert to invoice
            </button>
          )}
          {canManage && (
            <button onClick={handleDuplicate} disabled={busy} className="min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60">
              Duplicate
            </button>
          )}
          {canManage && (
            <button onClick={handleDelete} className="min-h-11 rounded-md border border-red-300 px-3 text-sm font-medium text-red-600 hover:bg-red-50">
              Delete
            </button>
          )}
        </div>
      </div>

      {quote.converted_invoice_id && (
        <p className="mt-4 text-sm text-slate-600">
          Converted to invoice —{' '}
          <Link to={`/invoices/${quote.converted_invoice_id}`} className="text-indigo-600 hover:text-indigo-500">
            view invoice
          </Link>
          .
        </p>
      )}

      {showConvert && !quote.converted_invoice_id && (
        <form onSubmit={handleConvert} className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Invoice due date</span>
            <input
              type="date"
              required
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="mt-1 min-h-11 rounded-md border border-slate-300 px-3 py-2 text-base focus:border-indigo-500 focus:outline-none"
            />
          </label>
          <button type="submit" disabled={busy} className="min-h-11 rounded-md bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60">
            Create invoice
          </button>
        </form>
      )}

      {notice && <p className="mt-4 text-sm text-emerald-600">{notice}</p>}
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <Accordion title="Bill to">
          <p className="font-medium text-slate-900">{client.company || client.name}</p>
          <p className="text-sm text-slate-600">{client.company ? client.name : ''}</p>
          <p className="text-sm text-slate-600">{client.email}</p>
          <p className="text-sm text-slate-600">{client.phone}</p>
        </Accordion>
        <Accordion title="Details">
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Issue date</dt><dd className="text-slate-900">{quote.issue_date}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Expiry date</dt><dd className="text-slate-900">{quote.expiry_date || '—'}</dd></div>
          </dl>
        </Accordion>
      </div>

      <div className="mt-6">
        <Accordion title="Items">
          <div className="-mx-6 overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead>
                <tr className="text-left text-xs font-medium uppercase text-slate-500">
                  <th className="px-6 py-3">Description</th>
                  <th className="px-4 py-3 text-right">Qty</th>
                  <th className="px-4 py-3 text-right">Unit price</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-6 py-3">{item.description}</td>
                    <td className="px-4 py-3 text-right">{item.quantity}</td>
                    <td className="px-4 py-3 text-right">{symbol}{item.unit_price.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right">{symbol}{item.amount.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t border-slate-200 px-6 py-3 text-right text-sm">
              <p className="text-slate-600">Subtotal: {symbol}{quote.subtotal.toFixed(2)}</p>
              {quote.discount_amount > 0 && (
                <p className="text-slate-600">
                  Discount {quote.discount_type === 'percentage' ? `(${quote.discount_value}%)` : ''}: -{symbol}
                  {quote.discount_amount.toFixed(2)}
                </p>
              )}
              {quote.tax_rate > 0 && <p className="text-slate-600">Tax ({quote.tax_rate}%): {symbol}{quote.tax_amount.toFixed(2)}</p>}
              <p className="mt-1 text-base font-semibold text-slate-900">Total: {symbol}{quote.total.toFixed(2)}</p>
            </div>
          </div>
        </Accordion>
      </div>

      {quote.notes && (
        <div className="mt-6">
          <Accordion title="Notes">
            <p className="whitespace-pre-line text-sm text-slate-600">{quote.notes}</p>
          </Accordion>
        </div>
      )}
    </div>
  );
}
