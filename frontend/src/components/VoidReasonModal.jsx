import { useState } from 'react';
import Modal from './Modal';

// Shared by Quotes.jsx/QuoteDetail.jsx and Invoices.jsx/InvoiceDetail.jsx —
// four callers is well past this app's own "three real duplicates" bar for
// promoting a pattern into a shared component (see CLAUDE.md's own note on
// that convention). Voiding is now the only way to cancel a quote or
// invoice (both routers' DELETE /:id was removed outright), and both
// POST /:id/void routes now require a non-blank `reason` in the body — this
// is the one place that reason gets typed in, modeled directly on
// InvoiceDetail.jsx's own pre-existing "Reject this payment proof" modal
// (same required textarea + Cancel/red-submit footer shape).
export default function VoidReasonModal({ open, onClose, onVoid, title = 'Void this document?', error }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  function handleClose() {
    if (busy) return;
    setReason('');
    onClose();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!reason.trim()) return;
    setBusy(true);
    try {
      await onVoid(reason.trim());
      setReason('');
    } catch {
      // The caller surfaces the failure via the `error` prop — nothing
      // else to do here beyond leaving the modal open so it's visible.
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title={title} maxWidthClass="max-w-md">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label className="block">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Reason for voiding</span>
          <textarea
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="e.g. client cancelled the order, duplicate document, entered in error"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
          />
        </label>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={handleClose}
            disabled={busy}
            className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !reason.trim()}
            className="min-h-11 rounded-md bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-60"
          >
            {busy ? 'Voiding…' : 'Void'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
