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
import { PlusIcon, PencilIcon, TrashIcon, InboxIcon } from '../../../components/icons';
import { FormActions, TEXT_INPUT, TEXTAREA } from './shared';

const EMPTY_POST = { title: '', body: '', category: '', status: 'draft' };

export function PostsSection({ token, canManage }) {
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState(EMPTY_POST);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function load() {
    if (posts.length === 0) setLoading(true);
    api.website.posts
      .list(token)
      .then(({ posts }) => setPosts(posts))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [token]);

  function startCreate() {
    setForm(EMPTY_POST);
    setEditingId(null);
    setShowForm(true);
  }
  function startEdit(post) {
    setForm({ title: post.title, body: post.body, category: post.category, status: post.status });
    setEditingId(post.id);
    setShowForm(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (editingId) {
        await api.website.posts.update(editingId, form, token);
        toast('Post updated.', { type: 'success' });
      } else {
        await api.website.posts.create(form, token);
        toast('Post created.', { type: 'success' });
      }
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(post) {
    if (!(await confirm({ title: `Delete "${post.title}"?`, confirmLabel: 'Delete' }))) return;
    try {
      await api.website.posts.remove(post.id, token);
      toast('Post deleted.', { type: 'success' });
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
            New post
          </button>
        </div>
      )}
      {error && !showForm && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <Modal open={showForm} onClose={() => setShowForm(false)} title={editingId ? 'Edit post' : 'New post'}>
        <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
          {error && <p className="text-sm text-red-600 dark:text-red-400 sm:col-span-2">{error}</p>}
          <div className="sm:col-span-2">
            <label className="block">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Title</span>
              <input type="text" required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} className={TEXT_INPUT} />
            </label>
          </div>
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Category</span>
            <input
              type="text"
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              placeholder="e.g. EduPage, Business Suite, Team"
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
          <div className="sm:col-span-2">
            <label className="block">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Body</span>
              <textarea rows={5} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} className={TEXTAREA} />
            </label>
          </div>
          <FormActions submitting={submitting} onCancel={() => setShowForm(false)} />
        </form>
      </Modal>

      <div className="rounded-3xl bg-white dark:border shadow-sm dark:border-slate-700 dark:bg-slate-900">
        {loading ? (
          <div className="overflow-x-auto">
            <TableSkeleton rows={4} cols={canManage ? ['w-64', 'w-28', 'w-24', 'w-16'] : ['w-64', 'w-28', 'w-24']} />
          </div>
        ) : posts.length === 0 ? (
          <EmptyState
            icon={<InboxIcon />}
            title="No posts yet."
            message={canManage ? 'Announce news the way your clients and visitors will see it.' : undefined}
            action={canManage ? { label: 'New post', onClick: startCreate } : undefined}
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto sm:block">
              <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                    <th className="px-4 py-3">Title</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Status</th>
                    {canManage && <th className="px-4 py-3" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {posts.map((p) => (
                    <tr key={p.id}>
                      <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{p.title}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-400">{p.category || '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <StatusBadge status={p.status} />
                      </td>
                      {canManage && (
                        <td className="whitespace-nowrap px-4 py-3">
                          <div className="flex justify-end gap-1.5">
                            <IconActionButton icon={PencilIcon} tone="slate" onClick={() => startEdit(p)} title="Edit" label="Edit post" />
                            <IconActionButton icon={TrashIcon} tone="red" onClick={() => handleDelete(p)} title="Delete" label="Delete post" />
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col gap-2.5 p-3 sm:hidden">
              {posts.map((p) => (
                <MobileListAccordion
                  key={p.id}
                  name="website-posts-list"
                  summary={
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-slate-900 dark:text-white">{p.title}</p>
                        <p className="text-slate-500 dark:text-slate-400">{p.category || '—'}</p>
                      </div>
                      <StatusBadge status={p.status} />
                    </div>
                  }
                >
                  {canManage && (
                    <div className="flex gap-1.5 pt-1">
                      <IconActionButton icon={PencilIcon} tone="slate" onClick={() => startEdit(p)} title="Edit" label="Edit post" />
                      <IconActionButton icon={TrashIcon} tone="red" onClick={() => handleDelete(p)} title="Delete" label="Delete post" />
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
// Testimonials
// ---------------------------------------------------------------------------
