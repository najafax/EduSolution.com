import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../lib/useConfirm';
import Modal from '../../components/Modal';
import Pagination from '../../components/Pagination';
import EmptyState from '../../components/EmptyState';
import StatusBadge from '../../components/StatusBadge';
import StatusFilterChips from '../../components/StatusFilterChips';
import { InboxIcon, PlusIcon } from '../../components/icons';

// Automatic replies to client emails. The server reads the Gmail inbox every
// few minutes (lib/clientMail.js), keeps only mail from addresses that belong
// to a client, and drafts a reply from the keyword rules below. In "Drafts
// only" mode nothing is sent until staff click Send here; in "Automatic" mode
// a rule that is ticked "send automatically" replies by itself, everything
// else still waits for approval.
const INPUT =
  'mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white';
const LABEL = 'text-sm font-medium text-slate-700 dark:text-slate-300';
const BTN =
  'min-h-9 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800';
const PRIMARY = 'min-h-9 rounded-md bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-lagoon-600 dark:hover:bg-lagoon-500';

const TABS = [
  { value: 'inbox', label: 'Emails' },
  { value: 'rules', label: 'Reply rules' },
  { value: 'settings', label: 'Settings' },
];
const FILTERS = [
  { value: '', label: 'Needs review' },
  { value: 'sent', label: 'Sent' },
  { value: 'dismissed', label: 'Dismissed' },
  { value: 'ignored', label: 'Ignored' },
];
const PLACEHOLDERS = [
  ['client_name', "the client's name"],
  ['business_name', 'your business name'],
  ['outstanding', 'total they still owe'],
  ['unpaid_invoices', 'list of unpaid invoices'],
  ['overdue_invoices', 'list of overdue invoices'],
  ['licenses_expiring', 'licenses expiring within 30 days'],
  ['invoice_number', 'an invoice number named in their email'],
  ['invoice_balance', 'balance of that invoice'],
  ['invoice_due', 'due date of that invoice'],
  ['invoice_status', 'paid / unpaid / cancelled'],
  ['portal_url', 'link to the client portal'],
];

const when = (t) => (t ? new Date(`${t.replace(' ', 'T')}Z`).toLocaleString() : '');
const EMPTY_RULE = { name: '', keywords: '', subject: '', body: '', auto_send: false, active: true, sort_order: 0 };

export default function ClientMail() {
  const { token, can } = useAuth();
  const { toast } = useToast();
  const canView = can('client_mail', 'view');
  const canManage = can('client_mail', 'manage');
  const { confirm, confirmDialog } = useConfirm();

  const [tab, setTab] = useState('inbox');
  const [error, setError] = useState('');
  const [settings, setSettings] = useState(null);
  const [gmailOk, setGmailOk] = useState(true);

  // Emails
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const [mail, setMail] = useState(null);
  const [open, setOpen] = useState(null); // message being reviewed
  const [draft, setDraft] = useState({ subject: '', body: '' });
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);

  // Rules
  const [rules, setRules] = useState(null);
  const [ruleForm, setRuleForm] = useState(null); // null = closed
  const [ruleId, setRuleId] = useState(null);
  const [ruleError, setRuleError] = useState('');

  // Settings form
  const [mode, setMode] = useState('off');
  const [signature, setSignature] = useState('');

  function loadSettings() {
    api.clientMail
      .settings(token)
      .then((d) => {
        setSettings(d.settings);
        setGmailOk(d.gmailConfigured);
        setMode(d.settings.mode);
        setSignature(d.settings.signature);
      })
      .catch((err) => setError(err.message));
  }
  function loadMail() {
    api.clientMail.list(token, { status: filter, page }).then(setMail).catch((err) => setError(err.message));
  }
  function loadRules() {
    api.clientMail.rules(token).then((d) => setRules(d.rules)).catch((err) => setError(err.message));
  }

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (canView) loadSettings();
  }, [token]);
  useEffect(() => {
    if (canView && tab === 'inbox') loadMail();
  }, [token, tab, filter, page]);
  useEffect(() => {
    if (canView && tab === 'rules') loadRules();
  }, [token, tab]);
  /* eslint-enable react-hooks/exhaustive-deps */

  if (!canView) return <div className="px-4 py-10 text-slate-600 dark:text-slate-300 sm:px-6">You don't have permission to view client replies.</div>;

  function review(m) {
    setOpen(m);
    setDraft({ subject: m.reply_subject, body: m.reply_body });
    setError('');
  }

  async function handleSend() {
    setBusy(true);
    setError('');
    try {
      await api.clientMail.send(open.id, draft, token);
      toast('Reply sent.', { type: 'success' });
      setOpen(null);
      loadMail();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function handleSaveDraft() {
    setBusy(true);
    try {
      await api.clientMail.saveDraft(open.id, draft, token);
      toast('Draft saved.', { type: 'success' });
      setOpen(null);
      loadMail();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function handleDismiss() {
    if (!(await confirm({ title: 'Dismiss this email?', message: 'No reply will be sent. It moves to the Dismissed list.', confirmLabel: 'Dismiss', danger: false }))) return;
    try {
      await api.clientMail.dismiss(open.id, token);
      setOpen(null);
      loadMail();
    } catch (err) {
      setError(err.message);
    }
  }
  async function handleCheckNow() {
    setChecking(true);
    setError('');
    try {
      const r = await api.clientMail.checkNow(token);
      toast(`Checked the inbox: ${r.sent} sent, ${r.drafted} to review, ${r.ignored} ignored.`, { type: 'success' });
      loadMail();
      loadSettings();
    } catch (err) {
      setError(err.message);
      loadSettings();
    } finally {
      setChecking(false);
    }
  }
  async function handleSaveSettings(e) {
    e.preventDefault();
    setError('');
    try {
      const d = await api.clientMail.saveSettings({ mode, signature }, token);
      setSettings(d.settings);
      toast('Settings saved.', { type: 'success' });
    } catch (err) {
      setError(err.message);
    }
  }

  function openRule(rule) {
    setRuleId(rule ? rule.id : null);
    setRuleForm(rule ? { ...rule, auto_send: Boolean(rule.auto_send), active: Boolean(rule.active) } : { ...EMPTY_RULE });
    setRuleError('');
  }
  async function handleSaveRule(e) {
    e.preventDefault();
    setRuleError('');
    try {
      if (ruleId) await api.clientMail.updateRule(ruleId, ruleForm, token);
      else await api.clientMail.createRule(ruleForm, token);
      setRuleForm(null);
      loadRules();
    } catch (err) {
      setRuleError(err.message);
    }
  }
  async function handleDeleteRule(rule) {
    if (!(await confirm({ title: `Delete "${rule.name}"?`, message: 'Emails already drafted from it are not affected.', confirmLabel: 'Delete' }))) return;
    try {
      await api.clientMail.removeRule(rule.id, token);
      loadRules();
    } catch (err) {
      setError(err.message);
    }
  }

  const pending = mail?.pending ?? 0;

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-slate-900 dark:text-white">Client replies</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600 dark:text-slate-300">
            When a client emails you, a reply is drafted from your rules. Only people whose address is on a client record are answered.
          </p>
        </div>
        {canManage && settings && settings.mode !== 'off' && (
          <button type="button" onClick={handleCheckNow} disabled={checking} className={BTN}>
            {checking ? 'Checking…' : 'Check inbox now'}
          </button>
        )}
      </div>

      <div className="mt-4">
        <StatusFilterChips options={TABS.map((t) => (t.value === 'inbox' && pending > 0 ? { ...t, label: `Emails (${pending})` } : t))} value={tab} onChange={setTab} />
      </div>

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {settings?.last_error && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">{settings.last_error}</p>}
      {settings && settings.mode === 'off' && tab === 'inbox' && (
        <p className="mt-3 rounded-xl bg-slate-100 p-3 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">Auto-replies are switched off. Turn them on in Settings.</p>
      )}

      {tab === 'inbox' && (
        <div className="mt-4">
          <StatusFilterChips options={FILTERS} value={filter} onChange={(v) => { setFilter(v); setPage(1); }} />
          <div className="mt-4 rounded-3xl bg-white shadow-sm dark:border dark:border-slate-700 dark:bg-slate-900">
            {!mail ? (
              <p className="p-5 text-sm text-slate-500">Loading…</p>
            ) : mail.messages.length === 0 ? (
              <EmptyState icon={<InboxIcon width={22} height={22} />} title="No emails here" message="Client emails appear here once the inbox has been checked." />
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {mail.messages.map((m) => (
                  <li key={m.id}>
                    <button type="button" onClick={() => review(m)} className="flex w-full flex-wrap items-start justify-between gap-2 px-5 py-4 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{m.subject || '(no subject)'}</p>
                        <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                          {m.client_name || m.from_email} · {when(m.received_at)}
                          {m.rule_name ? ` · rule: ${m.rule_name}` : ''}
                        </p>
                        {m.ignore_reason && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{m.ignore_reason}</p>}
                      </div>
                      <StatusBadge status={m.status === 'draft' ? 'pending' : m.status} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {mail && <Pagination page={mail.page} totalPages={mail.totalPages} onChange={setPage} />}
        </div>
      )}

      {tab === 'rules' && (
        <div className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-2xl text-sm text-slate-600 dark:text-slate-300">
              The first rule (top to bottom) whose keywords appear in the email's subject or text is used. A rule with no keywords is the fallback for everything else.
            </p>
            {canManage && (
              <button type="button" onClick={() => openRule(null)} className={`${PRIMARY} inline-flex items-center gap-1.5`}>
                <PlusIcon width={16} height={16} />
                New rule
              </button>
            )}
          </div>
          <div className="mt-4 rounded-3xl bg-white shadow-sm dark:border dark:border-slate-700 dark:bg-slate-900">
            {!rules ? (
              <p className="p-5 text-sm text-slate-500">Loading…</p>
            ) : rules.length === 0 ? (
              <EmptyState title="No rules yet" message="Add a fallback rule (no keywords) to acknowledge every client email, then specific ones for invoices, renewals and so on." />
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {rules.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">
                        {r.name}
                        {!r.active && <span className="ml-2 text-xs font-normal text-slate-500">(off)</span>}
                        {r.auto_send ? <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">sends automatically</span> : null}
                      </p>
                      <p className="truncate text-xs text-slate-500 dark:text-slate-400">{r.keywords ? `Keywords: ${r.keywords}` : 'Fallback — any email'}</p>
                    </div>
                    {canManage && (
                      <div className="flex gap-1.5">
                        <button type="button" onClick={() => openRule(r)} className={BTN}>Edit</button>
                        <button type="button" onClick={() => handleDeleteRule(r)} className={`${BTN} text-red-600 dark:text-red-400`}>Delete</button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {tab === 'settings' && settings && (
        <form onSubmit={handleSaveSettings} className="mt-4 grid max-w-2xl gap-4 rounded-3xl bg-white p-5 shadow-sm dark:border dark:border-slate-700 dark:bg-slate-900">
          {!gmailOk && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">Gmail is not configured on the server, so incoming mail cannot be read.</p>}
          <fieldset disabled={!canManage} className="grid gap-2">
            <legend className={LABEL}>What should happen when a client emails you?</legend>
            {[
              ['off', 'Off', 'Nothing is read or sent.'],
              ['draft', 'Drafts only (recommended)', 'A reply is prepared for you to check and send.'],
              ['auto', 'Automatic', 'Rules ticked "send automatically" reply on their own. Everything else is left as a draft.'],
            ].map(([v, label, hint]) => (
              <label key={v} className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <input type="radio" name="mode" value={v} checked={mode === v} onChange={() => setMode(v)} className="mt-1" />
                <span>
                  <span className="block text-sm font-medium text-slate-900 dark:text-white">{label}</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">{hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <label className="block">
            <span className={LABEL}>Signature added to every reply</span>
            <textarea rows={3} value={signature} onChange={(e) => setSignature(e.target.value)} disabled={!canManage} placeholder="Kind regards, Edu Solutions" className={INPUT} />
          </label>
          <ul className="list-disc space-y-1 pl-5 text-xs text-slate-500 dark:text-slate-400">
            <li>Only emails that arrive after you switch this on are looked at. Older mail is never answered.</li>
            <li>Replies go only to addresses saved on a client. Newsletters, no-reply senders and other automatic messages are skipped.</li>
            <li>Nobody gets more than one automatic reply in 24 hours.</li>
            {settings.last_checked_at && <li>Inbox last checked {when(settings.last_checked_at)}.</li>}
          </ul>
          {canManage && (
            <div>
              <button type="submit" className={PRIMARY}>Save</button>
            </div>
          )}
        </form>
      )}

      <Modal open={Boolean(open)} onClose={() => setOpen(null)} title={open?.subject || 'Client email'} maxWidthClass="max-w-2xl">
        {open && (
          <div className="grid gap-3">
            <div className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                From {open.from_name ? `${open.from_name} ` : ''}&lt;{open.from_email}&gt; · {when(open.received_at)}
              </p>
              <p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-slate-800 dark:text-slate-100">{open.body_text || '(no text)'}</p>
            </div>
            {open.ignore_reason && <p className="text-xs text-amber-700 dark:text-amber-300">{open.ignore_reason}</p>}
            {open.status === 'draft' ? (
              <>
                <label className="block">
                  <span className={LABEL}>Reply subject</span>
                  <input type="text" value={draft.subject} onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))} disabled={!canManage} className={INPUT} />
                </label>
                <label className="block">
                  <span className={LABEL}>Reply</span>
                  <textarea rows={9} value={draft.body} onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))} disabled={!canManage} className={INPUT} />
                </label>
                {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
                {canManage && (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={handleSend} disabled={busy} className={PRIMARY}>{busy ? 'Sending…' : `Send to ${open.from_email}`}</button>
                    <button type="button" onClick={handleSaveDraft} disabled={busy} className={BTN}>Save draft</button>
                    <button type="button" onClick={handleDismiss} disabled={busy} className={BTN}>Dismiss</button>
                  </div>
                )}
              </>
            ) : open.status === 'sent' ? (
              <div className="rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-700">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Reply sent {when(open.handled_at)} by {open.handled_by_name}
                </p>
                <p className="mt-1 font-medium text-slate-900 dark:text-white">{open.reply_subject}</p>
                <p className="mt-1 whitespace-pre-wrap text-slate-700 dark:text-slate-200">{open.reply_body}</p>
              </div>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">No reply was sent for this email.</p>
            )}
          </div>
        )}
      </Modal>

      <Modal open={Boolean(ruleForm)} onClose={() => setRuleForm(null)} title={ruleId ? 'Edit reply rule' : 'New reply rule'} maxWidthClass="max-w-2xl">
        {ruleForm && (
          <form onSubmit={handleSaveRule} className="grid gap-3">
            <label className="block">
              <span className={LABEL}>Rule name</span>
              <input type="text" required value={ruleForm.name} onChange={(e) => setRuleForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Invoice question" className={INPUT} />
            </label>
            <label className="block">
              <span className={LABEL}>Keywords (comma separated)</span>
              <input type="text" value={ruleForm.keywords} onChange={(e) => setRuleForm((f) => ({ ...f, keywords: e.target.value }))} placeholder="invoice, payment, balance" className={INPUT} />
              <span className="text-xs text-slate-500 dark:text-slate-400">Leave empty to use this rule when no other rule matches.</span>
            </label>
            <label className="block">
              <span className={LABEL}>Subject (optional)</span>
              <input type="text" value={ruleForm.subject} onChange={(e) => setRuleForm((f) => ({ ...f, subject: e.target.value }))} placeholder='Blank = "Re: their subject"' className={INPUT} />
            </label>
            <label className="block">
              <span className={LABEL}>Reply</span>
              <textarea rows={8} required value={ruleForm.body} onChange={(e) => setRuleForm((f) => ({ ...f, body: e.target.value }))} placeholder={'Dear {{client_name}},\n\nThank you for your email…'} className={INPUT} />
            </label>
            <details className="text-xs text-slate-600 dark:text-slate-300">
              <summary className="cursor-pointer font-medium">Details you can insert</summary>
              <ul className="mt-2 grid gap-1">
                {PLACEHOLDERS.map(([k, d]) => (
                  <li key={k}>
                    <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">{`{{${k}}}`}</code> — {d}
                  </li>
                ))}
              </ul>
              <p className="mt-2">If a reply uses an invoice detail the email does not mention, it is held for review instead of being sent automatically.</p>
            </details>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className={LABEL}>Order (lower first)</span>
                <input type="number" value={ruleForm.sort_order} onChange={(e) => setRuleForm((f) => ({ ...f, sort_order: e.target.value }))} className={INPUT} />
              </label>
              <div className="flex flex-col justify-end gap-2 pb-2 text-sm text-slate-700 dark:text-slate-200">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={ruleForm.active} onChange={(e) => setRuleForm((f) => ({ ...f, active: e.target.checked }))} /> Rule is on
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={ruleForm.auto_send} onChange={(e) => setRuleForm((f) => ({ ...f, auto_send: e.target.checked }))} /> Send automatically
                </label>
              </div>
            </div>
            {ruleError && <p className="text-sm text-red-600 dark:text-red-400">{ruleError}</p>}
            <div className="flex gap-3">
              <button type="submit" className={PRIMARY}>Save</button>
              <button type="button" onClick={() => setRuleForm(null)} className={BTN}>Cancel</button>
            </div>
          </form>
        )}
      </Modal>
      {confirmDialog}
    </div>
  );
}
