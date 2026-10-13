import { useEffect, useState } from 'react';
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

  const [editTarget, setEditTarget] = useState(null); // the post row being edited, or null
  const [editContent, setEditContent] = useState('');
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

  async function handleGenerate() {
    setError('');
    setGenerating(true);
    try {
      await api.facebookPosts.generate(token);
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
    setEditError('');
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
      await api.facebookPosts.update(editTarget.id, { content: editContent.trim() }, token);
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
        message: 'This will post the content below to your Facebook Page right now, visible to everyone who follows it.',
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
            className="flex min-h-11 items-center gap-1.5 rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500 disabled:opacity-60"
          >
            <PlusIcon width={16} height={16} />
            {generating ? 'Generating…' : 'Generate draft'}
          </button>
        )}
      </div>

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
                        <p className="line-clamp-2 text-slate-900 dark:text-white">{post.content}</p>
                        {post.status === 'posted' && post.fb_post_id && (
                          <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">Posted {relativeTime(post.posted_at)}</p>
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
              className="min-h-11 rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500 disabled:opacity-60"
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
