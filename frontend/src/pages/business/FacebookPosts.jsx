import { useEffect, useState } from 'react';
import { resizeImage, dataUriByteLength } from '../../lib/imageResize';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../lib/useConfirm';
import Modal from '../../components/Modal';
import Pagination from '../../components/Pagination';
import { TableSkeleton } from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import StatusBadge from '../../components/StatusBadge';
import MobileListAccordion from '../../components/MobileListAccordion';
import IconActionButton from '../../components/IconActionButton';
import RowActions from '../../components/RowActions';
import { FacebookIcon, PlusIcon, PencilIcon, SendIcon, TrashIcon } from '../../components/icons';

// Weekly AI-drafted Facebook Page post ideas, seeded from this app's own
// published website content (news/services/testimonials — see
// lib/facebookPostDraft.js on the backend), generated automatically every
// Monday morning or on demand via "Generate draft" below. Deliberately
// never auto-publishes — every draft sits here until a staff member
// reviews it, edits it if needed, and explicitly clicks "Publish" (which
// is the one action that actually reaches Facebook's Graph API, see
// routes/facebookPosts.js/lib/facebook.js) or "Discard" if it isn't worth
// posting. A posted record stays here permanently as a record of what was
// actually published and when.
function relativeTime(sqliteDatetime) {
  if (!sqliteDatetime) return '';
  return new Date(`${sqliteDatetime.replace(' ', 'T')}Z`).toLocaleString();
}

export default function FacebookPosts() {
  const { token, can } = useAuth();
  const { toast } = useToast();
  const canManage = can('facebook', 'manage');
  const { confirm, confirmDialog } = useConfirm();

  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [generating, setGenerating] = useState(false);

  // Choices next to "Generate draft": left on Auto, the server rotates through
  // post types and tutorials itself (see lib/facebookPostDraft.js).
  const [options, setOptions] = useState({ postTypes: [], videos: [] });
  const [postType, setPostType] = useState('');
  const [videoId, setVideoId] = useState('');

  const [editTarget, setEditTarget] = useState(null); // the post row being edited, or null
  const [editContent, setEditContent] = useState('');
  // undefined = leave the picture as it is, null = remove it, string = new picture
  const [editImage, setEditImage] = useState(undefined);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState('');

  const [busy, setBusy] = useState(null); // { id, action } — which row/action is in flight

  function load() {
    if (!data) setLoading(true);
    api.facebookPosts
      .list(token, page)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [token, page]);

  useEffect(() => {
    if (!canManage) return;
    api.facebookPosts
      .options(token)
      .then(setOptions)
      .catch(() => {});
  }, [token, canManage]);

  async function handleGenerate() {
    setError('');
    setGenerating(true);
    try {
      await api.facebookPosts.generate(token, {
        postType: postType || undefined,
        videoId: postType === 'tutorial' && videoId ? Number(videoId) : undefined,
      });
      toast('Draft generated.', { type: 'success' });
      setPage(1);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  function openEdit(post) {
    setEditTarget(post);
    setEditContent(post.content);
    setEditImage(undefined);
    setEditError('');
  }

  async function handlePickImage(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setEditError('');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setEditError('The picture must be a PNG, JPEG or WEBP image.');
      return;
    }
    try {
      const dataUri = await resizeImage(file, { maxDimension: 1600 });
      if (dataUriByteLength(dataUri) > 3 * 1024 * 1024) {
        setEditError('That picture is still too large after resizing — please use a smaller one.');
        return;
      }
      setEditImage(dataUri);
    } catch (err) {
      setEditError(err.message || 'Could not read the selected picture.');
    }
  }

  async function handleSaveEdit(e) {
    e.preventDefault();
    if (!editContent.trim()) {
      setEditError('Content is required');
      return;
    }
    setEditSubmitting(true);
    setEditError('');
    try {
      const payload = { content: editContent.trim() };
      if (editImage !== undefined) payload.image = editImage;
      await api.facebookPosts.update(editTarget.id, payload, token);
      setEditTarget(null);
      load();
    } catch (err) {
      setEditError(err.message);
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handlePublish(post) {
    if (
      !(await confirm({
        title: 'Publish to Facebook?',
        message: post.image
          ? 'This will post the text and picture to your Facebook Page right now, visible to everyone who follows it.'
          : 'This will post the text to your Facebook Page right now, visible to everyone who follows it. (No picture is attached.)',
        confirmLabel: 'Publish',
        danger: false,
      }))
    ) {
      return;
    }
    setBusy({ id: post.id, action: 'publish' });
    try {
      await api.facebookPosts.publish(post.id, token);
      toast('Published to Facebook.', { type: 'success' });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function handleDiscard(post) {
    if (
      !(await confirm({
        title: 'Discard this draft?',
        message: 'This draft will be removed and will not be posted.',
        confirmLabel: 'Discard',
      }))
    ) {
      return;
    }
    setBusy({ id: post.id, action: 'discard' });
    try {
      await api.facebookPosts.remove(post.id, token);
      toast('Draft discarded.', { type: 'success' });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  function rowActions(post) {
    if (post.status !== 'draft') return null;
    return (
      <>
        <IconActionButton icon={PencilIcon} tone="slate" title="Edit" onClick={() => openEdit(post)} disabled={!!busy} />
        <IconActionButton
          icon={SendIcon}
          tone="emerald"
          title={busy?.id === post.id && busy.action === 'publish' ? 'Publishing…' : 'Publish to Facebook'}
          onClick={() => handlePublish(post)}
          disabled={!!busy}
        />
        <IconActionButton
          icon={TrashIcon}
          tone="red"
          title={busy?.id === post.id && busy.action === 'discard' ? 'Discarding…' : 'Discard'}
          onClick={() => handleDiscard(post)}
          disabled={!!busy}
        />
      </>
    );
  }

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-slate-900 dark:text-white">Facebook posts</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            AI-drafted post ideas for your Facebook Page, generated weekly — review, edit, and publish whichever ones you like.
          </p>
        </div>
        {canManage && (
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex min-h-11 items-center gap-1.5 rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-700 dark:bg-lagoon-600 dark:hover:bg-lagoon-500 disabled:opacity-60"
          >
            <PlusIcon width={16} height={16} />
            {generating ? 'Generating…' : 'Generate draft'}
          </button>
        )}
      </div>

      {canManage && options.postTypes.length > 0 && (
        <div className="mt-4 flex flex-wrap items-end gap-3 rounded-2xl bg-white p-3 shadow-sm dark:border dark:border-slate-700 dark:bg-slate-900">
          <label className="block w-full sm:w-auto">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Post type</span>
            <select
              value={postType}
              onChange={(e) => {
                setPostType(e.target.value);
                setVideoId('');
              }}
              className="mt-1 block min-h-11 w-full rounded-md border border-slate-300 px-3 text-base text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white sm:w-auto"
            >
              <option value="">Automatic (rotates)</option>
              {options.postTypes.map((t) => (
                <option key={t.value} value={t.value} disabled={!t.available}>
                  {t.label}
                  {t.available ? '' : ' — nothing to use yet'}
                </option>
              ))}
            </select>
          </label>
          {postType === 'tutorial' && (
            <label className="block w-full min-w-0 sm:w-auto">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Tutorial</span>
              <select
                value={videoId}
                onChange={(e) => setVideoId(e.target.value)}
                className="mt-1 block min-h-11 w-full max-w-full rounded-md border border-slate-300 px-3 text-base text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white sm:w-auto"
              >
                <option value="">Next in rotation</option>
                {options.videos.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="min-w-0 flex-1 basis-56 text-xs text-slate-500 dark:text-slate-400">
            Tutorial posts attach the tutorial's thumbnail as the picture. You can replace or remove it when you edit the draft.
          </p>
        </div>
      )}

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-6 rounded-3xl bg-white dark:border shadow-sm dark:border-slate-700 dark:bg-slate-900">
        {loading ? (
          <div className="overflow-x-auto">
            <TableSkeleton rows={4} cols={canManage ? ['w-80', 'w-20', 'w-32', 'w-32', 'w-28'] : ['w-80', 'w-20', 'w-32', 'w-32']} />
          </div>
        ) : !data || data.posts.length === 0 ? (
          <EmptyState
            icon={<FacebookIcon />}
            title="No drafts yet."
            message={
              canManage
                ? 'Generate a draft now, or wait for next Monday’s automatic draft.'
                : undefined
            }
            action={canManage ? { label: 'Generate draft', onClick: handleGenerate } : undefined}
          />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto sm:block">
              <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
                <thead className="bg-slate-50 dark:bg-slate-800/50">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Content</th>
                    <th className="px-4 py-3 text-left font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Status</th>
                    <th className="px-4 py-3 text-left font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Generated by</th>
                    <th className="px-4 py-3 text-left font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Created</th>
                    {canManage && (
                      <th className="px-4 py-3 text-right font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Actions</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data.posts.map((post) => (
                    <tr key={post.id}>
                      <td className="max-w-md px-4 py-3">
                        <div className="flex items-start gap-3">
                          {post.image && (
                            <img src={post.image} alt="" className="h-14 w-14 shrink-0 rounded-md border border-slate-200 object-cover dark:border-slate-700" />
                          )}
                          <div className="min-w-0">
                            <p className="line-clamp-2 text-slate-900 dark:text-white">{post.content}</p>
                            {post.source_note && <p className="mt-0.5 truncate text-xs text-slate-400 dark:text-slate-500">{post.source_note}</p>}
                          </div>
                        </div>
                        {post.status === 'posted' && post.fb_post_id && (
                          <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
                            Posted {relativeTime(post.posted_at)}
                            {post.has_image ? ' · with picture' : ''}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={post.status} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-300">{post.generated_by_name || '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-300">{relativeTime(post.created_at)}</td>
                      {canManage && (
                        <td className="px-4 py-3">
                          <RowActions>{rowActions(post)}</RowActions>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile accordion */}
            <div className="flex flex-col gap-2.5 sm:hidden">
              {data.posts.map((post) => (
                <MobileListAccordion
                  key={post.id}
                  name="facebook-posts-list"
                  accent={post.status === 'posted' ? 'bg-emerald-500' : 'bg-slate-300'}
                  summary={
                    <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
                      <p className="line-clamp-2 min-w-0 text-sm text-slate-900 dark:text-white">{post.content}</p>
                      <StatusBadge status={post.status} />
                    </div>
                  }
                >
                  {post.image && <img src={post.image} alt="" className="mb-2 max-h-48 w-full rounded-xl border border-slate-200 object-cover dark:border-slate-700" />}
                  {post.source_note && <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">{post.source_note}</p>}
                  <dl className="grid grid-cols-2 gap-2 text-sm">
                    <dt className="text-slate-500 dark:text-slate-400">Generated by</dt>
                    <dd className="text-right text-slate-900 dark:text-white">{post.generated_by_name || '—'}</dd>
                    <dt className="text-slate-500 dark:text-slate-400">Created</dt>
                    <dd className="text-right text-slate-900 dark:text-white">{relativeTime(post.created_at)}</dd>
                    {post.status === 'posted' && (
                      <>
                        <dt className="text-slate-500 dark:text-slate-400">Posted</dt>
                        <dd className="text-right text-slate-900 dark:text-white">{relativeTime(post.posted_at)}</dd>
                      </>
                    )}
                  </dl>
                  {canManage && post.status === 'draft' && <div className="mt-2 pt-1"><RowActions fill>{rowActions(post)}</RowActions></div>}
                </MobileListAccordion>
              ))}
            </div>
          </>
        )}
      </div>

      {data && data.totalPages > 1 && <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />}

      <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title="Edit draft">
        <form onSubmit={handleSaveEdit} className="space-y-3">
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            rows={8}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-base text-slate-900 focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
          />
          {(() => {
            const shown = editImage === undefined ? editTarget?.image : editImage;
            return (
              <div>
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Picture</span>
                {shown ? (
                  <div className="mt-1 flex items-center gap-3">
                    <img src={shown} alt="" className="h-24 w-24 rounded-md border border-slate-200 object-cover dark:border-slate-700" />
                    <div className="flex flex-wrap gap-2">
                      <label className="flex min-h-11 cursor-pointer items-center rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
                        Replace
                        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handlePickImage} className="sr-only" />
                      </label>
                      <button
                        type="button"
                        onClick={() => setEditImage(null)}
                        className="min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ) : (
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handlePickImage}
                    className="mt-1 block w-full text-sm text-slate-600 file:mr-3 file:min-h-11 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:text-sm file:font-medium file:text-slate-700 dark:text-slate-400 dark:file:bg-slate-800 dark:file:text-slate-200"
                  />
                )}
              </div>
            );
          })()}
          {editError && <p className="text-sm text-red-600 dark:text-red-400">{editError}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditTarget(null)}
              className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={editSubmitting}
              className="min-h-11 rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-700 dark:bg-lagoon-600 dark:hover:bg-lagoon-500 disabled:opacity-60"
            >
              {editSubmitting ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </Modal>

      {confirmDialog}
    </div>
  );
}
