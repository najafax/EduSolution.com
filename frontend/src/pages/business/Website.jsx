import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../lib/useConfirm';
import Modal from '../../components/Modal';
import StatusFilterChips from '../../components/StatusFilterChips';
import StatusBadge from '../../components/StatusBadge';
import FloatingActionButton from '../../components/FloatingActionButton';
import { TableSkeleton } from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import MobileListAccordion from '../../components/MobileListAccordion';
import IconActionButton from '../../components/IconActionButton';
import { PlusIcon, PencilIcon, TrashIcon, InboxIcon, GlobeIcon, UsersIcon, ImageIcon, ProductIcon } from '../../components/icons';

// The staff-side CMS behind the public marketing site (routes/website.js /
// GET /api/public/site) — five small resources, switched by tab rather than
// five separate routed pages, since together they're one cohesive area
// ("what shows on the website") rather than five independent business
// records the way Clients/Products/Expenses etc. are. None of the five
// lists below paginate or search — a marketing site's own content is
// inherently small (see routes/website.js's own top-of-file note), so the
// added machinery every other business list page carries (SearchInput,
// useDebouncedValue, Pagination) isn't worth it here.
const TABS = [
  { value: 'posts', label: 'News & announcements' },
  { value: 'testimonials', label: 'Testimonials' },
  { value: 'services', label: 'Services' },
  { value: 'team', label: 'Team' },
  { value: 'gallery', label: 'Gallery' },
];

// The fixed set of icons a service card can show on the public Services
// page (see pages/marketing/MarketingServices.jsx's own SERVICE_ICONS map,
// which must stay in sync with these keys).
export const SERVICE_ICON_OPTIONS = [
  { value: 'service', label: 'General' },
  { value: 'school', label: 'School / education' },
  { value: 'business', label: 'Business / billing' },
  { value: 'support', label: 'Support' },
  { value: 'reports', label: 'Reports' },
  { value: 'license', label: 'License / access' },
];

const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_IMAGE_BYTES = 400 * 1024;

// Shared by the Team and Gallery sections below — same FileReader-to-
// data-URI approach Settings.jsx's own logo/signature upload already uses,
// since this app has no separate file storage service.
function ImageField({ label, value, onChange, onError }) {
  function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    onError('');
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      onError(`${label} must be a PNG, JPEG or WEBP image`);
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      onError(`${label} must be smaller than 400KB`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onChange(reader.result);
    reader.onerror = () => onError(`Could not read the selected file for ${label}`);
    reader.readAsDataURL(file);
  }

  return (
    <div className="block">
      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
      {value ? (
        <div className="mt-1 flex items-center gap-3">
          <img src={value} alt="" className="h-16 w-16 rounded-md border border-slate-200 object-cover dark:border-slate-700" />
          <button
            type="button"
            onClick={() => onChange('')}
            className="min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Remove
          </button>
        </div>
      ) : (
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={handleFile}
          className="mt-1 block w-full text-sm text-slate-600 file:mr-3 file:min-h-11 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:text-sm file:font-medium file:text-slate-700 dark:text-slate-400 dark:file:bg-slate-800 dark:file:text-slate-200"
        />
      )}
    </div>
  );
}

const TEXT_INPUT = 'mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white';
const TEXTAREA = 'mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white';
const CHECKBOX = 'h-4 w-4 rounded border-slate-300';

function FormActions({ submitting, onCancel }) {
  return (
    <div className="flex gap-3 sm:col-span-2">
      <button
        type="submit"
        disabled={submitting}
        className="min-h-11 rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500 disabled:opacity-60"
      >
        {submitting ? 'Saving…' : 'Save'}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        Cancel
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// News & announcements
// ---------------------------------------------------------------------------

const EMPTY_POST = { title: '', body: '', category: '', status: 'draft' };

function PostsSection({ token, canManage }) {
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
            className="flex min-h-11 items-center gap-1.5 rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500"
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

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
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
      {canManage && !showForm && <FloatingActionButton onClick={startCreate} label="New post" />}
      {confirmDialog}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Testimonials
// ---------------------------------------------------------------------------

const EMPTY_TESTIMONIAL = { quote: '', author_name: '', author_role: '', category: '', status: 'draft', display_order: 0 };

function TestimonialsSection({ token, canManage }) {
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
            className="flex min-h-11 items-center gap-1.5 rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500"
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

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
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
      {canManage && !showForm && <FloatingActionButton onClick={startCreate} label="New testimonial" />}
      {confirmDialog}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

const EMPTY_SERVICE = { title: '', description: '', icon: 'service', visible: true, display_order: 0 };

function ServicesSection({ token, canManage }) {
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
            className="flex min-h-11 items-center gap-1.5 rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500"
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

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
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
      {canManage && !showForm && <FloatingActionButton onClick={startCreate} label="New service" />}
      {confirmDialog}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

const EMPTY_MEMBER = { name: '', role: '', photo: '', visible: true, display_order: 0 };

function TeamSection({ token, canManage }) {
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
            className="flex min-h-11 items-center gap-1.5 rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500"
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

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
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
      {canManage && !showForm && <FloatingActionButton onClick={startCreate} label="New team member" />}
      {confirmDialog}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gallery
// ---------------------------------------------------------------------------

const EMPTY_IMAGE = { image: '', caption: '', visible: true, display_order: 0 };

function GallerySection({ token, canManage }) {
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
            className="flex min-h-11 items-center gap-1.5 rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500"
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
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
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
      {canManage && !showForm && <FloatingActionButton onClick={startCreate} label="New image" />}
      {confirmDialog}
    </div>
  );
}

// ---------------------------------------------------------------------------

export default function Website() {
  const { token, can } = useAuth();
  const canView = can('website', 'view');
  const canManage = can('website', 'manage');
  const [tab, setTab] = useState('posts');

  if (!canView) {
    return (
      <div className="px-4 py-10 sm:px-6 lg:px-8">
        <p className="text-sm text-slate-600 dark:text-slate-400">You don't have permission to view this page.</p>
      </div>
    );
  }

  return (
    <div className="px-4 py-10 pb-24 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Website content</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          What you publish here appears on the public marketing site — edusolutionsmaldives.com.
        </p>
      </div>

      <div className="mt-4">
        <StatusFilterChips options={TABS} value={tab} onChange={setTab} />
      </div>

      {tab === 'posts' && <PostsSection token={token} canManage={canManage} />}
      {tab === 'testimonials' && <TestimonialsSection token={token} canManage={canManage} />}
      {tab === 'services' && <ServicesSection token={token} canManage={canManage} />}
      {tab === 'team' && <TeamSection token={token} canManage={canManage} />}
      {tab === 'gallery' && <GallerySection token={token} canManage={canManage} />}
    </div>
  );
}
