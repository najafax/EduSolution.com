import { useEffect, useState } from 'react';
import Modal from '../Modal';
import { api } from '../../lib/api';

// Each staff member's own email signature. It is added below the cursor when
// they start a new message, reply or forward, and can be edited or removed in
// the message before sending.
export default function SignatureModal({ open, onClose, token, signature, onSaved }) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setText(signature || '');
      setError('');
    }
  }, [open, signature]);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await api.inbox.saveSignature(text, token);
      onSaved(res.signature);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Email signature">
      <form onSubmit={save} className="space-y-3">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Added below your cursor in every new message, reply and forward. Plain text only; you can still edit it in each message.
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          maxLength={2000}
          placeholder={'Best regards,\nYour name\nEdu Solutions Pvt Ltd'}
          className="w-full rounded-2xl border border-slate-300 p-3 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
        />
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="min-h-11 rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60 dark:bg-lagoon-600 dark:hover:bg-lagoon-500"
          >
            {saving ? 'Saving…' : 'Save signature'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
