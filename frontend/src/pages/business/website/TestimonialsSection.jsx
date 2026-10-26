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
import { PlusIcon, PencilIcon, TrashIcon, GlobeIcon } from '../../../components/icons';
import { FormActions, TEXT_INPUT, TEXTAREA } from './shared';

const EMPTY_TESTIMONIAL = { quote: '', author_name: '', author_role: '', category: '', status: 'draft', display_order: 0 };

export function TestimonialsSection({ token, canManage }) {
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [testimonials, setTestimonials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState(EMPTY_TESTIMONIAL);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function load() {
    if (testimonials.length === 0) setLoading(true);
    api.website.testimonials
      .list(token)
      .then(({ testimonials }) => setTestimonials(testimonials))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [token]);

  function startCreate() {
    setForm(EMPTY_TESTIMONIAL);
    setEditingId(null);
    setShowForm(true);
  }
  function startEdit(t) {
    setForm({ quote: t.quote, author_name: t.author_name, author_role: t.author_role, category: t.category, status: t.status, display_order: t.display_order });
    setEditingId(t.id);
    setShowForm(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (editingId) {
        await api.website.testimonials.update(editingId, form, token);
        toast('Testimonial updated.', { type: 'success' });
      } else {
        await api.website.testimonials.create(form, token);
        toast('Testimonial added.', { type: 'success' });
      }
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(t) {
    if (!(await confirm({ title: `Delete this testimonial from ${t.author_name || 'this client'}?`, confirmLabel: 'Delete' }))) return;
    try {
      await api.website.testimonials.remove(t.id, token);
      toast('Testimonial deleted.', { type: 'success' });
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
            New testimonial
          </button>
        </div>
      )}
      {error && !showForm && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <Modal open={showForm} onClose={() => setShowForm(false)} title={editingId ? 'Edit testimonial' : 'New testimonial'}>
        <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
          {error && <p className="text-sm text-red-600 dark:text-red-400 sm:col-span-2">{error}</p>}
          <div className="sm:col-span-2">
            <label className="block">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Quote</span>
              <textarea rows={3} required value={form.quote} onChange={(e) => setForm((f) => ({ ...f, quote: e.target.value }))} className={TEXTAREA} />
            </label>
          </div>
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Author name</span>
            <input
              type="text"
              value={form.author_name}
              onChange={(e) => setForm((f) => ({ ...f, author_name: e.target.value }))}
              className={TEXT_INPUT}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Author role</span>
            <input
              type="text"
              placeholder="e.g. Owner, Trading Company"
              value={form.author_role}
              onChange={(e) => setForm((f) => ({ ...f, author_role: e.target.value }))}
              className={TEXT_INPUT}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Category</span>
            <input
              type="text"
              placeholder="e.g. School, Business, Resort"
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              className={TEXT_INPUT}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Status</span>
            <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))} className={TEXT_INPUT}>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
            </select>
          </label>
          <FormActions submitting={submitting} onCancel={() => setShowForm(false)} />
        </form>
      </Modal>

      <div className="rounded-3xl bg-white dark:border shadow-sm dark:border-slate-700 dark:bg-slate-900">
        {loading ? (
          <div className="overflow-x-auto">
            <TableSkeleton rows={4} cols={canManage ? ['w-64', 'w-32', 'w-24', 'w-16'] : ['w-64', 'w-32', 'w-24']} />
          </div>
        ) : testimonials.length === 0 ? (
          <EmptyState
            icon={<GlobeIcon />}
            title="No testimonials yet."
            message={canManage ? 'Add a few words from the clients you work with.' : undefined}
            action={canManage ? { label: 'New testimonial', onClick: startCreate } : undefined}
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto sm:block">
              <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                    <th className="px-4 py-3">Quote</th>
                    <th className="px-4 py-3">Author</th>
                    <th className="px-4 py-3">Status</th>
                    {canManage && <th className="px-4 py-3" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {testimonials.map((t) => (
                    <tr key={t.id}>
                      <td className="max-w-sm truncate px-4 py-3 text-slate-900 dark:text-white" title={t.quote}>
                        {t.quote}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-400">{t.author_name || '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <StatusBadge status={t.status} />
                      </td>
                      {canManage && (
                        <td className="whitespace-nowrap px-4 py-3">
                          <div className="flex justify-end gap-1.5">
                            <IconActionButton icon={PencilIcon} tone="slate" onClick={() => startEdit(t)} title="Edit" label="Edit testimonial" />
                            <IconActionButton icon={TrashIcon} tone="red" onClick={() => handleDelete(t)} title="Delete" label="Delete testimonial" />
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col gap-2.5 p-3 sm:hidden">
              {testimonials.map((t) => (
                <MobileListAccordion
                  key={t.id}
                  name="website-testimonials-list"
                  summary={
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-slate-900 dark:text-white">{t.author_name || 'Untitled'}</p>
                        <p className="truncate text-slate-500 dark:text-slate-400">{t.quote}</p>
                      </div>
                      <StatusBadge status={t.status} />
                    </div>
                  }
                >
                  {canManage && (
                    <div className="flex gap-1.5 pt-1">
                      <IconActionButton icon={PencilIcon} tone="slate" onClick={() => startEdit(t)} title="Edit" label="Edit testimonial" />
                      <IconActionButton icon={TrashIcon} tone="red" onClick={() => handleDelete(t)} title="Delete" label="Delete testimonial" />
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
// Services
// ---------------------------------------------------------------------------
