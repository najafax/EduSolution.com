import { useEffect, useRef, useState } from 'react';
import Modal from '../Modal';
import { PaperclipIcon, SendIcon, XIcon } from '../icons';
import { api } from '../../lib/api';
import { MAX_ATTACH_BYTES, MAX_ATTACH_FILES, formatSize, readAttachment } from '../../lib/inboxFormat';

// One form for everything the Inbox sends: a new message, a reply, a reply to
// everyone, or a forward. The caller says which (`mode`) and passes the
// original message for the last three; the form pre-fills To/Cc/Subject, adds
// the sender's signature below the cursor, and sends through the matching API
// call. Nothing is sent until "Send" is pressed.
const MODES = {
  compose: { title: 'New message', send: 'Send' },
  reply: { title: 'Reply', send: 'Send reply' },
  replyAll: { title: 'Reply to all', send: 'Send reply' },
  forward: { title: 'Forward', send: 'Forward' },
};

const field =
  'mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white';

export default function ComposeModal({ open, onClose, mode = 'compose', original, signature = '', token, onSent }) {
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [files, setFiles] = useState([]);
  const [includeOriginal, setIncludeOriginal] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const messageRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const base = (original && original.subject.trim()) || '(no subject)';
    let nextTo = '';
    let nextCc = '';
    let nextSubject = '';
    if (mode === 'reply' || mode === 'replyAll') {
      nextTo = original.from_email;
      nextCc = mode === 'replyAll' ? (original.reply_all_cc || []).join(', ') : '';
      nextSubject = /^re:/i.test(base) ? base : `Re: ${base}`;
    } else if (mode === 'forward') {
      nextSubject = /^fwd?:/i.test(base) ? base : `Fwd: ${base}`;
    }
    setTo(nextTo);
    setCc(nextCc);
    setBcc('');
    setShowCc(Boolean(nextCc));
    setSubject(nextSubject);
    setMessage(signature ? `\n\n${signature}` : '');
    setFiles([]);
    setIncludeOriginal(true);
    setError('');
    setSending(false);
    // Cursor at the top, above the signature.
    const t = setTimeout(() => {
      const el = messageRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(0, 0);
      }
    }, 50);
    return () => clearTimeout(t);
  }, [open, mode, original, signature]);

  const totalBytes = files.reduce((n, f) => n + f.size, 0);

  async function addFiles(e) {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    if (picked.length === 0) return;
    setError('');
    if (files.length + picked.length > MAX_ATTACH_FILES) {
      setError(`At most ${MAX_ATTACH_FILES} attachments per message.`);
      return;
    }
    if (totalBytes + picked.reduce((n, f) => n + f.size, 0) > MAX_ATTACH_BYTES) {
      setError(`Attachments are too large (${formatSize(MAX_ATTACH_BYTES)} in total).`);
      return;
    }
    try {
      const read = await Promise.all(picked.map(readAttachment));
      setFiles((prev) => [...prev, ...read]);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!to.trim()) {
      setError('Add at least one recipient in To.');
      return;
    }
    if (mode !== 'forward' && !message.trim() && files.length === 0) {
      setError('Write a message first.');
      return;
    }
    const payload = {
      to,
      cc,
      bcc,
      subject,
      message,
      attachments: files.map(({ filename, content_type, data }) => ({ filename, content_type, data })),
    };
    setSending(true);
    try {
      let result;
      if (mode === 'compose') result = await api.inbox.compose(payload, token);
      else if (mode === 'forward') {
        result = await api.inbox.forward(original.id, { ...payload, include_attachments: includeOriginal }, token);
      } else result = await api.inbox.reply(original.id, payload, token);
      onSent?.(mode, result);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  const copy = MODES[mode] || MODES.compose;
  const originalAttachmentCount = original && original.attachments ? original.attachments.length : 0;

  return (
    <Modal open={open} onClose={sending ? undefined : onClose} title={copy.title} maxWidthClass="max-w-2xl">
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <div className="flex items-center justify-between">
            <label htmlFor="mail-to" className="text-sm font-medium text-slate-700 dark:text-slate-300">
              To
            </label>
            {!showCc && (
              <button type="button" onClick={() => setShowCc(true)} className="text-sm font-medium text-lagoon-700 hover:underline dark:text-lagoon-300">
                Cc / Bcc
              </button>
            )}
          </div>
          <input
            id="mail-to"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="name@example.com, another@example.com"
            autoComplete="off"
            className={field}
          />
        </div>

        {showCc && (
          <>
            <div>
              <label htmlFor="mail-cc" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Cc
              </label>
              <input id="mail-cc" value={cc} onChange={(e) => setCc(e.target.value)} autoComplete="off" className={field} />
            </div>
            <div>
              <label htmlFor="mail-bcc" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Bcc <span className="font-normal text-slate-500 dark:text-slate-400">(hidden from the other recipients)</span>
              </label>
              <input id="mail-bcc" value={bcc} onChange={(e) => setBcc(e.target.value)} autoComplete="off" className={field} />
            </div>
          </>
        )}

        <div>
          <label htmlFor="mail-subject" className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Subject
          </label>
          <input id="mail-subject" value={subject} onChange={(e) => setSubject(e.target.value)} className={field} />
        </div>

        <div>
          <label htmlFor="mail-message" className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Message
          </label>
          <textarea id="mail-message" ref={messageRef} value={message} onChange={(e) => setMessage(e.target.value)} rows={9} className={`${field} rounded-2xl`} />
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Sent from info@edusolutionsmv.com. Replies come back to this Inbox.
            {(mode === 'reply' || mode === 'replyAll') && ' The original message is quoted below your text.'}
          </p>
        </div>

        {mode === 'forward' && originalAttachmentCount > 0 && (
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={includeOriginal} onChange={(e) => setIncludeOriginal(e.target.checked)} />
            Include the original {originalAttachmentCount === 1 ? 'attachment' : `${originalAttachmentCount} attachments`}
          </label>
        )}

        <div>
          <label className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
            <PaperclipIcon width="15" height="15" />
            Attach files
            <input type="file" multiple onChange={addFiles} className="sr-only" />
          </label>
          <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">Up to {MAX_ATTACH_FILES} files, {formatSize(MAX_ATTACH_BYTES)} in total.</span>
          {files.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-2">
              {files.map((f, i) => (
                <li key={`${f.filename}-${i}`} className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 py-1 pl-3 pr-1.5 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  <span className="max-w-[14rem] truncate">{f.filename}</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">{formatSize(f.size)}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${f.filename}`}
                    onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                    className="rounded-full p-1 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700"
                  >
                    <XIcon width="12" height="12" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={sending}
            className="flex min-h-11 items-center gap-2 rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60 dark:bg-lagoon-600 dark:hover:bg-lagoon-500"
          >
            <SendIcon width="16" height="16" />
            {sending ? 'Sending…' : copy.send}
          </button>
        </div>
      </form>
    </Modal>
  );
}
