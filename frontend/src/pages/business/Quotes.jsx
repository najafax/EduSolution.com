import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import StatusBadge from '../../components/StatusBadge';
import SearchInput from '../../components/SearchInput';
import FloatingActionButton from '../../components/FloatingActionButton';
import Pagination from '../../components/Pagination';
import Modal from '../../components/Modal';
import { TableSkeleton } from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import StatusFilterChips from '../../components/StatusFilterChips';
import MobileListAccordion from '../../components/MobileListAccordion';
import EmailPreviewModal from '../../components/EmailPreviewModal';
import IconActionButton from '../../components/IconActionButton';
import VoidReasonModal from '../../components/VoidReasonModal';
import { InvoiceIcon, ReportIcon, DownloadIcon, PlusIcon, PencilIcon, SendIcon, DuplicateIcon, XIcon } from '../../components/icons';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { useConfirm } from '../../lib/useConfirm';
import QuoteForm from './QuoteForm';

const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'declined', label: 'Declined' },
  { value: 'expired', label: 'Expired' },
  { value: 'void', label: 'Void' },
];

// Left accent stripe on each mobile card (components/MobileListAccordion.jsx)
// — same status meaning as StatusBadge's colors, just as a stripe instead
// of a pill, so status reads before the row is even expanded.
const ACCENT = {
  draft: 'bg-slate-300 dark:bg-slate-600',
  sent: 'bg-lagoon-500',
  accepted: 'bg-emerald-500',
  declined: 'bg-red-500',
  expired: 'bg-amber-500',
  void: 'bg-slate-300 dark:bg-slate-600',
};

export default function Quotes() {
  const { token, can } = useAuth();
  const navigate = useNavigate();
  const canManage = can('quotes', 'manage');
  const [quotes, setQuotes] = useState([]);
  const [pageInfo, setPageInfo] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [status, setStatus] = useState('');
  const [showNewForm, setShowNewForm] = useState(false);
  const [busy, setBusy] = useState(null); // { id, action } — tracks which row/action is in flight
  const [emailModal, setEmailModal] = useState(null); // id of the quote whose email preview is open, or null
  const [voidTarget, setVoidTarget] = useState(null); // the quote being voided, or null
  const [voidError, setVoidError] = useState('');
  const { confirm, confirmDialog } = useConfirm();

  function load() {
    // Only show the loading skeleton on the very first load — once there's
    // a list on screen, a refetch (search/filter/page change) keeps the
    // current rows visible until the new ones arrive instead of flashing
    // to a fixed-row-count skeleton whose height matches neither the old
    // nor new result count, which read as the page visibly jumping.
    if (quotes.length === 0) setLoading(true);
    api.quotes
      .list(token, { q: debouncedSearch, page, status })
      .then(({ quotes, ...rest }) => {
        setQuotes(quotes);
        setPageInfo(rest.totalPages ? rest : null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [token, debouncedSearch, page, status]);
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, status]);

  async function handleDownload(id) {
    setError('');
    try {
      await api.quotes.openPdf(id, token);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDuplicate(quote) {
    if (
      !(await confirm({
        title: 'Duplicate this quote?',
        message: 'Creates a new draft copy with a fresh number and issue date. You can edit it before sending.',
        confirmLabel: 'Duplicate',
        danger: false,
      }))
    )
      return;
    setError('');
    setBusy({ id: quote.id, action: 'duplicate' });
    try {
      const { quote: created } = await api.quotes.duplicate(quote.id, token);
      navigate(`/quotes/${created.id}`);
    } catch (err) {
      setError(err.message);
      setBusy(null);
    }
  }

  // Mirrors the backend's POST /:id/void 409 guard (routes/quotes.js) —
  // never show a button that would just error. A converted quote's real
  // transaction has already moved to a live invoice, so voiding it is
  // meaningless; an already-void quote has nothing left to void.
  function canVoid(quote) {
    return !quote.converted_invoice_id && quote.status !== 'void';
  }

  async function handleVoid(reason) {
    setVoidError('');
    try {
      await api.quotes.void(voidTarget.id, reason, token);
      setVoidTarget(null);
      load();
    } catch (err) {
      setVoidError(err.message);
      throw err;
    }
  }

  function rowActions(quote) {
    const rowBusy = busy?.id === quote.id;
    const isBusy = (action) => rowBusy && busy.action === action;
    return (
      <>
        {canManage && !quote.converted_invoice_id && (
          <IconActionButton
            icon={PencilIcon}
            tone="slate"
            onClick={() => navigate(`/quotes/${quote.id}/edit`)}
            title="Edit"
            label="Edit quote"
          />
        )}
        <IconActionButton
          icon={DownloadIcon}
          tone="lagoon"
          onClick={() => handleDownload(quote.id)}
          title="Download PDF"
          label="Download quote PDF"
        />
        {canManage && (
          <IconActionButton
            icon={SendIcon}
            tone="lagoon"
            onClick={() => setEmailModal(quote.id)}
            title="Email to client"
            label="Email quote to client"
          />
        )}
        {canManage && (
          <IconActionButton
            icon={DuplicateIcon}
            tone="slate"
            onClick={() => handleDuplicate(quote)}
            disabled={rowBusy}
            spinning={isBusy('duplicate')}
            title={isBusy('duplicate') ? 'Duplicating…' : 'Duplicate'}
            label="Duplicate quote"
          />
        )}
        {canManage && canVoid(quote) && (
          <IconActionButton
            icon={XIcon}
            tone="red"
            onClick={() => { setVoidError(''); setVoidTarget(quote); }}
            disabled={rowBusy}
            title="Void"
            label="Void quote"
          />
        )}
      </>
    );
  }

  async function handleExportCsv() {
    setError('');
    try {
      await api.quotes.exportCsv(token);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleExportXlsx() {
    setError('');
    try {
      await api.quotes.exportXlsx(token);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Quotes</h1>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/quotes/analytics"
            className="flex min-h-11 items-center gap-1.5 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <ReportIcon width={16} height={16} />
            Analytics
          </Link>
          <button
            onClick={handleExportCsv}
            className="flex min-h-11 items-center gap-1.5 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <DownloadIcon width={16} height={16} />
            Export CSV
          </button>
          <button
            onClick={handleExportXlsx}
            className="hidden min-h-11 items-center gap-1.5 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800 sm:flex"
          >
            <DownloadIcon width={16} height={16} />
            Export Excel
          </button>
          {canManage && (
            <button
              onClick={() => setShowNewForm(true)}
              className="flex min-h-11 items-center gap-1.5 rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500"
            >
              <PlusIcon width={16} height={16} />
              New quote
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 sm:max-w-sm">
        <SearchInput value={search} onChange={setSearch} placeholder="Search quotes…" />
      </div>

      <div className="mt-3">
        <StatusFilterChips options={STATUS_OPTIONS} value={status} onChange={setStatus} />
      </div>

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-6 rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        {loading ? (
          <div className="overflow-x-auto">
            <TableSkeleton rows={5} cols={['w-28', 'w-32', 'w-24', 'w-20', 'w-20', 'w-32']} />
          </div>
        ) : quotes.length === 0 ? (
          <EmptyState
            icon={<InvoiceIcon />}
            title={search || status ? 'No quotes match these filters.' : 'No quotes yet.'}
            message={!search && !status && canManage ? 'Create a quote to send to a client for approval.' : undefined}
            action={!search && !status && canManage ? { label: 'New quote', onClick: () => setShowNewForm(true) } : undefined}
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto sm:block">
              <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                    <th className="px-4 py-3">Number</th>
                    <th className="px-4 py-3">Client</th>
                    <th className="px-4 py-3">Issued</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {quotes.map((quote) => (
                    <tr key={quote.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                      <td className="whitespace-nowrap px-4 py-3">
                        <Link to={`/quotes/${quote.id}`} className="font-medium text-lagoon-600 hover:text-lagoon-500">
                          {quote.number}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-400">{quote.client_name}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-400">{quote.issue_date}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <StatusBadge status={quote.status} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-slate-900 dark:text-white">{quote.total.toFixed(2)}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex justify-end gap-1.5">{rowActions(quote)}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-2.5 sm:hidden">
              {quotes.map((quote) => (
                <MobileListAccordion
                  key={quote.id}
                  name="quotes-list"
                  accent={ACCENT[quote.status]}
                  summary={
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <Link
                          to={`/quotes/${quote.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="font-medium text-lagoon-600 hover:text-lagoon-500"
                        >
                          {quote.number}
                        </Link>
                        <p className="truncate text-slate-500 dark:text-slate-400">{quote.client_name}</p>
                      </div>
                      <StatusBadge status={quote.status} />
                    </div>
                  }
                >
                  <div className="flex justify-between">
                    <dt className="text-slate-500 dark:text-slate-400">Issued</dt>
                    <dd className="text-slate-900 dark:text-white">{quote.issue_date}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500 dark:text-slate-400">Total</dt>
                    <dd className="text-slate-900 dark:text-white">{quote.total.toFixed(2)}</dd>
                  </div>
                  <div className="flex flex-wrap gap-1.5 pt-1">{rowActions(quote)}</div>
                </MobileListAccordion>
              ))}
            </div>
          </>
        )}
      </div>

      {pageInfo && <Pagination page={pageInfo.page} totalPages={pageInfo.totalPages} onChange={setPage} />}

      <Modal open={showNewForm} onClose={() => setShowNewForm(false)} title="New quote" maxWidthClass="max-w-3xl">
        <QuoteForm
          embedded
          idOverride={null}
          onSuccess={(quote) => {
            setShowNewForm(false);
            navigate(`/quotes/${quote.id}`);
          }}
          onCancel={() => setShowNewForm(false)}
        />
      </Modal>

      {canManage && !showNewForm && <FloatingActionButton onClick={() => setShowNewForm(true)} label="New quote" />}

      <EmailPreviewModal
        open={emailModal !== null}
        onClose={() => setEmailModal(null)}
        title="Review email before sending"
        loadPreview={() => api.quotes.sendPreview(emailModal, token)}
        onSend={async ({ subject, message }) => {
          await api.quotes.send(emailModal, { subject, message }, token);
          load();
        }}
      />

      <VoidReasonModal
        open={voidTarget !== null}
        onClose={() => setVoidTarget(null)}
        onVoid={handleVoid}
        title={voidTarget ? `Void ${voidTarget.number}?` : 'Void this quote?'}
        error={voidError}
      />

      {confirmDialog}
    </div>
  );
}
