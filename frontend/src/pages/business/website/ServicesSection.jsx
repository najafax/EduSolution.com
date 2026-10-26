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
import { PlusIcon, PencilIcon, TrashIcon, ProductIcon } from '../../../components/icons';
import { FormActions, TEXT_INPUT, TEXTAREA, CHECKBOX, SERVICE_ICON_OPTIONS } from './shared';

const EMPTY_SERVICE = { title: '', description: '', icon: 'service', visible: true, display_order: 0 };

export function ServicesSection({ token, canManage }) {
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState(EMPTY_SERVICE);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function load() {
    if (services.length === 0) setLoading(true);
    api.website.services
      .list(token)
      .then(({ services }) => setServices(services))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [token]);

  function startCreate() {
    setForm(EMPTY_SERVICE);
    setEditingId(null);
    setShowForm(true);
  }
  function startEdit(s) {
    setForm({ title: s.title, description: s.description, icon: s.icon, visible: Boolean(s.visible), display_order: s.display_order });
    setEditingId(s.id);
    setShowForm(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (editingId) {
        await api.website.services.update(editingId, form, token);
        toast('Service updated.', { type: 'success' });
      } else {
        await api.website.services.create(form, token);
        toast('Service added.', { type: 'success' });
      }
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(s) {
    if (!(await confirm({ title: `Delete "${s.title}"?`, confirmLabel: 'Delete' }))) return;
    try {
      await api.website.services.remove(s.id, token);
      toast('Service deleted.', { type: 'success' });
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
            New service
          </button>
        </div>
      )}
      {error && !showForm && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <Modal open={showForm} onClose={() => setShowForm(false)} title={editingId ? 'Edit service' : 'New service'}>
        <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
          {error && <p className="text-sm text-red-600 dark:text-red-400 sm:col-span-2">{error}</p>}
          <div className="sm:col-span-2">
            <label className="block">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Title</span>
              <input type="text" required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} className={TEXT_INPUT} />
            </label>
          </div>
          <div className="sm:col-span-2">
            <label className="block">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Description</span>
              <textarea
                rows={3}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className={TEXTAREA}
              />
            </label>
          </div>
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Icon</span>
            <select value={form.icon} onChange={(e) => setForm((f) => ({ ...f, icon: e.target.value }))} className={TEXT_INPUT}>
              {SERVICE_ICON_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Display order</span>
            <input
              type="number"
              value={form.display_order}
              onChange={(e) => setForm((f) => ({ ...f, display_order: e.target.value }))}
              className={TEXT_INPUT}
            />
          </label>
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
            <TableSkeleton rows={3} cols={canManage ? ['w-48', 'w-64', 'w-20', 'w-16'] : ['w-48', 'w-64', 'w-20']} />
          </div>
        ) : services.length === 0 ? (
          <EmptyState
            icon={<ProductIcon />}
            title="No services yet."
            message={canManage ? 'Add the offerings shown on the Services page.' : undefined}
            action={canManage ? { label: 'New service', onClick: startCreate } : undefined}
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto sm:block">
              <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                    <th className="px-4 py-3">Title</th>
                    <th className="px-4 py-3">Description</th>
                    <th className="px-4 py-3">Visible</th>
                    {canManage && <th className="px-4 py-3" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {services.map((s) => (
                    <tr key={s.id}>
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900 dark:text-white">{s.title}</td>
                      <td className="max-w-sm truncate px-4 py-3 text-slate-600 dark:text-slate-400" title={s.description}>
                        {s.description || '—'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <StatusBadge status={s.visible ? 'active' : 'cancelled'} />
                      </td>
                      {canManage && (
                        <td className="whitespace-nowrap px-4 py-3">
                          <div className="flex justify-end gap-1.5">
                            <IconActionButton icon={PencilIcon} tone="slate" onClick={() => startEdit(s)} title="Edit" label="Edit service" />
                            <IconActionButton icon={TrashIcon} tone="red" onClick={() => handleDelete(s)} title="Delete" label="Delete service" />
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col gap-2.5 p-3 sm:hidden">
              {services.map((s) => (
                <MobileListAccordion
                  key={s.id}
                  name="website-services-list"
                  summary={
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-slate-900 dark:text-white">{s.title}</p>
                      </div>
                      <StatusBadge status={s.visible ? 'active' : 'cancelled'} />
                    </div>
                  }
                >
                  {s.description && (
                    <div className="flex justify-between gap-3">
                      <dt className="shrink-0 text-slate-500 dark:text-slate-400">Description</dt>
                      <dd className="text-right text-slate-900 dark:text-white">{s.description}</dd>
                    </div>
                  )}
                  {canManage && (
                    <div className="flex gap-1.5 pt-1">
                      <IconActionButton icon={PencilIcon} tone="slate" onClick={() => startEdit(s)} title="Edit" label="Edit service" />
                      <IconActionButton icon={TrashIcon} tone="red" onClick={() => handleDelete(s)} title="Delete" label="Delete service" />
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
// Team
// ---------------------------------------------------------------------------
