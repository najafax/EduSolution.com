import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { useToast } from '../../../context/ToastContext';
import { useConfirm } from '../../../lib/useConfirm';
import Modal from '../../../components/Modal';
import StatusBadge from '../../../components/StatusBadge';
import { TableSkeleton } from '../../../components/Skeleton';
import EmptyState from '../../../components/EmptyState';
import MobileListAccordion from '../../../components/MobileListAccordion';
import IconActionButton from '../../../components/IconActionButton';
import { PlusIcon, PencilIcon, TrashIcon, UsersIcon } from '../../../components/icons';
import { ImageField, FormActions, TEXT_INPUT, CHECKBOX } from './shared';

const EMPTY_MEMBER = { name: '', role: '', photo: '', visible: true, display_order: 0 };

export function TeamSection({ token, canManage }) {
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [team, setTeam] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState(EMPTY_MEMBER);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function load() {
    if (team.length === 0) setLoading(true);
    api.website.team
      .list(token)
      .then(({ team }) => setTeam(team))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [token]);

  function startCreate() {
    setForm(EMPTY_MEMBER);
    setEditingId(null);
    setShowForm(true);
  }
  function startEdit(m) {
    setForm({ name: m.name, role: m.role, photo: m.photo, visible: Boolean(m.visible), display_order: m.display_order });
    setEditingId(m.id);
    setShowForm(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (editingId) {
        await api.website.team.update(editingId, form, token);
        toast('Team member updated.', { type: 'success' });
      } else {
        await api.website.team.create(form, token);
        toast('Team member added.', { type: 'success' });
      }
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(m) {
    if (!(await confirm({ title: `Remove ${m.name} from the website?`, confirmLabel: 'Delete' }))) return;
    try {
      await api.website.team.remove(m.id, token);
      toast('Team member removed.', { type: 'success' });
      load();
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  }

  return (
    <div className="mt-6">
      {canManage && (
        <div className="mb-4 flex justify-end">
          <button
            onClick={startCreate}
            className="flex min-h-11 items-center gap-1.5 rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-700 dark:bg-lagoon-600 dark:hover:bg-lagoon-500"
          >
            <PlusIcon width={16} height={16} />
            New team member
          </button>
        </div>
      )}
      {error && !showForm && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <Modal open={showForm} onClose={() => setShowForm(false)} title={editingId ? 'Edit team member' : 'New team member'}>
        <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
          {error && <p className="text-sm text-red-600 dark:text-red-400 sm:col-span-2">{error}</p>}
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Name</span>
            <input type="text" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={TEXT_INPUT} />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Role</span>
            <input type="text" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} className={TEXT_INPUT} />
          </label>
          <div className="sm:col-span-2">
            <ImageField label="Photo" value={form.photo} onChange={(v) => setForm((f) => ({ ...f, photo: v }))} onError={setError} />
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.visible} onChange={(e) => setForm((f) => ({ ...f, visible: e.target.checked }))} className={CHECKBOX} />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Visible on website</span>
          </label>
          <FormActions submitting={submitting} onCancel={() => setShowForm(false)} />
        </form>
      </Modal>

      <div className="rounded-3xl bg-white dark:border shadow-sm dark:border-slate-700 dark:bg-slate-900">
        {loading ? (
          <div className="overflow-x-auto">
            <TableSkeleton rows={3} cols={canManage ? ['w-16', 'w-40', 'w-32', 'w-16'] : ['w-16', 'w-40', 'w-32']} />
          </div>
        ) : team.length === 0 ? (
          <EmptyState
            icon={<UsersIcon />}
            title="No team members yet."
            message={canManage ? 'Introduce the people behind Edu Solutions.' : undefined}
            action={canManage ? { label: 'New team member', onClick: startCreate } : undefined}
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto sm:block">
              <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                    <th className="px-4 py-3" />
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Role</th>
                    <th className="px-4 py-3">Visible</th>
                    {canManage && <th className="px-4 py-3" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {team.map((m) => (
                    <tr key={m.id}>
                      <td className="px-4 py-3">
                        {m.photo ? (
                          <img src={m.photo} alt="" className="h-10 w-10 rounded-full object-cover" />
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-lagoon-100 text-xs font-bold text-lagoon-700 dark:bg-lagoon-950 dark:text-lagoon-400">
                            {m.name.slice(0, 2).toUpperCase()}
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900 dark:text-white">{m.name}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-400">{m.role || '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <StatusBadge status={m.visible ? 'active' : 'cancelled'} />
                      </td>
                      {canManage && (
                        <td className="whitespace-nowrap px-4 py-3">
                          <div className="flex justify-end gap-1.5">
                            <IconActionButton icon={PencilIcon} tone="slate" onClick={() => startEdit(m)} title="Edit" label="Edit team member" />
                            <IconActionButton icon={TrashIcon} tone="red" onClick={() => handleDelete(m)} title="Delete" label="Delete team member" />
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col gap-2.5 p-3 sm:hidden">
              {team.map((m) => (
                <MobileListAccordion
                  key={m.id}
                  name="website-team-list"
                  summary={
                    <div className="flex items-center gap-3">
                      {m.photo ? (
                        <img src={m.photo} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
                      ) : (
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-lagoon-100 text-xs font-bold text-lagoon-700 dark:bg-lagoon-950 dark:text-lagoon-400">
                          {m.name.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-slate-900 dark:text-white">{m.name}</p>
                        <p className="text-slate-500 dark:text-slate-400">{m.role || '—'}</p>
                      </div>
                      <StatusBadge status={m.visible ? 'active' : 'cancelled'} />
                    </div>
                  }
                >
                  {canManage && (
                    <div className="flex gap-1.5 pt-1">
                      <IconActionButton icon={PencilIcon} tone="slate" onClick={() => startEdit(m)} title="Edit" label="Edit team member" />
                      <IconActionButton icon={TrashIcon} tone="red" onClick={() => handleDelete(m)} title="Delete" label="Delete team member" />
                    </div>
                  )}
                </MobileListAccordion>
              ))}
            </div>
          </>
        )}
      </div>
      {confirmDialog}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gallery
// ---------------------------------------------------------------------------
