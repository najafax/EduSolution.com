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
import PageToolbar from '../../components/PageToolbar';
import PageMenu from '../../components/PageMenu';
import IconActionButton from '../../components/IconActionButton';
import RowActions from '../../components/RowActions';
import VoidReasonModal from '../../components/VoidReasonModal';
import RecordPaymentModal from '../../components/RecordPaymentModal';
import KpiCard from '../../components/KpiCard';
import {
  InvoiceIcon,
  ReportIcon,
  DownloadIcon,
  PlusIcon,
  PencilIcon,
  SendIcon,
  XIcon,
  BanknoteIcon,
  RefreshIcon,
  ClockIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
} from '../../components/icons';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { useConfirm } from '../../lib/useConfirm';
import InvoiceForm from './InvoiceForm';

// 'overdue' isn't a stored invoice status — routes/invoices.js's own
// statusWhere() derives it from status/due_date/amount_paid the same way
// withComputed()'s is_overdue field already does, mirroring how
// Licenses.jsx's own status chips mix stored values with a derived
// 'expiring_soon'/'expired' pair into one filter.
const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'overdue', label: 'Overdue' },
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
  const [emailModal, setEmailModal] = useState(null); // id of the invoice whose email preview is open, or null
  const [voidTarget, setVoidTarget] = useState(null); // the invoice being voided, or null
  const [voidError, setVoidError] = useState('');
  const [paymentTarget, setPaymentTarget] = useState(null); // the invoice being paid, or null
  const [paymentNotice, setPaymentNotice] = useState('');
  // Desktop (xl:) split view: the row whose details/actions show in the side panel.
  const [selectedId, setSelectedId] = useState(null);
  const [summary, setSummary] = useState(null);
  const { confirm, confirmDialog } = useConfirm();

  // A small "how are things right now" strip above the list — Outstanding/
  // Overdue/Collected, computed from the invoices this user can already see
  // under their own `invoices:view` grant. Deliberately not a call to
  // /api/financials/summary (which would need its own, more restricted
  // `financials` permission — see CLAUDE.md's "Sensitive modules" section —
  // and would scope badly to this page's own filters anyway): a single,
  // independent, unfiltered fetch (no `page`, so the backend returns every
  // invoice regardless of what the table's own search/status/page state is
  // currently showing), recomputed client-side the same way Dashboard.jsx's
  // own "Needs attention" panel already filters a full invoice list for
  // is_overdue. Outstanding/Overdue only ever count `sent` invoices — a
  // draft hasn't been billed yet, and void/paid have nothing left owing —
  // mirroring routes/invoices.js's own is_overdue definition exactly.
  function loadSummary() {
    api.invoices
      .list(token)
      .then(({ invoices: all }) => {
        let outstandingTotal = 0;
        let overdueCount = 0;
        let overdueAmount = 0;
        let collectedTotal = 0;
        all.forEach((inv) => {
          if (inv.status === 'sent') {
            outstandingTotal += inv.balance_due;
            if (inv.is_overdue) {
              overdueCount += 1;
              overdueAmount += inv.balance_due;
            }
          }
          if (inv.status !== 'void') collectedTotal += inv.amount_paid;
        });
        setSummary({ outstandingTotal, overdueCount, overdueAmount, collectedTotal });
      })
      .catch(() => {});
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadSummary, [token]);

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

  // Mirrors InvoiceDetail.jsx's own canVoid guard (which itself mirrors the
  // backend's POST /:id/void 409s) — never show a button that would just
  // error: void is reachable from draft or sent, not once paid, already
  // void, or partially paid (amount_paid > 0 would silently orphan a
  // recorded payment on a "this doesn't count" invoice).
  function canVoid(invoice) {
    return (invoice.status === 'draft' || invoice.status === 'sent') && invoice.amount_paid === 0;
  }

  async function handleVoid(reason) {
    setVoidError('');
    try {
      await api.invoices.void(voidTarget.id, reason, token);
      setVoidTarget(null);
      load();
      loadSummary();
    } catch (err) {
      setVoidError(err.message);
      throw err;
    }
  }

  async function handleRecover(invoice) {
    if (
      !(await confirm({
        title: `Recover ${invoice.number}?`,
        message: 'This puts the invoice back to its status right before it was voided, so it counts in financial totals and reports again.',
        confirmLabel: 'Recover',
        danger: false,
      }))
    )
      return;
    setError('');
    try {
      await api.invoices.recover(invoice.id, token);
      load();
      loadSummary();
    } catch (err) {
      setError(err.message);
    }
  }

  function handlePaymentRecorded(result) {
    setPaymentTarget(null);
    const autoRenewed = result.autoRenewedLicenses || [];
    const notices = ['Payment recorded.'];
    if (autoRenewed.length > 0) notices.push(`Also renewed: ${autoRenewed.map((l) => l.name).join(', ')}.`);
    setPaymentNotice(notices.join(' '));
    load();
    loadSummary();
  }

  function rowActions(invoice) {
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
        {canManage && invoice.status === 'sent' && invoice.balance_due > 0 && (
          <IconActionButton
            icon={BanknoteIcon}
            tone="emerald"
            onClick={() => { setPaymentNotice(''); setPaymentTarget(invoice); }}
            title="Record payment"
            label="Record a payment for this invoice"
          />
        )}
        {canManage && invoice.status !== 'void' && (
          <IconActionButton
            icon={SendIcon}
            tone="lagoon"
            onClick={() => setEmailModal(invoice.id)}
            title="Email to client"
            label="Email invoice to client"
          />
        )}
        {canManage && canVoid(invoice) && (
          <IconActionButton
            icon={XIcon}
            tone="red"
            onClick={() => { setVoidError(''); setVoidTarget(invoice); }}
            title="Void"
            label="Void invoice"
          />
        )}
        {canManage && invoice.status === 'void' && (
          <IconActionButton
            icon={RefreshIcon}
            tone="lagoon"
            onClick={() => handleRecover(invoice)}
            title="Recover"
            label="Recover invoice"
          />
        )}
      </>
    );
  }

  // Exports whatever's currently filtered on this page (status chip, and
  // the search box once its debounce settles) rather than always the full
  // table — see routes/invoices.js's own loadInvoiceExport() note on why
  // this route accepts the same status/q the list itself does.
  async function handleExportCsv() {
    setError('');
    try {
      await api.invoices.exportCsv(token, { status, q: debouncedSearch });
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleExportXlsx() {
    setError('');
    try {
      await api.invoices.exportXlsx(token, { status, q: debouncedSearch });
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8 xl:py-6">
      <PageToolbar
        title="Invoices"
        actions={
          <>

          <PageMenu items={[{ label: 'Analytics', icon: ReportIcon, to: '/invoices/analytics' }, { label: 'Export CSV', icon: DownloadIcon, onClick: handleExportCsv }, { label: 'Export Excel', icon: DownloadIcon, onClick: handleExportXlsx }]} />
          {canManage && (
            <button
              onClick={() => setShowNewForm(true)}
              className="flex min-h-11 items-center gap-1.5 rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-700 dark:bg-lagoon-600 dark:hover:bg-lagoon-500"
            >
              <PlusIcon width={16} height={16} />
              New invoice
            </button>
          )}
        
          </>
        }
        search={<SearchInput value={search} onChange={setSearch} placeholder="Search invoices…" />}
        filters={<StatusFilterChips options={STATUS_OPTIONS} value={status} onChange={setStatus} />}
      />

      {summary && (
        <div className="-mx-4 mt-4 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden [&>*]:min-w-[11rem] [&>*]:snap-start sm:[&>*]:min-w-0">
          <KpiCard icon={<ClockIcon />} label="Outstanding" value={summary.outstandingTotal.toFixed(2)} tone="neutral" />
          <KpiCard
            icon={<AlertTriangleIcon />}
            label="Overdue"
            value={summary.overdueAmount.toFixed(2)}
            sub={`${summary.overdueCount} invoice${summary.overdueCount === 1 ? '' : 's'}`}
            tone={summary.overdueCount > 0 ? 'negative' : 'neutral'}
          />
          <KpiCard icon={<CheckCircleIcon />} label="Collected" value={summary.collectedTotal.toFixed(2)} tone="positive" />
        </div>
      )}



      {paymentNotice && <p className="mt-4 text-sm text-emerald-600 dark:text-emerald-400">{paymentNotice}</p>}
      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {/* Studio stage 3: at xl: and up the list and the selected invoice sit
          side by side, so a row's details and every action are one click away
          without leaving the list. Below xl: the layout is unchanged (the
          panel is hidden; rows keep their own primary action + menu). */}
      <div className="mt-6 xl:grid xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start xl:gap-4">
      <div className="rounded-3xl bg-white dark:border shadow-sm dark:border-slate-700 dark:bg-slate-900">
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
                    <th className="px-4 py-3 xl:hidden" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {invoices.map((invoice) => (
                    <tr
                      key={invoice.id}
                      onClick={() => setSelectedId(invoice.id)}
                      aria-selected={selectedId === invoice.id}
                      className={`cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 ${selectedId === invoice.id ? 'bg-lagoon-50/60 dark:bg-lagoon-950/40' : ''}`}
                    >
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
                      <td className="whitespace-nowrap px-4 py-3 xl:hidden" onClick={(e) => e.stopPropagation()}>
                        <RowActions>{rowActions(invoice)}</RowActions>
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
                  <div className="pt-1"><RowActions fill>{rowActions(invoice)}</RowActions></div>
                </MobileListAccordion>
              ))}
            </div>
          </>
        )}
      </div>

      <aside className="sticky top-20 hidden rounded-3xl bg-white p-5 shadow-sm xl:block dark:border dark:border-slate-700 dark:bg-slate-900" aria-label="Selected invoice">
        {(() => {
          const sel = invoices.find((i) => i.id === selectedId);
          if (!sel) {
            return <p className="text-sm text-slate-500 dark:text-slate-400">Select an invoice to see its details and actions here.</p>;
          }
          const pct = sel.total > 0 ? Math.min(100, Math.round(((sel.total - sel.balance_due) / sel.total) * 100)) : 0;
          return (
            <div className="flex flex-col gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{sel.number}</p>
                <p className="mt-1 font-semibold text-slate-900 dark:text-white">{sel.client_name}</p>
                <div className="mt-2"><StatusBadge status={sel.is_overdue ? 'overdue' : sel.status} /></div>
              </div>
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400">Balance due</p>
                <p className="font-display text-3xl font-extrabold tabular-nums text-slate-900 dark:text-white">{sel.balance_due.toFixed(2)}</p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Paid {(sel.total - sel.balance_due).toFixed(2)} of {sel.total.toFixed(2)} · Due {sel.due_date}
                </p>
              </div>
              <RowActions expanded>{rowActions(sel)}</RowActions>
              <Link to={`/invoices/${sel.id}`} className="text-sm font-semibold text-lagoon-700 hover:text-lagoon-600 dark:text-lagoon-300">
                Open full page →
              </Link>
            </div>
          );
        })()}
      </aside>
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

      <VoidReasonModal
        open={voidTarget !== null}
        onClose={() => setVoidTarget(null)}
        onVoid={handleVoid}
        title={voidTarget ? `Void ${voidTarget.number}?` : 'Void this invoice?'}
        error={voidError}
      />

      <RecordPaymentModal
        open={paymentTarget !== null}
        onClose={() => setPaymentTarget(null)}
        invoice={paymentTarget}
        token={token}
        onRecorded={handlePaymentRecorded}
      />
      {confirmDialog}
    </div>
  );
}
