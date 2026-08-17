import { useEffect, useState } from 'react';
import Modal from './Modal';

// The "review before sending" step for every client-facing email this app
// sends (quote send, invoice send/remind, receipt email) — see the
// matching *-preview GET routes in routes/quotes.js/routes/invoices.js.
// Opening the modal fetches the default { to, subject, message } from the
// backend (the same template the send route falls back to), lets the user
// edit subject/message, and only actually sends once they click "Send
// email" — `onSend` does the real POST with the (possibly edited) values.
export default function EmailPreviewModal({ open, onClose, title, loadPreview, onSend, showAttachmentNote = true }) {
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    setLoading(true);
    loadPreview()
      .then((preview) => {
        setTo(preview.to);
        setSubject(preview.subject);
        setMessage(preview.message);
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
      await onSend({ subject, message });
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={title} maxWidthClass="max-w-xl">
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
              onChange={(e) => setSubject(e.target.value)}
              className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Message</span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={8}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            />
          </label>
          {showAttachmentNote && (
            <p className="text-xs text-slate-500 dark:text-slate-400">The PDF is attached automatically — no need to mention it here.</p>
          )}
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
              disabled={sending || !subject.trim() || !message.trim()}
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
