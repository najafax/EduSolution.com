import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { useToast } from '../../../context/ToastContext';
import { useConfirm } from '../../../lib/useConfirm';
import Modal from '../../../components/Modal';
import StatusBadge from '../../../components/StatusBadge';
import EmptyState from '../../../components/EmptyState';
import IconActionButton from '../../../components/IconActionButton';
import VideoThumbnail from '../../../components/VideoThumbnail';
import { PlusIcon, PencilIcon, TrashIcon, VideoIcon } from '../../../components/icons';
import { FormActions, TEXT_INPUT, TEXTAREA, CHECKBOX } from './shared';

const EMPTY_VIDEO = { title: '', description: '', video_url: '', category: '', visible: true, display_order: 0 };

export function VideosSection({ token, canManage }) {
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState(EMPTY_VIDEO);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function load() {
    if (videos.length === 0) setLoading(true);
    api.website.videos
      .list(token)
      .then(({ videos }) => setVideos(videos))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [token]);

  function startCreate() {
    setForm(EMPTY_VIDEO);
    setEditingId(null);
    setShowForm(true);
  }
  function startEdit(v) {
    setForm({
      title: v.title,
      description: v.description,
      video_url: v.video_url,
      category: v.category,
      visible: Boolean(v.visible),
      display_order: v.display_order,
    });
    setEditingId(v.id);
    setShowForm(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (editingId) {
        await api.website.videos.update(editingId, form, token);
        toast('Video updated.', { type: 'success' });
      } else {
        await api.website.videos.create(form, token);
        toast('Video added.', { type: 'success' });
      }
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(v) {
    if (!(await confirm({ title: `Delete "${v.title}"?`, confirmLabel: 'Delete' }))) return;
    try {
      await api.website.videos.remove(v.id, token);
      toast('Video deleted.', { type: 'success' });
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
            New video
          </button>
        </div>
      )}
      {error && !showForm && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <Modal open={showForm} onClose={() => setShowForm(false)} title={editingId ? 'Edit video' : 'New video'}>
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
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Google Drive link</span>
              <input
                type="url"
                required
                placeholder="https://drive.google.com/file/d/.../view?usp=sharing"
                value={form.video_url}
                onChange={(e) => setForm((f) => ({ ...f, video_url: e.target.value }))}
                className={TEXT_INPUT}
              />
              <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                The file must be shared as "Anyone with the link" — the public site links straight to this URL and derives its
                thumbnail from it.
              </span>
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
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Category</span>
            <input
              type="text"
              placeholder="e.g. EduPage, Business Suite"
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              className={TEXT_INPUT}
            />
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

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="aspect-video animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
          ))}
        </div>
      ) : videos.length === 0 ? (
        <div className="rounded-3xl bg-white dark:border shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <EmptyState
            icon={<VideoIcon />}
            title="No videos yet."
            message={canManage ? 'Add tutorial recordings hosted on Google Drive — EduPage walkthroughs, product demos.' : undefined}
            action={canManage ? { label: 'New video', onClick: startCreate } : undefined}
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {videos.map((v) => (
            <div key={v.id} className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
              <VideoThumbnail video={v} />
              <div className="p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{v.title}</p>
                  <StatusBadge status={v.visible ? 'active' : 'cancelled'} />
                </div>
                {v.category && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{v.category}</p>}
                {canManage && (
                  <div className="mt-2 flex gap-1.5">
                    <IconActionButton icon={PencilIcon} tone="slate" onClick={() => startEdit(v)} title="Edit" label="Edit video" />
                    <IconActionButton icon={TrashIcon} tone="red" onClick={() => handleDelete(v)} title="Delete" label="Delete video" />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {confirmDialog}
    </div>
  );
}

// ---------------------------------------------------------------------------
