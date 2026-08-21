import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import StatusBadge from '../../components/StatusBadge';
import StatusFilterChips from '../../components/StatusFilterChips';
import Pagination from '../../components/Pagination';
import Modal from '../../components/Modal';
import { TableSkeleton } from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import MobileListAccordion from '../../components/MobileListAccordion';
import IconActionButton from '../../components/IconActionButton';
import { InboxIcon, CheckCircleIcon, XIcon } from '../../components/icons';

const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'declined', label: 'Declined' },
];

// Mirrors pages/portal/PortalQuotes.jsx's own requestSummary() — items
// (picked from the catalog) take priority over the free-text description,
// which is now just an optional "anything else?" note alongside them.
function requestSummary(request) {
  if (request.items && request.items.length > 0) {
    return request.items.map((item) => `${item.quantity}× ${item.description}`).join(', ');
  }
  return request.description || '(no description)';
}

// A client's ask for a quote (see routes/clientPortal.js's
// POST /quote-requests) — reviewed here, then turned into a real priced
// quote via the pre-filled QuoteForm (?requestId=) rather than created
// directly, since a request carries no pricing of its own even when it's
// built entirely from catalog items.
export default function QuoteRequests() {
  const { token, can } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const canManage = can('quotes', 'manage');
  const [requests, setRequests] = useState([]);
  const [pageInfo, setPageInfo] = useState(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null); // id of the request currently being declined
  const [declineModal, setDeclineModal] = useState(null); // the request being declined, or null
  const [declineNote, setDeclineNote] = useState('');

  function load() {
    if (requests.length === 0) setLoading(true);
    api.quoteRequests
      .list(token, { status, page })
      .then(({ requests, ...rest }) => {
        setRequests(requests);
        setPageInfo(rest.totalPages ? rest : null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [token, status, page]);
  useEffect(() => {
    setPage(1);
  }, [status]);

  async function handleDecline() {
    setBusy(declineModal.id);
    setError('');
    try {
      await api.quoteRequests.decline(declineModal.id, declineNote, token);
      setDeclineModal(null);
      setDeclineNote('');
      toast('Request declined.', { type: 'success' });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  function rowActions(request) {
    if (request.status !== 'pending') {
      return request.quote_id ? (
        <Link to={`/quotes/${request.quote_id}`} className="text-sm font-medium text-lagoon-600 hover:text-lagoon-500">
          View quote
        </Link>
      ) : null;
    }
    return (
      <>
        {canManage && (
          <IconActionButton
            icon={CheckCircleIcon}
            tone="emerald"
            onClick={() => navigate(`/quotes/new?requestId=${request.id}`)}
            title="Create quote from this request"
            label="Create quote from this request"
          />
        )}
        {canManage && (
          <IconActionButton
            icon={XIcon}
            tone="red"
            disabled={busy === request.id}
            onClick={() => {
              setDeclineModal(request);
              setDeclineNote('');
            }}
            title="Decline"
            label="Decline this request"
          />
        )}
      </>
    );
  }

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Quote requests</h1>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Requests clients have submitted from their portal.</p>

      <div className="mt-4">
        <StatusFilterChips options={STATUS_OPTIONS} value={status} onChange={setStatus} />
      </div>

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-6 rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        {loading ? (
          <div className="overflow-x-auto">
            <TableSkeleton rows={5} cols={['w-32', 'w-64', 'w-24', 'w-24', 'w-24']} />
          </div>
        ) : requests.length === 0 ? (
          <EmptyState
            icon={<InboxIcon />}
            title={status ? `No ${status} requests.` : 'No quote requests yet.'}
            message={!status ? 'When a client submits a quote request from their portal, it will show up here.' : undefined}
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto sm:block">
              <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                    <th className="px-4 py-3">Client</th>
                    <th className="px-4 py-3">Description</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Requested</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {requests.map((request) => (
                    <tr key={request.id}>
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900 dark:text-white">{request.client_name}</td>
                      <td className="max-w-xs truncate px-4 py-3 text-slate-600 dark:text-slate-400" title={requestSummary(request)}>
                        {requestSummary(request)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3" title={request.status === 'declined' ? request.decision_note : undefined}>
                        <StatusBadge status={request.status} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-400">{request.created_at.slice(0, 10)}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex justify-end gap-1.5">{rowActions(request)}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-2.5 sm:hidden">
              {requests.map((request) => (
                <MobileListAccordion
                  key={request.id}
                  name="quote-requests-list"
                  summary={
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-slate-900 dark:text-white">{request.client_name}</p>
                        <p className="truncate text-slate-500 dark:text-slate-400">{requestSummary(request)}</p>
                      </div>
                      <StatusBadge status={request.status} />
                    </div>
                  }
                >
                  <div className="flex justify-between">
                    <dt className="text-slate-500 dark:text-slate-400">Requested</dt>
                    <dd className="text-slate-900 dark:text-white">{request.created_at.slice(0, 10)}</dd>
                  </div>
                  <p className="text-slate-600 dark:text-slate-400">{requestSummary(request)}</p>
                  {request.items?.length > 0 && request.description && (
                    <p className="text-slate-500 dark:text-slate-400">{request.description}</p>
                  )}
                  {request.status === 'declined' && request.decision_note && (
                    <div className="flex justify-between gap-3">
                      <dt className="shrink-0 text-slate-500 dark:text-slate-400">Note</dt>
                      <dd className="text-right text-slate-900 dark:text-white">{request.decision_note}</dd>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1.5 pt-1">{rowActions(request)}</div>
                </MobileListAccordion>
              ))}
            </div>
          </>
        )}
      </div>

      {pageInfo && <Pagination page={pageInfo.page} totalPages={pageInfo.totalPages} onChange={setPage} />}

      <Modal open={declineModal !== null} onClose={() => setDeclineModal(null)} title="Decline quote request">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Declining <span className="font-medium text-slate-900 dark:text-white">{declineModal?.client_name}</span>'s request. An
            optional note is visible to the client in their portal.
          </p>
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Note (optional)</span>
            <textarea
              value={declineNote}
              onChange={(e) => setDeclineNote(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            />
          </label>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeclineModal(null)}
              className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDecline}
              disabled={busy === declineModal?.id}
              className="min-h-11 rounded-md bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-60"
            >
              {busy === declineModal?.id ? 'Declining…' : 'Decline request'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
