import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { todayStr } from '../../lib/date';
import StatusBadge from '../../components/StatusBadge';
import Accordion from '../../components/Accordion';

const METHODS = ['bank_transfer', 'cash', 'card', 'cheque', 'other'];

export default function InvoiceDetail() {
  const { token, can } = useAuth();
  const canManage = can('invoices', 'manage');
  const { id } = useParams();
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [payment, setPayment] = useState({ amount: '', method: 'bank_transfer', reference: '', notes: '', paid_at: todayStr() });

  function load() {
    api.invoices
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
      await api.invoices.openPdf(id, token);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSend() {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await api.invoices.send(id, token);
      setNotice('Invoice emailed to client.');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemind() {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await api.invoices.remind(id, token);
      setNotice('Reminder emailed to client.');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this invoice?')) return;
    try {
      await api.invoices.remove(id, token);
      navigate('/invoices');
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDuplicate() {
    setError('');
    setBusy(true);
    try {
      const { invoice } = await api.invoices.duplicate(id, token);
      navigate(`/invoices/${invoice.id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function handleRecordPayment(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.invoices.recordPayment(id, { ...payment, amount: Number(payment.amount) }, token);
      setShowPayment(false);
      setPayment({ amount: '', method: 'bank_transfer', reference: '', notes: '', paid_at: todayStr() });
      setNotice('Payment recorded.');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDownloadReceipt(paymentId) {
    setError('');
    try {
      await api.invoices.openReceiptPdf(id, paymentId, token);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSendReceipt(paymentId) {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await api.invoices.sendReceipt(id, paymentId, token);
      setNotice('Receipt emailed to client.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) return <div className="mx-auto max-w-3xl px-4 py-10 text-sm text-red-600 dark:text-red-400 sm:px-6">{error}</div>;
  if (!data) return <div className="mx-auto max-w-3xl px-4 py-10 text-sm text-slate-500 dark:text-slate-400 sm:px-6">Loading…</div>;

  const { invoice, items, client, payments } = data;
  const symbol = settings?.currency_symbol || '$';
  const isLocked = invoice.status === 'sent' || invoice.status === 'paid';

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{invoice.number}</h1>
          <div className="mt-1">
            <StatusBadge status={invoice.is_overdue ? 'overdue' : invoice.status} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage && !isLocked && (
            <Link to={`/invoices/${id}/edit`} className="min-h-11 flex items-center rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
              Edit
            </Link>
          )}
          <button onClick={handleDownload} className="min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
            Download PDF
          </button>
          {canManage && (
            <button onClick={handleSend} disabled={busy} className="min-h-11 rounded-md bg-indigo-600 px-3 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60">
              Email to client
            </button>
          )}
          {canManage && invoice.balance_due > 0 && (
            <button onClick={handleRemind} disabled={busy} className="min-h-11 rounded-md border border-amber-300 px-3 text-sm font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-60 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-950">
              Send reminder
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

      {notice && <p className="mt-4 text-sm text-emerald-600 dark:text-emerald-400">{notice}</p>}
      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {isLocked && (
        <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
          This invoice has been {invoice.status === 'paid' ? 'paid' : 'sent to the client'} and can no longer be
          edited.
        </p>
      )}
      {invoice.last_reminder_sent_at && (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Last reminder sent {invoice.last_reminder_sent_at}</p>
      )}

      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <Accordion title="Bill to">
          <p className="font-medium text-slate-900 dark:text-white">{client.name}</p>
          <p className="text-sm text-slate-600 dark:text-slate-400">{client.email}</p>
          <p className="text-sm text-slate-600 dark:text-slate-400">{client.address}</p>
        </Accordion>
        <Accordion title="Details">
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500 dark:text-slate-400">Issue date</dt><dd className="text-slate-900 dark:text-white">{invoice.issue_date}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500 dark:text-slate-400">Due date</dt><dd className="text-slate-900 dark:text-white">{invoice.due_date}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500 dark:text-slate-400">Balance due</dt><dd className="text-slate-900 dark:text-white">{symbol}{invoice.balance_due.toFixed(2)}</dd></div>
          </dl>
        </Accordion>
      </div>

      <div className="mt-6">
        <Accordion title="Items">
          <div className="-mx-6 overflow-x-auto">
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
            <div className="border-t border-slate-200 px-6 py-3 text-right text-sm dark:border-slate-700">
              <p className="text-slate-600 dark:text-slate-400">Subtotal: {symbol}{invoice.subtotal.toFixed(2)}</p>
              {invoice.discount_amount > 0 && (
                <p className="text-slate-600 dark:text-slate-400">
                  Discount {invoice.discount_type === 'percentage' ? `(${invoice.discount_value}%)` : ''}: -{symbol}
                  {invoice.discount_amount.toFixed(2)}
                </p>
              )}
              {invoice.tax_rate > 0 && <p className="text-slate-600 dark:text-slate-400">Tax ({invoice.tax_rate}%): {symbol}{invoice.tax_amount.toFixed(2)}</p>}
              <p className="text-slate-600 dark:text-slate-400">Total: {symbol}{invoice.total.toFixed(2)}</p>
              <p className="text-slate-600 dark:text-slate-400">Paid: {symbol}{invoice.amount_paid.toFixed(2)}</p>
              <p className="mt-1 text-base font-semibold text-slate-900 dark:text-white">Balance due: {symbol}{invoice.balance_due.toFixed(2)}</p>
            </div>
          </div>
        </Accordion>
      </div>

      <div className="mt-6">
        <Accordion
          title="Payments"
          action={
            canManage &&
            invoice.balance_due > 0 && (
              <button
                onClick={() => setShowPayment((v) => !v)}
                className="min-h-11 rounded-md bg-indigo-600 px-3 text-sm font-medium text-white hover:bg-indigo-500"
              >
                Record payment
              </button>
            )
          }
        >
          {showPayment && (
            <form onSubmit={handleRecordPayment} className="-mx-6 -mt-4 mb-4 grid gap-4 border-b border-slate-200 px-6 pb-4 sm:grid-cols-2 dark:border-slate-700">
              <label className="block">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Amount</span>
                <input
                  type="number"
                  min="0.01"
                  max={invoice.balance_due}
                  step="0.01"
                  required
                  value={payment.amount}
                  onChange={(e) => setPayment((p) => ({ ...p, amount: e.target.value }))}
                  className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-indigo-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Method</span>
                <select
                  value={payment.method}
                  onChange={(e) => setPayment((p) => ({ ...p, method: e.target.value }))}
                  className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-indigo-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                >
                  {METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m.replace('_', ' ')}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Date</span>
                <div className="mt-1 flex h-11 w-full items-center overflow-hidden rounded-md border border-slate-300 px-3 focus-within:border-indigo-500 dark:border-slate-600">
                  <input
                    type="date"
                    required
                    value={payment.paid_at}
                    onChange={(e) => setPayment((p) => ({ ...p, paid_at: e.target.value }))}
                    className="h-full w-full appearance-none border-0 bg-transparent p-0 text-base focus:outline-none dark:text-white"
                  />
                </div>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Reference</span>
                <input
                  type="text"
                  value={payment.reference}
                  onChange={(e) => setPayment((p) => ({ ...p, reference: e.target.value }))}
                  className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-indigo-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                />
              </label>
              <div className="sm:col-span-2">
                <button
                  type="submit"
                  disabled={busy}
                  className="min-h-11 rounded-md bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
                >
                  {busy ? 'Recording…' : 'Record payment'}
                </button>
              </div>
            </form>
          )}

          {payments.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No payments recorded yet.</p>
          ) : (
            <div className="-mx-6 overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                    <th className="px-6 py-3">Receipt</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Method</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-6 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td className="whitespace-nowrap px-6 py-3 font-medium text-slate-900 dark:text-white">{p.receipt_number}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-400">{p.paid_at}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-400">{p.method.replace('_', ' ')}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-slate-900 dark:text-white">{symbol}{p.amount.toFixed(2)}</td>
                      <td className="whitespace-nowrap px-6 py-3 text-right">
                        <button onClick={() => handleDownloadReceipt(p.id)} className="mr-3 text-indigo-600 hover:text-indigo-500">
                          Download
                        </button>
                        {canManage && (
                          <button onClick={() => handleSendReceipt(p.id)} className="text-indigo-600 hover:text-indigo-500">
                            Email
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Accordion>
      </div>

      {invoice.notes && (
        <div className="mt-6">
          <Accordion title="Notes">
            <p className="whitespace-pre-line text-sm text-slate-600 dark:text-slate-400">{invoice.notes}</p>
          </Accordion>
        </div>
      )}
    </div>
  );
}
