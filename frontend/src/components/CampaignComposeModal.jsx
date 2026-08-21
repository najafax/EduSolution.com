import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import Modal from './Modal';
import SearchInput from './SearchInput';

// The single shared compose UI behind both the Campaigns page's "New
// campaign" button (bulk — every client, or a hand-picked subset) and
// Clients.jsx's per-row "Send campaign email" action (a fixed single
// recipient) — see routes/campaigns.js's own doc comment for why "single &
// bulk" is really one action underneath: a single-recipient send is just
// recipientType: 'selected' with one clientId. Unlike EmailPreviewModal,
// there's no pre-filled default subject/message to preview — a campaign is
// original per-send copy, not a templated transactional email — so this
// starts blank instead of fetching a preview on open.
export default function CampaignComposeModal({ open, onClose, token, singleClient, onSent }) {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [recipientMode, setRecipientMode] = useState('all'); // 'all' | 'selected' — ignored when singleClient is set
  const [allClients, setAllClients] = useState([]);
  const [loadingClients, setLoadingClients] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [clientSearch, setClientSearch] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setSubject('');
    setMessage('');
    setError('');
    setClientSearch('');
    if (singleClient) return;
    setRecipientMode('all');
    setSelectedIds(new Set());
    setLoadingClients(true);
    // The full, unpaginated client list — same "no q/page means the whole
    // array" convention LineItemsEditor's own product picker relies on —
    // so the picker isn't limited to whatever page Clients.jsx happens to
    // be showing.
    api.clients
      .list(token)
      .then(({ clients }) => setAllClients(clients))
      .catch((err) => setError(err.message))
      .finally(() => setLoadingClients(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, singleClient?.id]);

  const emailedClients = useMemo(() => allClients.filter((c) => c.email && c.email.trim()), [allClients]);
  const filteredClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    if (!q) return emailedClients;
    return emailedClients.filter((c) => `${c.name} ${c.email}`.toLowerCase().includes(q));
  }, [emailedClients, clientSearch]);

  const recipientCount = singleClient ? 1 : recipientMode === 'all' ? emailedClients.length : selectedIds.size;

  function toggleClient(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllFiltered() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      filteredClients.forEach((c) => next.add(c.id));
      return next;
    });
  }

  function clearAllFiltered() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      filteredClients.forEach((c) => next.delete(c.id));
      return next;
    });
  }

  const canSend =
    subject.trim() &&
    message.trim() &&
    !sending &&
    (singleClient ? true : recipientMode === 'all' ? emailedClients.length > 0 : selectedIds.size > 0);

  async function handleSend() {
    setError('');
    setSending(true);
    try {
      const payload = {
        subject: subject.trim(),
        message: message.trim(),
        recipientType: singleClient ? 'selected' : recipientMode,
        clientIds: singleClient ? [singleClient.id] : recipientMode === 'selected' ? [...selectedIds] : undefined,
      };
      const result = await api.campaigns.send(payload, token);
      onSent?.(result);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={singleClient ? `Send email to ${singleClient.name}` : 'New campaign'}
      maxWidthClass="max-w-2xl"
    >
      <div className="flex flex-col gap-3">
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        {singleClient ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            To: <span className="font-medium text-slate-900 dark:text-white">{singleClient.name}</span> ({singleClient.email})
          </p>
        ) : (
          <div>
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Recipients</span>
            <div className="mt-1 flex gap-2">
              <button
                type="button"
                onClick={() => setRecipientMode('all')}
                className={`min-h-9 rounded-full border px-3 text-sm font-medium ${
                  recipientMode === 'all'
                    ? 'border-lagoon-600 bg-lagoon-50 text-lagoon-700 dark:border-lagoon-500 dark:bg-lagoon-950/50 dark:text-lagoon-300'
                    : 'border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                All clients
              </button>
              <button
                type="button"
                onClick={() => setRecipientMode('selected')}
                className={`min-h-9 rounded-full border px-3 text-sm font-medium ${
                  recipientMode === 'selected'
                    ? 'border-lagoon-600 bg-lagoon-50 text-lagoon-700 dark:border-lagoon-500 dark:bg-lagoon-950/50 dark:text-lagoon-300'
                    : 'border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                Select clients
              </button>
            </div>

            {recipientMode === 'selected' && (
              <div className="mt-2 rounded-md border border-slate-200 p-2 dark:border-slate-700">
                <SearchInput value={clientSearch} onChange={setClientSearch} placeholder="Search clients…" />
                {loadingClients ? (
                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Loading clients…</p>
                ) : (
                  <>
                    <div className="mt-2 flex gap-3 text-xs">
                      <button type="button" onClick={selectAllFiltered} className="font-medium text-lagoon-600 hover:text-lagoon-500">
                        Select all{clientSearch ? ' matching' : ''}
                      </button>
                      <button type="button" onClick={clearAllFiltered} className="font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400">
                        Clear{clientSearch ? ' matching' : ''}
                      </button>
                    </div>
                    <div className="mt-2 max-h-48 overflow-y-auto">
                      {filteredClients.length === 0 ? (
                        <p className="px-1 py-2 text-sm text-slate-500 dark:text-slate-400">No clients with an email address match.</p>
                      ) : (
                        filteredClients.map((c) => (
                          <label key={c.id} className="flex min-h-9 items-center gap-2 px-1 text-sm">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(c.id)}
                              onChange={() => toggleClient(c.id)}
                              className="h-4 w-4 rounded border-slate-300 text-lagoon-600 focus:ring-lagoon-500"
                            />
                            <span className="text-slate-900 dark:text-white">{c.name}</span>
                            <span className="truncate text-slate-500 dark:text-slate-400">{c.email}</span>
                          </label>
                        ))
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {recipientMode === 'all' && !loadingClients && emailedClients.length === 0 && (
              <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">No clients have an email address on file yet.</p>
            )}
          </div>
        )}

        <p className="text-sm text-slate-600 dark:text-slate-400">
          This will be sent to <span className="font-medium text-slate-900 dark:text-white">{recipientCount}</span>{' '}
          client{recipientCount === 1 ? '' : 's'}.
        </p>

        <label className="block">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Subject</span>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g. New services for the new school year"
            className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Message</span>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={8}
            placeholder="Write your message… blank lines start a new paragraph."
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
        </label>
        <p className="text-xs text-slate-500 dark:text-slate-400">Plain text only — no attachments. Links are made clickable automatically.</p>

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
            disabled={!canSend}
            className="min-h-11 rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500 disabled:opacity-60"
          >
            {sending ? 'Sending…' : `Send${recipientCount > 1 ? ` to ${recipientCount}` : ''}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
