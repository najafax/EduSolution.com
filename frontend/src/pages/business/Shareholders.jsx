import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../lib/useConfirm';
import Modal from '../../components/Modal';
import FloatingActionButton from '../../components/FloatingActionButton';
import { TableSkeleton } from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import MobileListAccordion from '../../components/MobileListAccordion';
import IconActionButton from '../../components/IconActionButton';
import { UsersIcon, PlusIcon, PencilIcon, TrashIcon, SendIcon } from '../../components/icons';

// The recipient list behind the automated daily-earnings email (see
// lib/dailyEarningsReport.js on the backend) — no pagination or search,
// same "a small, standalone list doesn't need it" call this app already
// makes for comparably small per-entity lists (routes/licenses.js's own
// GET /:id/renewals). A shareholder is just a name + email + active flag,
// not a login account, so this form is deliberately thinner than Users.jsx.
const EMPTY_FORM = { name: '', email: '', active: true, ownership_percent: '' };

export default function Shareholders() {
  const { token, can } = useAuth();
  const { toast } = useToast();
  const canManage = can('financials', 'manage');
  const [shareholders, setShareholders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sendingReport, setSendingReport] = useState(false);
  const [reportNotice, setReportNotice] = useState('');

  const { confirm, confirmDialog } = useConfirm();

  function load() {
    api.shareholders
      .list(token)
      .then(({ shareholders }) => setShareholders(shareholders))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [token]);

  function startCreate() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(true);
  }

  function startEdit(shareholder) {
    setForm({
      name: shareholder.name,
      email: shareholder.email,
      active: Boolean(shareholder.active),
      ownership_percent: shareholder.ownership_percent,
    });
    setEditingId(shareholder.id);
    setShowForm(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (editingId) {
        await api.shareholders.update(editingId, form, token);
        toast('Shareholder updated.', { type: 'success' });
      } else {
        await api.shareholders.create(form, token);
        toast('Shareholder added.', { type: 'success' });
      }
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(shareholder) {
    if (!(await confirm({ title: `Remove ${shareholder.name}?`, message: 'They will no longer receive the daily earnings report.', confirmLabel: 'Remove' }))) return;
    try {
      await api.shareholders.remove(shareholder.id, token);
      toast('Shareholder removed.', { type: 'success' });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSendReport() {
    setReportNotice('');
    setError('');
    setSendingReport(true);
    try {
      const result = await api.shareholders.sendReport(token);
      if (result.skipped) {
        setReportNotice(
          result.reason === 'no_earnings'
            ? "No payments were received yesterday, so nothing was sent — this matches what tomorrow morning's automatic run would also do."
            : result.reason === 'no_recipients'
              ? 'No active shareholders to send to — add one below first.'
              : 'Email is not configured for this app, so nothing could be sent.',
        );
      } else {
        setReportNotice(`Sent to ${result.sent} shareholder(s) for ${result.date}.`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSendingReport(false);
    }
  }

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Shareholders</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Who gets the automated daily earnings report — sent every morning, only on a day a payment was actually received.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage && (
            <button
              onClick={handleSendReport}
              disabled={sendingReport}
              className="flex min-h-11 items-center gap-1.5 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <SendIcon width={16} height={16} />
              {sendingReport ? 'Sending…' : "Send yesterday's report now"}
            </button>
          )}
          {canManage && (
            <button
              onClick={startCreate}
              className="flex min-h-11 items-center gap-1.5 rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500"
            >
              <PlusIcon width={16} height={16} />
              New shareholder
            </button>
          )}
        </div>
      </div>

      {reportNotice && <p className="mt-4 text-sm text-lagoon-700 dark:text-lagoon-300">{reportNotice}</p>}
      {error && !showForm && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <Modal open={showForm} onClose={() => setShowForm(false)} title={editingId ? 'Edit shareholder' : 'New shareholder'} maxWidthClass="max-w-lg">
        <form onSubmit={handleSubmit} className="grid gap-3">
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Name</span>
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Email</span>
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Ownership (%)</span>
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={form.ownership_percent}
              onChange={(e) => setForm((f) => ({ ...f, ownership_percent: e.target.value }))}
              placeholder="0"
              className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            />
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              This shareholder's cut of a deal's net profit when distributed — see the Deals page.
            </p>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
              className="h-4 w-4 rounded border-slate-300 text-lagoon-600 focus:ring-lagoon-500 dark:border-slate-600"
            />
            <span className="text-sm text-slate-700 dark:text-slate-300">Active — receives the daily earnings report</span>
          </label>
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="min-h-11 rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500 disabled:opacity-60"
            >
              {submitting ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      <div className="mt-6 rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        {loading ? (
          <div className="overflow-x-auto">
            <TableSkeleton rows={3} cols={canManage ? ['w-40', 'w-56', 'w-16', 'w-20', 'w-16'] : ['w-40', 'w-56', 'w-16', 'w-20']} />
          </div>
        ) : shareholders.length === 0 ? (
          <EmptyState
            icon={<UsersIcon />}
            title="No shareholders yet."
            message={canManage ? 'Add a shareholder to start sending them the daily earnings report.' : undefined}
            action={canManage ? { label: 'New shareholder', onClick: startCreate } : undefined}
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto sm:block">
              <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Email</th>
                    <th className="px-4 py-3 text-right">Ownership</th>
                    <th className="px-4 py-3">Status</th>
                    {canManage && <th className="px-4 py-3" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {shareholders.map((s) => (
                    <tr key={s.id}>
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900 dark:text-white">{s.name}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-400">{s.email}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-slate-900 dark:text-white">
                        {s.ownership_percent ? `${s.ownership_percent}%` : '—'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                            s.active
                              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                              : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                          }`}
                        >
                          {s.active ? 'Active' : 'Paused'}
                        </span>
                      </td>
                      {canManage && (
                        <td className="whitespace-nowrap px-4 py-3">
                          <div className="flex justify-end gap-1.5">
                            <IconActionButton icon={PencilIcon} tone="slate" onClick={() => startEdit(s)} title="Edit" label="Edit shareholder" />
                            <IconActionButton icon={TrashIcon} tone="red" onClick={() => handleDelete(s)} title="Remove" label="Remove shareholder" />
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="sm:hidden">
              <div className="flex flex-col gap-2.5">
                {shareholders.map((s) => (
                  <MobileListAccordion
                    key={s.id}
                    name="shareholders-list"
                    summary={
                      <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-slate-900 dark:text-white">{s.name}</p>
                          <p className="truncate text-slate-500 dark:text-slate-400">{s.email}</p>
                        </div>
                        <span
                          className={`shrink-0 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                            s.active
                              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                              : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                          }`}
                        >
                          {s.active ? 'Active' : 'Paused'}
                        </span>
                      </div>
                    }
                  >
                    <div className="flex justify-between">
                      <dt className="text-slate-500 dark:text-slate-400">Ownership</dt>
                      <dd className="text-slate-900 dark:text-white">{s.ownership_percent ? `${s.ownership_percent}%` : '—'}</dd>
                    </div>
                    {canManage && (
                      <div className="flex gap-1.5 pt-1">
                        <IconActionButton icon={PencilIcon} tone="slate" onClick={() => startEdit(s)} title="Edit" label="Edit shareholder" />
                        <IconActionButton icon={TrashIcon} tone="red" onClick={() => handleDelete(s)} title="Remove" label="Remove shareholder" />
                      </div>
                    )}
                  </MobileListAccordion>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {canManage && !showForm && <FloatingActionButton onClick={startCreate} label="New shareholder" />}

      {confirmDialog}
    </div>
  );
}
