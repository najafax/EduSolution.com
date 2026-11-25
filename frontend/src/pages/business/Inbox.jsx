import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import PageToolbar from '../../components/PageToolbar';
import StatusFilterChips from '../../components/StatusFilterChips';
import SearchInput from '../../components/SearchInput';
import SearchableSelect from '../../components/SearchableSelect';
import Pagination from '../../components/Pagination';
import EmptyState from '../../components/EmptyState';
import { MailIcon, PaperclipIcon, SendIcon } from '../../components/icons';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useDebouncedValue } from '../../lib/useDebouncedValue';

// Client replies that arrive at info@edusolutionsmv.com. Resend receives the
// mail and posts it to the backend (see routes/inboxWebhook.js); this page
// reads what was stored. List on the left, the open message on the right from
// `lg` up; on a phone it is the list, then the message with a Back button.
// Gated on the email_center module, like the rest of the email area.

const STATUS_OPTIONS = [
  { value: 'inbox', label: 'Inbox' },
  { value: 'unread', label: 'Unread' },
  { value: 'archived', label: 'Archived' },
];

// received_at is stored as UTC "YYYY-MM-DD HH:MM:SS"; show it in Maldives time.
function when(sqlTime, { short = false } = {}) {
  if (!sqlTime) return '';
  const d = new Date(`${sqlTime.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return sqlTime;
  const opts = short
    ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }
    : { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false };
  return d.toLocaleString('en-GB', { timeZone: 'Indian/Maldives', ...opts });
}

function senderLabel(m) {
  return m.from_name || m.from_email || 'Unknown sender';
}

export default function Inbox() {
  const { token, can } = useAuth();
  const { toast } = useToast();
  const canView = can('email_center', 'view');
  const canManage = can('email_center', 'manage');

  const [status, setStatus] = useState('inbox');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showHtml, setShowHtml] = useState(false);

  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [clients, setClients] = useState(null);
  const [linking, setLinking] = useState(false);

  const load = useCallback(() => {
    return api.inbox
      .list(token, { status, q: debouncedSearch, page })
      .then((d) => {
        setData(d);
        setError('');
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token, status, debouncedSearch, page]);

  useEffect(() => {
    if (canView) load();
  }, [canView, load]);

  useEffect(() => setPage(1), [status, debouncedSearch]);

  // Pick up new mail without a manual refresh (a light poll while the tab is open).
  useEffect(() => {
    if (!canView) return undefined;
    const t = setInterval(() => {
      if (!document.hidden) load();
    }, 60000);
    return () => clearInterval(t);
  }, [canView, load]);

  async function openMessage(id) {
    setSelectedId(id);
    setDetail(null);
    setShowHtml(false);
    setReply('');
    setLinking(false);
    setDetailLoading(true);
    try {
      const { message } = await api.inbox.get(id, token);
      setDetail(message);
      setData((d) => d && { ...d, messages: d.messages.map((m) => (m.id === id ? { ...m, is_read: true } : m)) });
      api.inbox.unreadCount(token).then(({ count }) => setData((d) => d && { ...d, unread: count })).catch(() => {});
    } catch (err) {
      setError(err.message);
      setSelectedId(null);
    } finally {
      setDetailLoading(false);
    }
  }

  function applyUpdate(message, refreshList = true) {
    setDetail(message);
    if (refreshList) load();
  }

  async function run(fn, okText) {
    try {
      const res = await fn();
      if (okText) toast(okText, { type: 'success' });
      return res;
    } catch (err) {
      toast(err.message, { type: 'error' });
      return null;
    }
  }

  async function toggleRead() {
    const res = await run(() => api.inbox.setRead(detail.id, !detail.is_read, token));
    if (res) applyUpdate(res.message);
  }

  async function toggleArchive() {
    const res = await run(() => api.inbox.setArchived(detail.id, !detail.archived, token), detail.archived ? 'Moved back to inbox.' : 'Archived.');
    if (res) {
      setSelectedId(null);
      setDetail(null);
      load();
    }
  }

  async function reload() {
    const res = await run(() => api.inbox.reload(detail.id, token));
    if (res) applyUpdate(res.message);
  }

  async function startLinking() {
    setLinking(true);
    if (!clients) {
      try {
        const { clients: list } = await api.clients.list(token);
        setClients(list);
      } catch (err) {
        toast(err.message, { type: 'error' });
        setLinking(false);
      }
    }
  }

  async function linkClient(clientId) {
    const res = await run(() => api.inbox.setClient(detail.id, clientId, token), 'Client updated.');
    if (res) {
      setLinking(false);
      applyUpdate(res.message);
    }
  }

  async function sendReply(e) {
    e.preventDefault();
    if (!reply.trim()) return;
    setSending(true);
    const res = await run(() => api.inbox.reply(detail.id, reply, token), 'Reply sent.');
    setSending(false);
    if (res) {
      setReply('');
      applyUpdate(res.message);
    }
  }

  if (!canView) {
    return <div className="px-4 py-10 text-slate-600 dark:text-slate-300 sm:px-6">You don't have permission to view this page.</div>;
  }

  const messages = data ? data.messages : [];
  const clientOptions = (clients || []).map((c) => ({ value: c.id, label: c.name, sublabel: c.email }));

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <PageToolbar
        title="Inbox"
        search={<SearchInput value={search} onChange={setSearch} placeholder="Search messages…" />}
        filters={<StatusFilterChips options={STATUS_OPTIONS} value={status} onChange={setStatus} />}
      />

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        {/* ---------- list ---------- */}
        <div className={`min-w-0 ${selectedId ? 'hidden lg:block' : ''}`}>
          <div className="overflow-hidden rounded-3xl bg-white dark:border dark:border-slate-700 dark:bg-slate-900">
            {loading ? (
              <p className="px-5 py-10 text-center text-sm text-slate-500 dark:text-slate-400">Loading…</p>
            ) : messages.length === 0 ? (
              <EmptyState
                icon={<MailIcon />}
                title={debouncedSearch ? 'No messages match your search' : status === 'archived' ? 'Nothing archived' : 'No messages yet'}
                message={
                  debouncedSearch || status !== 'inbox'
                    ? undefined
                    : 'Replies from clients to info@edusolutionsmv.com will appear here.'
                }
              />
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {messages.map((m) => {
                  const active = m.id === selectedId;
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => openMessage(m.id)}
                        className={`block w-full px-5 py-3.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800 ${
                          active ? 'bg-slate-50 dark:bg-slate-800' : ''
                        }`}
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <span className={`truncate text-sm ${m.is_read ? 'text-slate-700 dark:text-slate-300' : 'font-bold text-slate-900 dark:text-white'}`}>
                            {!m.is_read && <span className="mr-2 inline-block h-2 w-2 rounded-full bg-lagoon-600 align-middle" aria-label="Unread" />}
                            {senderLabel(m)}
                          </span>
                          <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">{when(m.received_at, { short: true })}</span>
                        </div>
                        <div className={`mt-0.5 truncate text-sm ${m.is_read ? 'text-slate-600 dark:text-slate-400' : 'font-semibold text-slate-800 dark:text-slate-200'}`}>
                          {m.subject || '(no subject)'}
                        </div>
                        <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{m.snippet.replace(/\s+/g, ' ')}</div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          {m.client_name && (
                            <span className="rounded-full bg-lagoon-50 px-2 py-0.5 text-xs font-medium text-lagoon-700 dark:bg-lagoon-950 dark:text-lagoon-300">
                              {m.client_name}
                            </span>
                          )}
                          {m.attachment_count > 0 && (
                            <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                              <PaperclipIcon width="13" height="13" /> {m.attachment_count}
                            </span>
                          )}
                          {m.replied_at && <span className="text-xs text-emerald-700 dark:text-emerald-400">Replied</span>}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {data && <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />}
        </div>

        {/* ---------- open message ---------- */}
        <div className={`min-w-0 ${selectedId ? '' : 'hidden lg:block'}`}>
          {!selectedId ? (
            <div className="rounded-3xl bg-white dark:border dark:border-slate-700 dark:bg-slate-900">
              <EmptyState icon={<MailIcon />} title="Select a message" message="Pick a message on the left to read it and reply." />
            </div>
          ) : detailLoading || !detail ? (
            <div className="rounded-3xl bg-white px-5 py-10 text-center text-sm text-slate-500 dark:border dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
              Loading…
            </div>
          ) : (
            <article className="rounded-3xl bg-white p-5 dark:border dark:border-slate-700 dark:bg-slate-900 sm:p-6">
              <button
                type="button"
                onClick={() => {
                  setSelectedId(null);
                  setDetail(null);
                }}
                className="mb-3 text-sm font-medium text-lagoon-700 hover:underline dark:text-lagoon-300 lg:hidden"
              >
                ← Back to inbox
              </button>

              <h2 className="font-display text-xl font-extrabold text-slate-900 dark:text-white">{detail.subject || '(no subject)'}</h2>
              <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                <span className="font-medium text-slate-900 dark:text-white">{senderLabel(detail)}</span>
                {detail.from_name && detail.from_email && <span> &lt;{detail.from_email}&gt;</span>}
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {when(detail.received_at)}
                  {detail.to_emails && ` · to ${detail.to_emails}`}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                {detail.client_id ? (
                  <Link
                    to={`/clients?q=${encodeURIComponent(detail.client_name || '')}`}
                    className="rounded-full bg-lagoon-50 px-3 py-1 font-medium text-lagoon-700 hover:underline dark:bg-lagoon-950 dark:text-lagoon-300"
                  >
                    {detail.client_name}
                  </Link>
                ) : (
                  <span className="text-slate-500 dark:text-slate-400">Not linked to a client</span>
                )}
                {canManage && !linking && (
                  <button type="button" onClick={startLinking} className="font-medium text-lagoon-700 hover:underline dark:text-lagoon-300">
                    {detail.client_id ? 'Change client' : 'Link to a client'}
                  </button>
                )}
                {detail.replied_at && (
                  <span className="text-emerald-700 dark:text-emerald-400">
                    Replied {when(detail.replied_at, { short: true })}
                    {detail.replied_by_name ? ` by ${detail.replied_by_name}` : ''}
                  </span>
                )}
              </div>
              {linking && clients && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <div className="w-full max-w-xs">
                    <SearchableSelect options={clientOptions} value={detail.client_id || ''} onChange={(v) => linkClient(v)} placeholder="Search clients…" />
                  </div>
                  {detail.client_id && (
                    <button type="button" onClick={() => linkClient(null)} className="text-sm text-red-600 hover:underline dark:text-red-400">
                      Unlink
                    </button>
                  )}
                  <button type="button" onClick={() => setLinking(false)} className="text-sm text-slate-500 hover:underline dark:text-slate-400">
                    Cancel
                  </button>
                </div>
              )}

              {canManage && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={toggleRead}
                    className="min-h-9 rounded-full border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    {detail.is_read ? 'Mark unread' : 'Mark read'}
                  </button>
                  <button
                    type="button"
                    onClick={toggleArchive}
                    className="min-h-9 rounded-full border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    {detail.archived ? 'Move to inbox' : 'Archive'}
                  </button>
                </div>
              )}

              <hr className="my-5 border-slate-200 dark:border-slate-700" />

              {detail.body_error && !detail.body_loaded && (
                <div className="mb-4 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                  <p className="font-medium">The message text could not be loaded.</p>
                  <p className="mt-1 break-words">{detail.body_error}</p>
                  {canManage && (
                    <button type="button" onClick={reload} className="mt-2 font-medium underline">
                      Try again
                    </button>
                  )}
                </div>
              )}
              {!detail.body_loaded && !detail.body_error && (
                <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">The message text is still being fetched. Check again in a moment.</p>
              )}

              {showHtml && detail.html_body ? (
                <iframe
                  title="Original message"
                  sandbox=""
                  referrerPolicy="no-referrer"
                  srcDoc={detail.html_body}
                  className="h-96 w-full rounded-xl border border-slate-200 bg-white dark:border-slate-700"
                />
              ) : (
                <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-800 dark:text-slate-200">
                  {detail.text_body || (detail.body_loaded ? '(empty message)' : '')}
                </div>
              )}
              {detail.html_body && (
                <button type="button" onClick={() => setShowHtml((v) => !v)} className="mt-3 text-sm font-medium text-lagoon-700 hover:underline dark:text-lagoon-300">
                  {showHtml ? 'Show plain text' : 'Show original formatting'}
                </button>
              )}

              {detail.attachments.length > 0 && (
                <div className="mt-5">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Attachments</h3>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {detail.attachments.map((a) => (
                      <li key={a.id}>
                        <button
                          type="button"
                          onClick={() => run(() => api.inbox.downloadAttachment(detail.id, a, token))}
                          className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-slate-300 px-3 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                          <PaperclipIcon width="15" height="15" />
                          <span className="max-w-[16rem] truncate">{a.filename}</span>
                          {a.size > 0 && <span className="text-xs text-slate-500 dark:text-slate-400">{Math.max(1, Math.round(a.size / 1024))} KB</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {canManage && detail.from_email && (
                <form onSubmit={sendReply} className="mt-6">
                  <label htmlFor="inbox-reply" className="text-sm font-semibold text-slate-900 dark:text-white">
                    Reply to {detail.from_email}
                  </label>
                  <textarea
                    id="inbox-reply"
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    rows={5}
                    placeholder="Write your reply…"
                    className="mt-2 w-full rounded-2xl border border-slate-300 p-3 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                  />
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Sent from info@edusolutionsmv.com. The original message is quoted below your text.</p>
                  <button
                    type="submit"
                    disabled={sending || !reply.trim()}
                    className="mt-3 flex min-h-11 items-center gap-2 rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-lagoon-600 dark:hover:bg-lagoon-500"
                  >
                    <SendIcon width="16" height="16" />
                    {sending ? 'Sending…' : 'Send reply'}
                  </button>
                </form>
              )}
            </article>
          )}
        </div>
      </div>
    </div>
  );
}
