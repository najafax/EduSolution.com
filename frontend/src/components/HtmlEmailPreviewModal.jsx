import { useEffect, useState } from 'react';
import Modal from './Modal';

// The read-only counterpart to EmailPreviewModal.jsx — for a send whose
// body is a fixed, designed HTML template (see backend/src/lib/
// licenseRenewalEmail.js) rather than admin-editable plain text, there's
// nothing to edit before sending, just something to look at: To/Subject
// render read-only and the actual HTML renders in a sandboxed <iframe> so
// staff can see exactly what the client will receive before committing.
export default function HtmlEmailPreviewModal({ open, onClose, title, loadPreview, onSend }) {
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [html, setHtml] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    setLoading(true);
    loadPreview()
      .then((preview) => {
        setTo(preview.to);
        setSubject(preview.subject);
        setHtml(preview.html);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    // Only re-fetch when the modal actually opens, not on every render —
    // loadPreview is a fresh closure from the caller each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleSend() {
    setError('');
    setSending(true);
    try {
      await onSend();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={title} maxWidthClass="max-w-2xl">
      {loading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
      ) : (
        <div className="flex flex-col gap-3">
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">To</span>
            <input
              type="text"
              value={to}
              readOnly
              className="mt-1 min-h-11 w-full rounded-md border border-slate-200 bg-slate-50 px-3 text-base text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Subject</span>
            <input
              type="text"
              value={subject}
              readOnly
              className="mt-1 min-h-11 w-full rounded-md border border-slate-200 bg-slate-50 px-3 text-base text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400"
            />
          </label>
          <div>
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Preview</span>
            <iframe
              title="Email preview"
              srcDoc={html}
              sandbox=""
              className="mt-1 h-96 w-full rounded-md border border-slate-200 bg-white dark:border-slate-700"
            />
          </div>
          <div className="mt-1 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={sending}
              className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || loading}
              className="min-h-11 rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500 disabled:opacity-60"
            >
              {sending ? 'Sending…' : 'Send email'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
