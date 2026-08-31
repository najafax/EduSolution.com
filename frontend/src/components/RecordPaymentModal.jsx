import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { todayStr } from '../lib/date';
import Modal from './Modal';
import ScanPaymentSlip from './ScanPaymentSlip';

const METHODS = ['bank_transfer', 'cash', 'card', 'cheque', 'other'];

function defaultPayment(invoice) {
  return { amount: invoice ? invoice.balance_due.toFixed(2) : '', method: 'bank_transfer', reference: '', notes: '', paid_at: todayStr() };
}

// The one "Record payment" form, shared by InvoiceDetail.jsx (its own
// existing Payments-card action) and Invoices.jsx (a new list-row quick
// action — see CLAUDE.md's own note on why recording a payment used to
// mean navigating into a specific invoice first). Pulling this out into
// its own component is what let the list page gain the same action with
// no duplicated form markup, and what let ScanPaymentSlip.jsx's OCR
// assist ship to both places in one change rather than two.
//
// Deliberately owns its own submit/error/busy state rather than lifting it
// to the caller — both callers just need to know when a payment was
// recorded (to refresh their own data) and don't otherwise care about the
// form's internals.
export default function RecordPaymentModal({ open, onClose, invoice, token, onRecorded }) {
  const [payment, setPayment] = useState(() => defaultPayment(invoice));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Re-syncs the Amount field to the invoice's current balance every time
  // the modal opens for a (possibly different) invoice — mirrors
  // InvoiceDetail.jsx's own pre-existing togglePaymentForm() behavior:
  // paying off the full remaining balance is the common case, and the
  // field is still freely editable for a partial payment.
  useEffect(() => {
    if (open) {
      setPayment(defaultPayment(invoice));
      setError('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, invoice?.id]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!invoice) return;
    setError('');
    setBusy(true);
    try {
      const result = await api.invoices.recordPayment(invoice.id, { ...payment, amount: Number(payment.amount) }, token);
      onRecorded(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={invoice ? `Record payment — ${invoice.number}` : 'Record payment'} maxWidthClass="max-w-lg">
      {invoice && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <ScanPaymentSlip disabled={busy} onDetected={(reference) => setPayment((p) => ({ ...p, reference }))} />
          <div className="grid gap-4 sm:grid-cols-2">
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
                className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Method</span>
              <select
                value={payment.method}
                onChange={(e) => setPayment((p) => ({ ...p, method: e.target.value }))}
                className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
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
              <div className="mt-1 flex h-11 w-full items-center overflow-hidden rounded-md border border-slate-300 px-3 focus-within:border-lagoon-500 dark:border-slate-600">
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
                className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              />
            </label>
          </div>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="min-h-11 rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500 disabled:opacity-60"
            >
              {busy ? 'Recording…' : 'Record payment'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
