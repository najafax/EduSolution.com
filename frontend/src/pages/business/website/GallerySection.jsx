import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { useToast } from '../../../context/ToastContext';
import { useConfirm } from '../../../lib/useConfirm';
import Modal from '../../../components/Modal';
import StatusBadge from '../../../components/StatusBadge';
import EmptyState from '../../../components/EmptyState';
import IconActionButton from '../../../components/IconActionButton';
import { PlusIcon, PencilIcon, TrashIcon, ImageIcon } from '../../../components/icons';
import { ImageField, FormActions, TEXT_INPUT, CHECKBOX } from './shared';

const EMPTY_IMAGE = { image: '', caption: '', visible: true, display_order: 0 };

export function GallerySection({ token, canManage }) {
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [gallery, setGallery] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState(EMPTY_IMAGE);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function load() {
    if (gallery.length === 0) setLoading(true);
    api.website.gallery
      .list(token)
      .then(({ gallery }) => setGallery(gallery))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [token]);

  function startCreate() {
    setForm(EMPTY_IMAGE);
    setEditingId(null);
    setShowForm(true);
  }
  function startEdit(item) {
    setForm({ image: item.image, caption: item.caption, visible: Boolean(item.visible), display_order: item.display_order });
    setEditingId(item.id);
    setShowForm(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!form.image) {
      setError('Please choose an image');
      return;
    }
    setSubmitting(true);
    try {
      if (editingId) {
        await api.website.gallery.update(editingId, form, token);
        toast('Gallery image updated.', { type: 'success' });
      } else {
        await api.website.gallery.create(form, token);
        toast('Gallery image added.', { type: 'success' });
      }
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(item) {
    if (!(await confirm({ title: 'Delete this gallery image?', confirmLabel: 'Delete' }))) return;
    try {
      await api.website.gallery.remove(item.id, token);
      toast('Gallery image deleted.', { type: 'success' });
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
            New image
          </button>
        </div>
      )}
      {error && !showForm && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <Modal open={showForm} onClose={() => setShowForm(false)} title={editingId ? 'Edit gallery image' : 'New gallery image'}>
        <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
          {error && <p className="text-sm text-red-600 dark:text-red-400 sm:col-span-2">{error}</p>}
          {!editingId && (
            <div className="sm:col-span-2">
              <ImageField label="Image" value={form.image} onChange={(v) => setForm((f) => ({ ...f, image: v }))} onError={setError} />
            </div>
          )}
          <div className="sm:col-span-2">
            <label className="block">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Caption</span>
              <input
                type="text"
                value={form.caption}
                onChange={(e) => setForm((f) => ({ ...f, caption: e.target.value }))}
                className={TEXT_INPUT}
              />
            </label>
          </div>
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
            <div key={i} className="aspect-square animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
          ))}
        </div>
      ) : gallery.length === 0 ? (
        <div className="rounded-3xl bg-white dark:border shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <EmptyState
            icon={<ImageIcon />}
            title="No gallery images yet."
            message={canManage ? 'Add a few photos to show on the website.' : undefined}
            action={canManage ? { label: 'New image', onClick: startCreate } : undefined}
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {gallery.map((item) => (
            <div key={item.id} className="group relative overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
              <img src={item.image} alt={item.caption} className="aspect-square w-full object-cover" />
              {!item.visible && (
                <span className="absolute left-2 top-2">
                  <StatusBadge status="cancelled" />
                </span>
              )}
              {item.caption && (
                <p className="truncate bg-white px-2 py-1.5 text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-400">{item.caption}</p>
              )}
              {canManage && (
                <div className="absolute bottom-1.5 right-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <IconActionButton icon={PencilIcon} tone="slate" onClick={() => startEdit(item)} title="Edit" label="Edit image" />
                  <IconActionButton icon={TrashIcon} tone="red" onClick={() => handleDelete(item)} title="Delete" label="Delete image" />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {confirmDialog}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Videos — tutorial recordings (e.g. EduPage walkthroughs) hosted on Google
// Drive, not this app; video_url is the Drive share link itself, and the
// public site derives a thumbnail from it (see lib/googleDrive.js /
// components/VideoThumbnail.jsx) rather than needing a separate uploaded
// image the way Team/Gallery do.
// ---------------------------------------------------------------------------
