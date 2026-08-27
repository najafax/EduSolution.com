import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import Pagination from '../../components/Pagination';
import EmptyState from '../../components/EmptyState';
import CampaignComposeModal from '../../components/CampaignComposeModal';
import Modal from '../../components/Modal';
import { MegaphoneIcon, PlusIcon } from '../../components/icons';

// Bulk/promotional emails — newsletters, announcements, service updates —
// sent to every client or a hand-picked subset. Distinct from every other
// client-facing email in this app (quote/invoice send, reminders, receipts,
// portal invites): those are all transactional, one-recipient, and tied to
// a specific document; a campaign has no document behind it and is
// inherently one-to-many, so it gets its own module/permission and its own
// history feed (this page) rather than folding into Email Center's sent
// log (though every individual send still lands in that same email_log
// table under type "campaign" — see routes/campaigns.js).
export default function Campaigns() {
  const { token, can } = useAuth();
  const { toast } = useToast();
  const canManage = can('campaigns', 'manage');
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCompose, setShowCompose] = useState(false);
  const [failuresTarget, setFailuresTarget] = useState(null); // the campaign row whose failures modal is open
  const [failures, setFailures] = useState(null); // null while loading, [] once loaded
  const [failuresError, setFailuresError] = useState('');

  // Which specific recipients failed and why — see routes/campaigns.js's
  // campaign_failures note. Fetched fresh on open, not prefetched for
  // every row up front, same "fetch on open" convention Licenses.jsx's own
  // renewal-history modal already uses.
  function openFailures(campaign) {
    setFailuresTarget(campaign);
    setFailures(null);
    setFailuresError('');
    api.campaigns
      .failures(campaign.id, token)
      .then(({ failures }) => setFailures(failures))
      .catch((err) => setFailuresError(err.message));
  }

  function load() {
    if (!data) setLoading(true);
    api.campaigns
      .list(token, page)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [token, page]);

  function handleSent(result) {
    const { sentCount, failedCount } = result;
    if (failedCount > 0) {
      toast(`Campaign sent to ${sentCount} client${sentCount === 1 ? '' : 's'}, ${failedCount} failed.`, { type: 'error' });
    } else {
      toast(`Campaign sent to ${sentCount} client${sentCount === 1 ? '' : 's'}.`, { type: 'success' });
    }
    setPage(1);
    load();
  }

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Campaigns</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Send a newsletter or promotional email to your clients.</p>
        </div>
        {canManage && (
          <button
            onClick={() => setShowCompose(true)}
            className="flex min-h-11 items-center gap-1.5 rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500"
          >
            <PlusIcon width={16} height={16} />
            New campaign
          </button>
        )}
      </div>

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        {!error && loading ? (
          <p className="p-6 text-sm text-slate-500 dark:text-slate-400">Loading…</p>
        ) : !error && (!data || data.campaigns.length === 0) ? (
          <EmptyState
            icon={<MegaphoneIcon />}
            title="No campaigns sent yet."
            message={canManage ? 'Send your first newsletter or announcement to your clients.' : undefined}
            action={canManage ? { label: 'New campaign', onClick: () => setShowCompose(true) } : undefined}
          />
        ) : !error ? (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.campaigns.map((c) => (
              <li key={c.id} className="px-4 py-3 text-sm sm:px-6">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 dark:text-white">{c.subject}</p>
                    <p className="mt-0.5 line-clamp-2 text-slate-500 dark:text-slate-400">{c.message}</p>
                  </div>
                  <span className="whitespace-nowrap text-xs text-slate-400 dark:text-slate-500">
                    {new Date(c.created_at.replace(' ', 'T') + 'Z').toLocaleString()}
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                  {c.recipient_type === 'all' ? 'All clients' : 'Selected clients'} — sent to {c.sent_count} of {c.recipient_count}
                  {c.failed_count > 0 && (
                    <span className="text-red-600 dark:text-red-400">
                      {' '}
                      ({c.failed_count} failed —{' '}
                      <button type="button" onClick={() => openFailures(c)} className="underline hover:no-underline">
                        view
                      </button>
                      )
                    </span>
                  )}
                  {c.sent_by_name ? ` — sent by ${c.sent_by_name}` : ''}
                </p>
              </li>
            ))}
          </ul>
        ) : null}

        {data && data.totalPages > 1 && (
          <div className="px-4 pb-4 sm:px-6">
            <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
          </div>
        )}
      </div>

      {canManage && (
        <CampaignComposeModal open={showCompose} onClose={() => setShowCompose(false)} token={token} onSent={handleSent} />
      )}

      <Modal
        open={!!failuresTarget}
        onClose={() => setFailuresTarget(null)}
        title={failuresTarget ? `Failed recipients — "${failuresTarget.subject}"` : ''}
      >
        {failuresError ? (
          <p className="text-sm text-red-600 dark:text-red-400">{failuresError}</p>
        ) : failures === null ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
        ) : failures.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No failure detail was recorded for this send.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {failures.map((f, i) => (
              <li key={i} className="py-2 text-sm">
                <p className="font-medium text-slate-900 dark:text-white">
                  {f.client_name} {f.client_email && <span className="font-normal text-slate-500 dark:text-slate-400">({f.client_email})</span>}
                </p>
                <p className="mt-0.5 text-red-600 dark:text-red-400">{f.error}</p>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}
