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
import { InvoiceIcon, ReportIcon, DownloadIcon, PlusIcon, PencilIcon, SendIcon, DuplicateIcon, TrashIcon } from '../../components/icons';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { useConfirm } from '../../lib/useConfirm';
import InvoiceForm from './InvoiceForm';

const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'paid', label: 'Paid' },
  { value: 'void', label: 'Void' },
];

// Left accent stripe on each mobile card (components/MobileListAccordion.jsx)
// — same status meaning as StatusBadge's colors, just as a stripe instead
// of a pill, so status reads before the row is even expanded.
const ACCENT = {
  draft: 'bg-slate-300 dark:bg-slate-600',
  sent: 'bg-lagoon-500',
  paid: 'bg-emerald-500',
  void: 'bg-slate-300 dark:bg-slate-600',
  overdue: 'bg-red-500',
};

export default function Invoices() {
  const { token, can } = useAuth();
  const navigate = useNavigate();
  const canManage = can('invoices', 'manage');
  const [invoices, setInvoices] = useState([]);
  const [pageInfo, setPageInfo] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [status, setStatus] = useState('');
  const [showNewForm, setShowNewForm] = useState(false);
  const [busy, setBusy] = useState(null); // { id, action } — tracks which row/action is in flight
  const [emailModal, setEmailModal] = useState(null); // id of the invoice whose email preview is open, or null
  const { confirm, confirmDialog } = useConfirm();

  function load() {
    // Only show the loading skeleton on the very first load — once there's
    // a list on screen, a refetch (search/filter/page change) keeps the
    // current rows visible until the new ones arrive instead of flashing
    // to a fixed-row-count skeleton whose height matches neither the old
    // nor new result count, which read as the page visibly jumping.
    if (invoices.length === 0) setLoading(true);
    api.invoices
      .list(token, { q: debouncedSearch, page, status })
      .then(({ invoices, ...rest }) => {
        setInvoices(invoices);
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
      await api.invoices.openPdf(id, token);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDuplicate(invoice) {
    if (
      !(await confirm({
        title: 'Duplicate this invoice?',
        message: 'Creates a new draft copy with a fresh number and due date. You can edit it before sending.',
        confirmLabel: 'Duplicate',
        danger: false,
      }))
    )
      return;
    setError('');
    setBusy({ id: invoice.id, action: 'duplicate' });
    try {
      const { invoice: created } = await api.invoices.duplicate(invoice.id, token);
      navigate(`/invoices/${created.id}`);
    } catch (err) {
      setError(err.message);
      setBusy(null);
    }
  }

  async function handleDelete(invoice) {
    if (!(await confirm({ title: 'Delete this invoice?', confirmLabel: 'Delete' }))) return;
    setError('');
    setBusy({ id: invoice.id, action: 'delete' });
    try {
      await api.invoices.remove(invoice.id, token);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  function rowActions(invoice) {
    const rowBusy = busy?.id === invoice.id;
    const isBusy = (action) => rowBusy && busy.action === action;
    const isLocked = invoice.status === 'sent' || invoice.status === 'paid';
    return (
      <>
        {canManage && !isLocked && (
          <IconActionButton
            icon={PencilIcon}
            tone="slate"
            onClick={() => navigate(`/invoices/${invoice.id}/edit`)}
            title="Edit"
            label="Edit invoice"
          />
        )}
        <IconActionButton
          icon={DownloadIcon}
          tone="lagoon"
          onClick={() => handleDownload(invoice.id)}
          title="Download PDF"
          label="Download invoice PDF"
        />
        {canManage && invoice.status !== 'void' && (
          <IconActionButton
            icon={SendIcon}
            tone="lagoon"
            onClick={() => setEmailModal(invoice.id)}
            title="Email to client"
            label="Email invoice to client"
          />
        )}
        {canManage && (
          <IconActionButton
            icon={DuplicateIcon}
            tone="slate"
            onClick={() => handleDuplicate(invoice)}
            disabled={rowBusy}
            spinning={isBusy('duplicate')}
            title={isBusy('duplicate') ? 'Duplicating…' : 'Duplicate'}
            label="Duplicate invoice"
          />
        )}
        {canManage && (
          <IconActionButton
            icon={TrashIcon}
            tone="red"
            onClick={() => handleDelete(invoice)}
            disabled={rowBusy}
            spinning={isBusy('delete')}
            title={isBusy('delete') ? 'Deleting…' : 'Delete'}
            label="Delete invoice"
          />
        )}
      </>
    );
  }

  async function handleExportCsv() {
    setError('');
    try {
      await api.invoices.exportCsv(token);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleExportXlsx() {
    setError('');
    try {
      await api.invoices.exportXlsx(token);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Invoices</h1>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/invoices/analytics"
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
              New invoice
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 sm:max-w-sm">
        <SearchInput value={search} onChange={setSearch} placeholder="Search invoices…" />
      </div>

      <div className="mt-3">
        <StatusFilterChips options={STATUS_OPTIONS} value={status} onChange={setStatus} />
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <div className="mt-6 rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        {loading ? (
          <div className="overflow-x-auto">
            <TableSkeleton rows={5} cols={['w-28', 'w-32', 'w-24', 'w-20', 'w-20', 'w-20', 'w-32']} />
          </div>
        ) : invoices.length === 0 ? (
          <EmptyState
            icon={<InvoiceIcon />}
            title={search || status ? 'No invoices match these filters.' : 'No invoices yet.'}
            message={!search && !status && canManage ? 'Create an invoice to bill a client.' : undefined}
            action={!search && !status && canManage ? { label: 'New invoice', onClick: () => setShowNewForm(true) } : undefined}
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto sm:block">
              <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                    <th className="px-4 py-3">Number</th>
                    <th className="px-4 py-3">Client</th>
                    <th className="px-4 py-3">Due</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3 text-right">Balance due</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {invoices.map((invoice) => (
                    <tr key={invoice.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                      <td className="whitespace-nowrap px-4 py-3">
                        <Link to={`/invoices/${invoice.id}`} className="font-medium text-lagoon-600 hover:text-lagoon-500">
                          {invoice.number}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-400">{invoice.client_name}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-400">{invoice.due_date}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <StatusBadge status={invoice.is_overdue ? 'overdue' : invoice.status} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-slate-900 dark:text-white">{invoice.total.toFixed(2)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-slate-900 dark:text-white">{invoice.balance_due.toFixed(2)}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex justify-end gap-1.5">{rowActions(invoice)}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-2.5 sm:hidden">
              {invoices.map((invoice) => (
                <MobileListAccordion
                  key={invoice.id}
                  name="invoices-list"
                  accent={ACCENT[invoice.is_overdue ? 'overdue' : invoice.status]}
                  summary={
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <Link
                          to={`/invoices/${invoice.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="font-medium text-lagoon-600 hover:text-lagoon-500"
                        >
                          {invoice.number}
                        </Link>
                        <p className="truncate text-slate-500 dark:text-slate-400">{invoice.client_name}</p>
                      </div>
                      <StatusBadge status={invoice.is_overdue ? 'overdue' : invoice.status} />
                    </div>
                  }
                >
                  <div className="flex justify-between">
                    <dt className="text-slate-500 dark:text-slate-400">Due</dt>
                    <dd className="text-slate-900 dark:text-white">{invoice.due_date}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500 dark:text-slate-400">Total</dt>
                    <dd className="text-slate-900 dark:text-white">{invoice.total.toFixed(2)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500 dark:text-slate-400">Balance due</dt>
                    <dd className="text-slate-900 dark:text-white">{invoice.balance_due.toFixed(2)}</dd>
                  </div>
                  <div className="flex flex-wrap gap-1.5 pt-1">{rowActions(invoice)}</div>
                </MobileListAccordion>
              ))}
            </div>
          </>
        )}
      </div>

      {pageInfo && <Pagination page={pageInfo.page} totalPages={pageInfo.totalPages} onChange={setPage} />}

      <Modal open={showNewForm} onClose={() => setShowNewForm(false)} title="New invoice" maxWidthClass="max-w-3xl">
        <InvoiceForm
          embedded
          idOverride={null}
          onSuccess={(invoice) => {
            setShowNewForm(false);
            navigate(`/invoices/${invoice.id}`);
          }}
          onCancel={() => setShowNewForm(false)}
        />
      </Modal>

      {canManage && !showNewForm && <FloatingActionButton onClick={() => setShowNewForm(true)} label="New invoice" />}

      <EmailPreviewModal
        open={emailModal !== null}
        onClose={() => setEmailModal(null)}
        title="Review email before sending"
        loadPreview={() => api.invoices.sendPreview(emailModal, token)}
        onSend={async ({ subject, message }) => {
          await api.invoices.send(emailModal, { subject, message }, token);
          load();
        }}
      />

      {confirmDialog}
    </div>
  );
}
