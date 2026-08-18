import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { todayPlus } from '../../lib/date';
import StatusBadge from '../../components/StatusBadge';
import Accordion from '../../components/Accordion';
import EmailPreviewModal from '../../components/EmailPreviewModal';
import { useConfirm } from '../../lib/useConfirm';

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
  const [showSendPreview, setShowSendPreview] = useState(false);
  const { confirm, confirmDialog } = useConfirm();

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

  async function handleDelete() {
    if (!(await confirm({ title: 'Delete this quote?', confirmLabel: 'Delete' }))) return;
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

  if (error && !data) return <div className="mx-auto max-w-3xl px-4 py-10 text-sm text-red-600 dark:text-red-400 sm:px-6">{error}</div>;
  if (!data) return <div className="mx-auto max-w-3xl px-4 py-10 text-sm text-slate-500 dark:text-slate-400 sm:px-6">Loading…</div>;

  const { quote, items, client } = data;
  const symbol = settings?.currency_symbol || '$';

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{quote.number}</h1>
          <div className="mt-1">
            <StatusBadge status={quote.status} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage && (
            <Link to={`/quotes/${id}/edit`} className="min-h-11 flex items-center rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
              Edit
            </Link>
          )}
          <button onClick={handleDownload} className="min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
            Download PDF
          </button>
          {canManage && (
            <button onClick={() => setShowSendPreview(true)} disabled={busy} className="min-h-11 rounded-md bg-lagoon-600 px-3 text-sm font-medium text-white hover:bg-lagoon-500 disabled:opacity-60">
              Email to client
            </button>
          )}
          {canManage && canManageInvoices && !quote.converted_invoice_id && (
            <button onClick={() => setShowConvert((v) => !v)} className="min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
              Convert to invoice
            </button>
          )}
          {canManage && (
            <button onClick={handleDuplicate} disabled={busy} className="min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
              Duplicate
            </button>
          )}
          {canManage && (
            <button onClick={handleDelete} className="min-h-11 rounded-md border border-red-300 px-3 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950">
              Delete
            </button>
          )}
        </div>
      </div>

      {quote.converted_invoice_id && (
        <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">
          Converted to invoice —{' '}
          <Link to={`/invoices/${quote.converted_invoice_id}`} className="text-lagoon-600 hover:text-lagoon-500">
            view invoice
          </Link>
          .
        </p>
      )}

      {showConvert && !quote.converted_invoice_id && (
        <form onSubmit={handleConvert} className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Invoice due date</span>
            <div className="mt-1 flex h-11 w-full items-center overflow-hidden rounded-md border border-slate-300 px-3 focus-within:border-lagoon-500 dark:border-slate-600">
              <input
                type="date"
                required
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="h-full w-full appearance-none border-0 bg-transparent p-0 text-base focus:outline-none dark:text-white"
              />
            </div>
          </label>
          <button type="submit" disabled={busy} className="min-h-11 rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500 disabled:opacity-60">
            Create invoice
          </button>
        </form>
      )}

      {notice && <p className="mt-4 text-sm text-emerald-600 dark:text-emerald-400">{notice}</p>}
      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <Accordion title="Bill to">
          <p className="font-medium text-slate-900 dark:text-white">{client.name}</p>
          <p className="text-sm text-slate-600 dark:text-slate-400">{client.email}</p>
          <p className="text-sm text-slate-600 dark:text-slate-400">{client.address}</p>
        </Accordion>
        <Accordion title="Details">
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500 dark:text-slate-400">Issue date</dt><dd className="text-slate-900 dark:text-white">{quote.issue_date}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500 dark:text-slate-400">Expiry date</dt><dd className="text-slate-900 dark:text-white">{quote.expiry_date || '—'}</dd></div>
          </dl>
        </Accordion>
      </div>

      <div className="mt-6">
        <Accordion title="Items">
          <div className="-mx-6">
            <div className="hidden overflow-x-auto sm:block">
              <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                    <th className="px-6 py-3">Description</th>
                    <th className="px-4 py-3 text-right">Qty</th>
                    <th className="px-4 py-3 text-right">Unit price</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-6 py-3 dark:text-white">{item.description}</td>
                      <td className="px-4 py-3 text-right dark:text-white">{item.quantity}</td>
                      <td className="px-4 py-3 text-right dark:text-white">{symbol}{item.unit_price.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right dark:text-white">{symbol}{item.amount.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-slate-100 text-sm sm:hidden dark:divide-slate-800">
              {items.map((item) => (
                <div key={item.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-slate-900 dark:text-white">{item.description}</p>
                    <p className="text-slate-500 dark:text-slate-400">{item.quantity} × {symbol}{item.unit_price.toFixed(2)}</p>
                  </div>
                  <p className="shrink-0 font-medium text-slate-900 dark:text-white">{symbol}{item.amount.toFixed(2)}</p>
                </div>
              ))}
            </div>

            <div className="border-t border-slate-200 px-6 py-3 text-sm dark:border-slate-700">
              {/* Each row is its own flex pair (label left, amount right)
                  rather than one right-aligned line of "Label: amount" text
                  — that older layout let the amount's horizontal position
                  drift with each label's length, so the figures never
                  actually lined up in a column. */}
              <div className="ml-auto flex w-full max-w-xs flex-col gap-1">
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-600 dark:text-slate-400">Subtotal</dt>
                  <dd className="text-slate-600 dark:text-slate-400">{symbol}{quote.subtotal.toFixed(2)}</dd>
                </div>
                {quote.discount_amount > 0 && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-600 dark:text-slate-400">
                      Discount {quote.discount_type === 'percentage' ? `(${quote.discount_value}%)` : ''}
                    </dt>
                    <dd className="text-slate-600 dark:text-slate-400">-{symbol}{quote.discount_amount.toFixed(2)}</dd>
                  </div>
                )}
                {quote.tax_rate > 0 && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-600 dark:text-slate-400">Tax ({quote.tax_rate}%)</dt>
                    <dd className="text-slate-600 dark:text-slate-400">{symbol}{quote.tax_amount.toFixed(2)}</dd>
                  </div>
                )}
                <div className="mt-1 flex justify-between gap-4 text-base font-semibold text-slate-900 dark:text-white">
                  <dt>Total</dt>
                  <dd>{symbol}{quote.total.toFixed(2)}</dd>
                </div>
              </div>
            </div>
          </div>
        </Accordion>
      </div>

      {quote.notes && (
        <div className="mt-6">
          <Accordion title="Notes">
            <p className="whitespace-pre-line text-sm text-slate-600 dark:text-slate-400">{quote.notes}</p>
          </Accordion>
        </div>
      )}

      <EmailPreviewModal
        open={showSendPreview}
        onClose={() => setShowSendPreview(false)}
        title="Review email before sending"
        loadPreview={() => api.quotes.sendPreview(id, token)}
        onSend={async ({ subject, message }) => {
          await api.quotes.send(id, { subject, message }, token);
          setNotice('Quote emailed to client.');
          load();
        }}
      />

      {confirmDialog}
    </div>
  );
}
