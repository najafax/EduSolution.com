import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useUndoableDelete } from '../../lib/useUndoableDelete';
import { useConfirm } from '../../lib/useConfirm';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { todayStr } from '../../lib/date';
import SearchInput from '../../components/SearchInput';
import FloatingActionButton from '../../components/FloatingActionButton';
import Pagination from '../../components/Pagination';
import Modal from '../../components/Modal';
import SearchableSelect from '../../components/SearchableSelect';
import { TableSkeleton } from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import MobileListAccordion from '../../components/MobileListAccordion';
import IconActionButton from '../../components/IconActionButton';
import { BankIcon, DownloadIcon, PlusIcon, PencilIcon, TrashIcon } from '../../components/icons';

// Money an owner/partner puts INTO the business — the mirror of an expense
// tagged "Shareholder payments" (money taken OUT). Same list+modal-form+FAB
// shape as Expenses.jsx/Clients.jsx, simplified: no category (there's only
// one kind of record here), `contributor_name` plays the same role
// `payee`/`payeeFilter` play on the Expenses page.
const EMPTY_FORM = { contributor_name: '', amount: '', contribution_date: todayStr(), notes: '' };

export default function CapitalContributions() {
  const { token, can } = useAuth();
  const { toast } = useToast();
  const canManage = can('expenses', 'manage');
  const [contributions, setContributions] = useState([]);
  const [contributors, setContributors] = useState([]);
  const [pageInfo, setPageInfo] = useState(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [contributorFilter, setContributorFilter] = useState('');

  const { pendingIds, deleteWithUndo } = useUndoableDelete((id) => api.capitalContributions.remove(id, token));
  const visibleContributions = contributions.filter((c) => !pendingIds.has(c.id));
  const { confirm, confirmDialog } = useConfirm();

  function load() {
    setLoading(true);
    api.capitalContributions
      .list(token, { q: debouncedSearch, page, contributor: contributorFilter })
      .then(({ contributions, contributors, totalAmount, ...rest }) => {
        setContributions(contributions);
        setContributors(contributors);
        setTotal(totalAmount);
        setPageInfo(rest.totalPages ? rest : null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [token, debouncedSearch, page, contributorFilter]);
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, contributorFilter]);

  function startCreate() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(true);
  }

  function startEdit(contribution) {
    setForm({
      contributor_name: contribution.contributor_name,
      amount: contribution.amount,
      contribution_date: contribution.contribution_date,
      notes: contribution.notes,
    });
    setEditingId(contribution.id);
    setShowForm(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (editingId) {
        await api.capitalContributions.update(editingId, form, token);
        toast('Contribution updated.', { type: 'success' });
      } else {
        await api.capitalContributions.create(form, token);
        toast('Contribution recorded.', { type: 'success' });
      }
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(contribution) {
    if (!(await confirm({ title: `Delete this contribution from ${contribution.contributor_name}?`, confirmLabel: 'Delete' }))) return;
    deleteWithUndo([contribution.id], `Contribution from "${contribution.contributor_name}" deleted.`);
  }

  async function handleExportCsv() {
    setError('');
    try {
      await api.capitalContributions.exportCsv(token);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleExportXlsx() {
    setError('');
    try {
      await api.capitalContributions.exportXlsx(token);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Capital contributions</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Money an owner or partner has put into the business — separate from client revenue and expenses.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
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
              onClick={startCreate}
              className="flex min-h-11 items-center gap-1.5 rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500"
            >
              <PlusIcon width={16} height={16} />
              New contribution
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 sm:max-w-sm">
          <SearchInput value={search} onChange={setSearch} placeholder="Search contributions…" />
        </div>
        {contributors.length > 0 && (
          <div className="w-full max-w-xs sm:w-56">
            <SearchableSelect
              options={[{ value: '', label: 'All contributors' }, ...contributors.map((c) => ({ value: c, label: c }))]}
              value={contributorFilter}
              onChange={setContributorFilter}
              placeholder="Filter by contributor…"
            />
          </div>
        )}
      </div>

      {error && !showForm && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <Modal open={showForm} onClose={() => setShowForm(false)} title={editingId ? 'Edit contribution' : 'New contribution'} maxWidthClass="max-w-lg">
        <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
          {error && <p className="text-sm text-red-600 dark:text-red-400 sm:col-span-2">{error}</p>}
          <div className="sm:col-span-2">
            <label className="block">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Contributor</span>
              <input
                type="text"
                required
                value={form.contributor_name}
                onChange={(e) => setForm((f) => ({ ...f, contributor_name: e.target.value }))}
                placeholder="Which partner or owner put this money in"
                className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              />
            </label>
          </div>
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Amount</span>
            <input
              type="number"
              min="0.01"
              step="0.01"
              required
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Date</span>
            <div className="mt-1 flex h-11 w-full items-center overflow-hidden rounded-md border border-slate-300 px-3 focus-within:border-lagoon-500 dark:border-slate-600">
              <input
                type="date"
                required
                value={form.contribution_date}
                onChange={(e) => setForm((f) => ({ ...f, contribution_date: e.target.value }))}
                className="h-full w-full appearance-none border-0 bg-transparent p-0 text-base focus:outline-none dark:text-white"
              />
            </div>
          </label>
          <div className="sm:col-span-2">
            <label className="block">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Notes</span>
              <input
                type="text"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Optional context"
                className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              />
            </label>
          </div>
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
              onClick={() => setShowForm(false)}
              className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      <div className="mt-6 rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        {loading ? (
          <div className="overflow-x-auto">
            <TableSkeleton rows={5} cols={canManage ? ['w-24', 'w-32', 'w-40', 'w-20', 'w-16'] : ['w-24', 'w-32', 'w-40', 'w-20']} />
          </div>
        ) : visibleContributions.length === 0 ? (
          <EmptyState
            icon={<BankIcon />}
            title={search || contributorFilter ? 'No contributions match these filters.' : 'No capital contributions yet.'}
            message={!search && !contributorFilter && canManage ? 'Record money a partner or owner has put into the business.' : undefined}
            action={!search && !contributorFilter && canManage ? { label: 'New contribution', onClick: startCreate } : undefined}
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto sm:block">
              <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Contributor</th>
                    <th className="px-4 py-3">Notes</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    {canManage && <th className="px-4 py-3" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {visibleContributions.map((c) => (
                    <tr key={c.id}>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-400">{c.contribution_date}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900 dark:text-white">{c.contributor_name}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{c.notes || '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-slate-900 dark:text-white">{c.amount.toFixed(2)}</td>
                      {canManage && (
                        <td className="whitespace-nowrap px-4 py-3">
                          <div className="flex justify-end gap-1.5">
                            <IconActionButton icon={PencilIcon} tone="slate" onClick={() => startEdit(c)} title="Edit" label="Edit contribution" />
                            <IconActionButton icon={TrashIcon} tone="red" onClick={() => handleDelete(c)} title="Delete" label="Delete contribution" />
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-200 dark:border-slate-700">
                    <td colSpan={3} className="px-4 py-3 text-right text-sm font-semibold text-slate-900 dark:text-white">
                      Total
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-slate-900 dark:text-white">{total.toFixed(2)}</td>
                    {canManage && <td />}
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="sm:hidden">
              <div className="flex flex-col gap-2.5">
                {visibleContributions.map((c) => (
                  <MobileListAccordion
                    key={c.id}
                    name="capital-contributions-list"
                    summary={
                      <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-slate-900 dark:text-white">{c.contributor_name}</p>
                          <p className="text-slate-500 dark:text-slate-400">{c.contribution_date}</p>
                        </div>
                        <p className="shrink-0 text-slate-900 dark:text-white">{c.amount.toFixed(2)}</p>
                      </div>
                    }
                  >
                    {c.notes && (
                      <div className="flex justify-between">
                        <dt className="text-slate-500 dark:text-slate-400">Notes</dt>
                        <dd className="text-slate-900 dark:text-white">{c.notes}</dd>
                      </div>
                    )}
                    {canManage && (
                      <div className="flex gap-1.5 pt-1">
                        <IconActionButton icon={PencilIcon} tone="slate" onClick={() => startEdit(c)} title="Edit" label="Edit contribution" />
                        <IconActionButton icon={TrashIcon} tone="red" onClick={() => handleDelete(c)} title="Delete" label="Delete contribution" />
                      </div>
                    )}
                  </MobileListAccordion>
                ))}
              </div>
              <div className="mt-2.5 flex justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-white">
                <span>Total</span>
                <span>{total.toFixed(2)}</span>
              </div>
            </div>
          </>
        )}
      </div>

      {pageInfo && <Pagination page={pageInfo.page} totalPages={pageInfo.totalPages} onChange={setPage} />}

      {canManage && !showForm && <FloatingActionButton onClick={startCreate} label="New contribution" />}

      {confirmDialog}
    </div>
  );
}
