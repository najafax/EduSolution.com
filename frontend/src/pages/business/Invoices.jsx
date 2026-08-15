import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useUndoableDelete } from '../../lib/useUndoableDelete';
import StatusBadge from '../../components/StatusBadge';
import SearchInput from '../../components/SearchInput';
import FloatingActionButton from '../../components/FloatingActionButton';
import Pagination from '../../components/Pagination';
import Modal from '../../components/Modal';
import { TableSkeleton } from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import BulkActionBar from '../../components/BulkActionBar';
import StatusFilterChips from '../../components/StatusFilterChips';
import { InvoiceIcon } from '../../components/icons';
import InvoiceForm from './InvoiceForm';

const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'paid', label: 'Paid' },
  { value: 'void', label: 'Void' },
];

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
  const [status, setStatus] = useState('');
  const [showNewForm, setShowNewForm] = useState(false);
  const [selected, setSelected] = useState(() => new Set());

  const { pendingIds, deleteWithUndo } = useUndoableDelete((id) => api.invoices.remove(id, token));
  const visibleInvoices = invoices.filter((i) => !pendingIds.has(i.id));

  useEffect(() => {
    setLoading(true);
    api.invoices
      .list(token, { q: search, page, status })
      .then(({ invoices, ...rest }) => {
        setInvoices(invoices);
        setPageInfo(rest.totalPages ? rest : null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token, search, page, status]);
  useEffect(() => {
    setPage(1);
  }, [search, status]);
  useEffect(() => {
    setSelected(new Set());
  }, [invoices]);

  async function handleExport() {
    setError('');
    try {
      await api.invoices.exportCsv(token);
    } catch (err) {
      setError(err.message);
    }
  }

  function handleBulkDelete() {
    const ids = [...selected];
    deleteWithUndo(ids, `${ids.length} invoice${ids.length === 1 ? '' : 's'} deleted.`);
    setSelected(new Set());
  }

  function toggleSelected(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => (prev.size === visibleInvoices.length ? new Set() : new Set(visibleInvoices.map((i) => i.id))));
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Invoices</h1>
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Export CSV
          </button>
          {canManage && (
            <button
              onClick={() => setShowNewForm(true)}
              className="flex min-h-11 items-center rounded-md bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-500"
            >
              New invoice
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 max-w-sm">
        <SearchInput value={search} onChange={setSearch} placeholder="Search invoices…" />
      </div>

      <div className="mt-3">
        <StatusFilterChips options={STATUS_OPTIONS} value={status} onChange={setStatus} />
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {canManage && (
        <BulkActionBar count={selected.size} onClear={() => setSelected(new Set())}>
          <button
            type="button"
            onClick={handleBulkDelete}
            className="min-h-9 rounded-md border border-red-300 px-3 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
          >
            Delete
          </button>
        </BulkActionBar>
      )}

      <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        {loading ? (
          <TableSkeleton rows={5} cols={canManage ? ['w-8', 'w-28', 'w-32', 'w-24', 'w-20', 'w-20', 'w-20'] : ['w-28', 'w-32', 'w-24', 'w-20', 'w-20', 'w-20']} />
        ) : visibleInvoices.length === 0 ? (
          <EmptyState
            icon={<InvoiceIcon />}
            title={search || status ? 'No invoices match these filters.' : 'No invoices yet.'}
            message={!search && !status && canManage ? 'Create an invoice to bill a client.' : undefined}
            action={!search && !status && canManage ? { label: 'New invoice', onClick: () => setShowNewForm(true) } : undefined}
          />
        ) : (
          <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
            <thead>
              <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                {canManage && (
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.size > 0 && selected.size === visibleInvoices.length}
                      onChange={toggleSelectAll}
                      aria-label="Select all invoices"
                      className="h-4 w-4 rounded border-slate-300"
                    />
                  </th>
                )}
                <th className="px-4 py-3">Number</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Due</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-right">Balance due</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {visibleInvoices.map((invoice) => (
                <tr key={invoice.id} className={`hover:bg-slate-50 dark:hover:bg-slate-800 ${selected.has(invoice.id) ? 'bg-indigo-50/50 dark:bg-indigo-950/30' : ''}`}>
                  {canManage && (
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(invoice.id)}
                        onChange={() => toggleSelected(invoice.id)}
                        aria-label={`Select ${invoice.number}`}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                    </td>
                  )}
                  <td className="whitespace-nowrap px-4 py-3">
                    <Link to={`/invoices/${invoice.id}`} className="font-medium text-indigo-600 hover:text-indigo-500">
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
                </tr>
              ))}
            </tbody>
          </table>
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
    </div>
  );
}
