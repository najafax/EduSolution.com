import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import PageToolbar from '../../components/PageToolbar';
import StatusFilterChips from '../../components/StatusFilterChips';
import SearchInput from '../../components/SearchInput';
import SearchableSelect from '../../components/SearchableSelect';
import Pagination from '../../components/Pagination';
import EmptyState from '../../components/EmptyState';
import ComposeModal from '../../components/inbox/ComposeModal';
import SignatureModal from '../../components/inbox/SignatureModal';
import PageMenu from '../../components/PageMenu';
import { MailIcon, PaperclipIcon, PencilIcon, PlusIcon } from '../../components/icons';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { useConfirm } from '../../lib/useConfirm';
import { formatSize, senderLabel, when } from '../../lib/inboxFormat';

// The in-app mailbox for info@edusolutionsmv.com. Resend receives the mail and
// posts it to the backend (routes/inboxWebhook.js); staff read it here, reply,
// write new messages, forward, and find what they sent in the Sent folder.
// List on the left, the open message on the right from `lg` up; on a phone it
// is the list, then the message with a Back button. Gated on the email_center
// module, like the rest of the email area.

const EMPTY_TEXT = {
  inbox: 'Replies from clients to info@edusolutionsmv.com will appear here.',
  unread: 'No unread messages.',
  sent: 'Messages you send from here will be kept in this folder.',
  archived: 'Nothing archived.',
  spam: 'No spam.',
  trash: 'Trash is empty. Messages here are removed for good after 30 days.',
};

const actionBtn =
  'min-h-9 rounded-full border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800';
const primaryBtn =
  'min-h-9 rounded-full bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-lagoon-600 dark:hover:bg-lagoon-500';

export default function Inbox() {
  const { token, can } = useAuth();
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirm();
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
  const [thread, setThread] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showHtml, setShowHtml] = useState(false);
  const [clients, setClients] = useState(null);
  const [linking, setLinking] = useState(false);

  const [compose, setCompose] = useState(null); // { mode, original } while the compose modal is open
  const [signature, setSignature] = useState('');
  const [signatureOpen, setSignatureOpen] = useState(false);

  const isSent = status === 'sent';

  const load = useCallback(() => {
    const req = isSent
      ? api.inbox.sentList(token, { q: debouncedSearch, page })
      : api.inbox.list(token, { status, q: debouncedSearch, page });
    return req
      .then((d) => {
        setData(d);
        setError('');
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token, status, isSent, debouncedSearch, page]);

  useEffect(() => {
    if (canView) load();
  }, [canView, load]);

  useEffect(() => setPage(1), [status, debouncedSearch]);

  // Switching folder closes whatever was open (it may not exist in the new one).
  useEffect(() => {
    setSelectedId(null);
    setDetail(null);
    setThread([]);
  }, [status]);

  useEffect(() => {
    if (canView) api.inbox.getSignature(token).then((r) => setSignature(r.signature || '')).catch(() => {});
  }, [canView, token]);

  // Pick up new mail without a manual refresh (a light poll while the tab is open).
  useEffect(() => {
    if (!canView) return undefined;
    const t = setInterval(() => {
      if (!document.hidden) load();
    }, 60000);
    return () => clearInterval(t);
  }, [canView, load]);

  function closeDetail() {
    setSelectedId(null);
    setDetail(null);
    setThread([]);
  }

  async function openMessage(id) {
    setSelectedId(id);
    setDetail(null);
    setThread([]);
    setShowHtml(false);
    setLinking(false);
    setDetailLoading(true);
    try {
      if (isSent) {
        const { message } = await api.inbox.sentGet(id, token);
        setDetail(message);
      } else {
        const { message } = await api.inbox.get(id, token);
        setDetail(message);
        setData((d) => d && { ...d, messages: d.messages.map((m) => (m.id === id ? { ...m, is_read: true } : m)) });
        api.inbox.unreadCount(token).then(({ count }) => setData((d) => d && { ...d, unread: count })).catch(() => {});
        api.inbox.thread(id, token).then((r) => setThread(r.items || [])).catch(() => {});
      }
    } catch (err) {
      setError(err.message);
      setSelectedId(null);
    } finally {
      setDetailLoading(false);
    }
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

  function applyUpdate(message) {
    setDetail(message);
    load();
  }

  async function toggleRead() {
    const res = await run(() => api.inbox.setRead(detail.id, !detail.is_read, token));
    if (res) applyUpdate(res.message);
  }

  async function moveOut(fn, okText) {
    const res = await run(fn, okText);
    if (res) {
      closeDetail();
      load();
    }
  }

  const toggleArchive = () =>
    moveOut(() => api.inbox.setArchived(detail.id, !detail.archived, token), detail.archived ? 'Moved back to inbox.' : 'Archived.');
  const toggleSpam = () =>
    moveOut(() => api.inbox.setSpam(detail.id, !detail.spam, token), detail.spam ? 'Moved back to inbox.' : 'Marked as spam.');
  const toggleTrash = () =>
    moveOut(() => api.inbox.setTrashed(detail.id, !detail.trashed, token), detail.trashed ? 'Restored.' : 'Moved to trash.');

  async function deleteForever() {
    const ok = await confirm({
      title: 'Delete forever?',
      message: 'This message will be removed permanently and cannot be recovered.',
      confirmLabel: 'Delete forever',
    });
    if (ok) moveOut(() => api.inbox.deleteForever(detail.id, token), 'Deleted.');
  }

  async function emptyTrash() {
    const ok = await confirm({
      title: 'Empty trash?',
      message: `All ${data ? data.total : ''} messages in trash will be removed permanently and cannot be recovered.`,
      confirmLabel: 'Empty trash',
    });
    if (ok) moveOut(() => api.inbox.emptyTrash(token), 'Trash emptied.');
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

  function handleSent(mode) {
    toast(mode === 'forward' ? 'Message forwarded.' : mode === 'compose' ? 'Message sent.' : 'Reply sent.', { type: 'success' });
    load();
    if (detail && !isSent && (mode === 'reply' || mode === 'replyAll')) {
      api.inbox.get(detail.id, token).then((r) => setDetail(r.message)).catch(() => {});
      api.inbox.thread(detail.id, token).then((r) => setThread(r.items || [])).catch(() => {});
    }
  }

  if (!canView) {
    return <div className="px-4 py-10 text-slate-600 dark:text-slate-300 sm:px-6">You don't have permission to view this page.</div>;
  }

  const messages = data ? data.messages : [];
  const clientOptions = (clients || []).map((c) => ({ value: c.id, label: c.name, sublabel: c.email }));
  const unread = data && data.unread !== undefined ? data.unread : 0;
  const statusOptions = [
    { value: 'inbox', label: 'Inbox' },
    { value: 'unread', label: unread > 0 ? `Unread (${unread})` : 'Unread' },
    { value: 'sent', label: 'Sent' },
    { value: 'archived', label: 'Archived' },
    { value: 'spam', label: data && data.spam > 0 ? `Spam (${data.spam})` : 'Spam' },
    { value: 'trash', label: 'Trash' },
  ];
  const earlier = thread.filter((t) => !(t.direction === 'in' && detail && t.id === detail.id));

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <PageToolbar
        title="Inbox"
        search={<SearchInput value={search} onChange={setSearch} placeholder="Search messages…" />}
        filters={<StatusFilterChips options={statusOptions} value={status} onChange={setStatus} />}
        actions={
          canManage && (
            <>
              <PageMenu items={[{ label: 'Email signature', icon: PencilIcon, onClick: () => setSignatureOpen(true) }]} />
              <button
                type="button"
                onClick={() => setCompose({ mode: 'compose' })}
                className="flex min-h-9 items-center gap-1.5 rounded-full bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-lagoon-600 dark:hover:bg-lagoon-500"
              >
                <PlusIcon width="16" height="16" />
                New message
              </button>
            </>
          )
        }
      />

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        {/* ---------- list ---------- */}
        <div className={`min-w-0 ${selectedId ? 'hidden lg:block' : ''}`}>
          {status === 'trash' && canManage && data && data.total > 0 && (
            <div className="mb-2 flex items-center justify-between rounded-2xl bg-slate-100 px-4 py-2 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <span>Messages in trash are deleted after 30 days.</span>
              <button type="button" onClick={emptyTrash} className="font-medium text-red-600 hover:underline dark:text-red-400">
                Empty trash
              </button>
            </div>
          )}
          <div className="overflow-hidden rounded-3xl bg-white dark:border dark:border-slate-700 dark:bg-slate-900">
            {loading ? (
              <p className="px-5 py-10 text-center text-sm text-slate-500 dark:text-slate-400">Loading…</p>
            ) : messages.length === 0 ? (
              <EmptyState
                icon={<MailIcon />}
                title={debouncedSearch ? 'No messages match your search' : status === 'inbox' ? 'No messages yet' : 'Nothing here'}
                message={debouncedSearch ? undefined : EMPTY_TEXT[status]}
              />
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {messages.map((m) => {
                  const active = m.id === selectedId;
                  const read = isSent || m.is_read;
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
                          <span className={`truncate text-sm ${read ? 'text-slate-700 dark:text-slate-300' : 'font-bold text-slate-900 dark:text-white'}`}>
                            {!read && <span className="mr-2 inline-block h-2 w-2 rounded-full bg-lagoon-600 align-middle" aria-label="Unread" />}
                            {isSent ? `To: ${m.to_emails}` : senderLabel(m)}
                          </span>
                          <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
                            {when(isSent ? m.created_at : m.received_at, { short: true })}
                          </span>
                        </div>
                        <div className={`mt-0.5 truncate text-sm ${read ? 'text-slate-600 dark:text-slate-400' : 'font-semibold text-slate-800 dark:text-slate-200'}`}>
                          {m.subject || '(no subject)'}
                        </div>
                        <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{(m.snippet || '').replace(/\s+/g, ' ')}</div>
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
                          {isSent && m.sent_by_name && <span className="text-xs text-slate-500 dark:text-slate-400">by {m.sent_by_name}</span>}
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
              <EmptyState icon={<MailIcon />} title="Select a message" message="Pick a message on the left to read it." />
            </div>
          ) : detailLoading || !detail ? (
            <div className="rounded-3xl bg-white px-5 py-10 text-center text-sm text-slate-500 dark:border dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
              Loading…
            </div>
          ) : isSent ? (
            <article className="rounded-3xl bg-white p-5 dark:border dark:border-slate-700 dark:bg-slate-900 sm:p-6">
              <button type="button" onClick={closeDetail} className="mb-3 text-sm font-medium text-lagoon-700 hover:underline dark:text-lagoon-300 lg:hidden">
                ← Back to sent
              </button>
              <h2 className="font-display text-xl font-extrabold text-slate-900 dark:text-white">{detail.subject || '(no subject)'}</h2>
              <div className="mt-2 space-y-0.5 text-sm text-slate-600 dark:text-slate-300">
                <div>
                  <span className="font-medium text-slate-900 dark:text-white">To:</span> {detail.to_emails}
                </div>
                {detail.cc_emails && (
                  <div>
                    <span className="font-medium text-slate-900 dark:text-white">Cc:</span> {detail.cc_emails}
                  </div>
                )}
                {detail.bcc_emails && (
                  <div>
                    <span className="font-medium text-slate-900 dark:text-white">Bcc:</span> {detail.bcc_emails}
                  </div>
                )}
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {when(detail.created_at)}
                  {detail.sent_by_name && ` · sent by ${detail.sent_by_name}`}
                  {detail.kind === 'reply' && ' · reply'}
                  {detail.kind === 'forward' && ' · forwarded'}
                </div>
              </div>
              {detail.client_id && (
                <Link
                  to={`/clients?q=${encodeURIComponent(detail.client_name || '')}`}
                  className="mt-3 inline-block rounded-full bg-lagoon-50 px-3 py-1 text-sm font-medium text-lagoon-700 hover:underline dark:bg-lagoon-950 dark:text-lagoon-300"
                >
                  {detail.client_name}
                </Link>
              )}
              <hr className="my-5 border-slate-200 dark:border-slate-700" />
              <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-800 dark:text-slate-200">{detail.text_body}</div>
              {detail.attachments.length > 0 && (
                <div className="mt-5">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Attachments</h3>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {detail.attachments.map((a) => (
                      <li key={a.id}>
                        <button type="button" onClick={() => run(() => api.inbox.downloadSentFile(detail.id, a, token))} className={`${actionBtn} inline-flex items-center gap-1.5`}>
                          <PaperclipIcon width="15" height="15" />
                          <span className="max-w-[16rem] truncate">{a.filename}</span>
                          <span className="text-xs text-slate-500 dark:text-slate-400">{formatSize(a.size)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </article>
          ) : (
            <article className="rounded-3xl bg-white p-5 dark:border dark:border-slate-700 dark:bg-slate-900 sm:p-6">
              <button type="button" onClick={closeDetail} className="mb-3 text-sm font-medium text-lagoon-700 hover:underline dark:text-lagoon-300 lg:hidden">
                ← Back
              </button>

              <h2 className="font-display text-xl font-extrabold text-slate-900 dark:text-white">{detail.subject || '(no subject)'}</h2>
              <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                <span className="font-medium text-slate-900 dark:text-white">{senderLabel(detail)}</span>
                {detail.from_name && detail.from_email && <span> &lt;{detail.from_email}&gt;</span>}
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {when(detail.received_at)}
                  {detail.to_emails && ` · to ${detail.to_emails}`}
                  {detail.cc_emails && ` · cc ${detail.cc_emails}`}
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
                  {detail.from_email && (
                    <button type="button" onClick={() => setCompose({ mode: 'reply', original: detail })} className={primaryBtn}>
                      Reply
                    </button>
                  )}
                  {detail.from_email && detail.reply_all_cc.length > 0 && (
                    <button type="button" onClick={() => setCompose({ mode: 'replyAll', original: detail })} className={actionBtn}>
                      Reply all
                    </button>
                  )}
                  <button type="button" onClick={() => setCompose({ mode: 'forward', original: detail })} className={actionBtn}>
                    Forward
                  </button>
                  <button type="button" onClick={toggleRead} className={actionBtn}>
                    {detail.is_read ? 'Mark unread' : 'Mark read'}
                  </button>
                  {!detail.trashed && !detail.spam && (
                    <button type="button" onClick={toggleArchive} className={actionBtn}>
                      {detail.archived ? 'Move to inbox' : 'Archive'}
                    </button>
                  )}
                  {!detail.trashed && (
                    <button type="button" onClick={toggleSpam} className={actionBtn}>
                      {detail.spam ? 'Not spam' : 'Spam'}
                    </button>
                  )}
                  <button type="button" onClick={toggleTrash} className={actionBtn}>
                    {detail.trashed ? 'Restore' : 'Trash'}
                  </button>
                  {detail.trashed && (
                    <button
                      type="button"
                      onClick={deleteForever}
                      className="min-h-9 rounded-full border border-red-300 px-3 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
                    >
                      Delete forever
                    </button>
                  )}
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
                        <button type="button" onClick={() => run(() => api.inbox.downloadAttachment(detail.id, a, token))} className={`${actionBtn} inline-flex items-center gap-1.5`}>
                          <PaperclipIcon width="15" height="15" />
                          <span className="max-w-[16rem] truncate">{a.filename}</span>
                          {a.size > 0 && <span className="text-xs text-slate-500 dark:text-slate-400">{formatSize(a.size)}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {earlier.length > 0 && (
                <details className="mt-6 rounded-2xl border border-slate-200 dark:border-slate-700">
                  <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-900 dark:text-white">
                    Conversation with {detail.from_name || detail.from_email} ({earlier.length} other {earlier.length === 1 ? 'message' : 'messages'})
                  </summary>
                  <ul className="divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-800 dark:border-slate-800">
                    {earlier.map((t) => (
                      <li key={`${t.direction}-${t.id}`} className="px-4 py-3 text-sm">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="font-medium text-slate-900 dark:text-white">
                            {t.direction === 'out' ? `You (${t.who})` : t.who}
                            {t.direction === 'out' && <span className="ml-2 rounded-full bg-lagoon-50 px-2 py-0.5 text-xs text-lagoon-700 dark:bg-lagoon-950 dark:text-lagoon-300">sent</span>}
                          </span>
                          <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">{when(t.at, { short: true })}</span>
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">{t.subject || '(no subject)'}</div>
                        <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-slate-700 dark:text-slate-300">{t.text}</p>
                        {t.direction === 'in' && (
                          <button type="button" onClick={() => openMessage(t.id)} className="mt-1 text-xs font-medium text-lagoon-700 hover:underline dark:text-lagoon-300">
                            Open this message
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </article>
          )}
        </div>
      </div>

      <ComposeModal
        open={Boolean(compose)}
        onClose={() => setCompose(null)}
        mode={compose ? compose.mode : 'compose'}
        original={compose ? compose.original : undefined}
        signature={signature}
        token={token}
        onSent={handleSent}
      />
      <SignatureModal open={signatureOpen} onClose={() => setSignatureOpen(false)} token={token} signature={signature} onSaved={setSignature} />
      {confirmDialog}
    </div>
  );
}
