import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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
import StatusFilterChips from '../../components/StatusFilterChips';
import SearchableSelect from '../../components/SearchableSelect';
import { TableSkeleton } from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import MobileListAccordion from '../../components/MobileListAccordion';
import PageToolbar from '../../components/PageToolbar';
import PageMenu from '../../components/PageMenu';
import IconActionButton from '../../components/IconActionButton';
import ImportResultsTable from '../../components/ImportResultsTable';
import { ExpenseIcon, DownloadIcon, UploadIcon, PlusIcon, PencilIcon, TrashIcon, ReportIcon } from '../../components/icons';

// Same template content as pages/business/Import.jsx's own `expenses`
// entry in its TEMPLATES map — duplicated rather than imported (a plain
// string, not worth coupling two page files over), same acceptable-
// duplication call Products.jsx's own PRODUCTS_CSV_TEMPLATE already
// makes. Keep both in sync if the columns ever change. Shows a mix of
// categories on purpose — the whole point of this template is to
// demonstrate that one file can carry every category at once.
const EXPENSES_CSV_TEMPLATE =
  'category,description,amount,expense_date,payee,notes\n' +
  'rent,Office rent for March,15000,2026-03-01,,\n' +
  'shareholder payments,Q1 dividend,5000,2026-03-15,Jane Doe,\n';

function downloadExpensesTemplate() {
  const blob = new Blob([EXPENSES_CSV_TEMPLATE], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'expenses-import-template.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// The embedded counterpart to the standalone Import page's own `expenses`
// type (routes/import.js's POST /api/import/expenses backs both) — asked
// for directly on this page, same reasoning Products.jsx's own embedded
// import got: sending someone to the generic Import page just to bring in
// a batch of expenses is unnecessary friction. This one file handles
// every category — a row's own `category` column decides what it becomes,
// exactly like the manual form's own Category dropdown. (Buying USD and
// paying suppliers are tracked on the Supplier Costs page, not here.)
function ImportModal({ open, onClose, token, onImported }) {
  const [fileName, setFileName] = useState('');
  const [csvText, setCsvText] = useState('');
  const [preview, setPreview] = useState(null);
  const [committed, setCommitted] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function reset() {
    setFileName('');
    setCsvText('');
    setPreview(null);
    setCommitted(null);
    setError('');
  }

  function handleClose() {
    reset();
    onClose();
  }

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setPreview(null);
    setCommitted(null);
    setError('');
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result || ''));
    reader.readAsText(file);
  }

  async function handlePreview() {
    if (!csvText) return;
    setBusy(true);
    setError('');
    setCommitted(null);
    try {
      setPreview(await api.import.run('expenses', csvText, false, token));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm() {
    setBusy(true);
    setError('');
    try {
      const result = await api.import.run('expenses', csvText, true, token);
      setCommitted(result);
      setPreview(null);
      if (result.imported > 0) onImported();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="Import expenses" maxWidthClass="max-w-2xl">
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Bring in a batch of expenses from a CSV file — any category, all in one file.
        Preview first to catch errors — nothing is saved until you confirm.
      </p>

      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Expected columns</p>
        <p className="mt-1 break-words font-mono text-xs text-slate-600 dark:text-slate-400">
          category*, description*, amount*, expense_date*, payee, notes
        </p>
        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">* required</p>
        <button
          type="button"
          onClick={downloadExpensesTemplate}
          className="mt-3 min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-white dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-900"
        >
          Download template
        </button>
      </div>

      <div className="mt-4">
        <label className="block">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">CSV file</span>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={handleFile}
            className="mt-1 block w-full text-sm text-slate-600 file:mr-4 file:min-h-11 file:rounded-md file:border-0 file:bg-lagoon-50 file:px-4 file:text-sm file:font-medium file:text-lagoon-700 hover:file:bg-lagoon-100 dark:text-slate-400 dark:file:bg-lagoon-950 dark:file:text-lagoon-400 dark:hover:file:bg-lagoon-900"
          />
        </label>
        {fileName && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Selected: {fileName}</p>}
      </div>

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-4 flex gap-3">
        <button
          type="button"
          onClick={handlePreview}
          disabled={!csvText || busy}
          className="min-h-11 rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-700 dark:bg-lagoon-600 dark:hover:bg-lagoon-500 disabled:opacity-60"
        >
          {busy ? 'Working…' : 'Preview'}
        </button>
        <button
          type="button"
          onClick={handleClose}
          className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Close
        </button>
      </div>

      {preview && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-white dark:border-amber-700 dark:bg-slate-900">
          <p className="rounded-t-lg border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300">
            Preview only — nothing has been saved yet.
          </p>
          <div className="flex flex-wrap items-center justify-between gap-3 p-4">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              {preview.validCount} of {preview.total} row(s) ready to import
              {preview.errorCount > 0 && <span className="text-red-600 dark:text-red-400"> ({preview.errorCount} with errors)</span>}
            </h2>
            {preview.validCount > 0 && (
              <button
                type="button"
                onClick={handleConfirm}
                disabled={busy}
                className="min-h-11 rounded-md bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
              >
                {busy ? 'Importing…' : `Confirm import (${preview.validCount})`}
              </button>
            )}
          </div>
          <div className="px-4 pb-4">
            <ImportResultsTable results={preview.results} />
          </div>
        </div>
      )}

      {committed && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950">
          <h2 className="text-sm font-semibold text-emerald-900 dark:text-emerald-300">
            Imported {committed.imported} of {committed.total} row(s)
            {committed.errorCount > 0 && ` — ${committed.errorCount} skipped`}
          </h2>
          <ImportResultsTable results={committed.results} />
        </div>
      )}
    </Modal>
  );
}

const EMPTY_FORM = {
  category: 'other',
  description: '',
  amount: '',
  expense_date: todayStr(),
  payee: '',
  notes: '',
};

export default function Expenses() {
  const { token, can } = useAuth();
  const { toast } = useToast();
  const canManage = can('expenses', 'manage');
  const [expenses, setExpenses] = useState([]);
  const [categories, setCategories] = useState([]);
  const [payees, setPayees] = useState([]);
  const [pageInfo, setPageInfo] = useState(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [payeeFilter, setPayeeFilter] = useState('');

  const { pendingIds, deleteWithUndo } = useUndoableDelete((id) => api.expenses.remove(id, token));
  const visibleExpenses = expenses.filter((e) => !pendingIds.has(e.id));
  const { confirm, confirmDialog } = useConfirm();

  function load() {
    // Only show the loading skeleton on the very first load — once there's
    // a list on screen, a refetch (search/filter/page change) keeps the
    // current rows visible until the new ones arrive instead of flashing
    // to a fixed-row-count skeleton whose height matches neither the old
    // nor new result count, which read as the page visibly jumping.
    if (expenses.length === 0) setLoading(true);
    api.expenses
      .list(token, { q: debouncedSearch, page, category: categoryFilter, payee: payeeFilter })
      .then(({ expenses, categories, payees, totalAmount, ...rest }) => {
        setExpenses(expenses);
        setCategories(categories);
        setPayees(payees);
        setTotal(totalAmount);
        setPageInfo(rest.totalPages ? rest : null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [token, debouncedSearch, page, categoryFilter, payeeFilter]);
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, categoryFilter, payeeFilter]);

  function startCreate() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(true);
  }

  // The bottom bar's Create sheet (components/BottomNav.jsx) links here with
  // ?new=1 to open the New form straight away; clear the param so a refresh
  // or Back doesn't reopen it.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      if (canManage) startCreate();
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startEdit(expense) {
    setForm({
      category: expense.category,
      description: expense.description,
      amount: expense.amount,
      expense_date: expense.expense_date,
      payee: expense.payee,
      notes: expense.notes,
    });
    setEditingId(expense.id);
    setShowForm(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (editingId) {
        await api.expenses.update(editingId, form, token);
        toast('Expense updated.', { type: 'success' });
      } else {
        await api.expenses.create(form, token);
        toast('Expense created.', { type: 'success' });
      }
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(expense) {
    if (!(await confirm({ title: `Delete "${expense.description}"?`, confirmLabel: 'Delete' }))) return;
    deleteWithUndo([expense.id], `"${expense.description}" deleted.`);
  }

  // Exports whatever's currently filtered on this page (category chip,
  // payee filter, and the search box once its debounce settles) rather
  // than always the full table — see routes/invoices.js's own
  // loadInvoiceExport() note.
  async function handleExportCsv() {
    setError('');
    try {
      await api.expenses.exportCsv(token, { q: debouncedSearch, category: categoryFilter, payee: payeeFilter });
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleExportXlsx() {
    setError('');
    try {
      await api.expenses.exportXlsx(token, { q: debouncedSearch, category: categoryFilter, payee: payeeFilter });
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8 xl:py-6">
      <PageToolbar
        mobileFilters="sheet"
        activeChips={[
          ...(categoryFilter ? [{ key: 'cat', label: categoryFilter, onClear: () => setCategoryFilter('') }] : []),
          ...(payeeFilter ? [{ key: 'payee', label: `Payee: ${payeeFilter}`, onClear: () => setPayeeFilter('') }] : []),
        ]}
        title="Expenses"
        actions={
          <>

          <PageMenu items={[{ label: 'Analytics', icon: ReportIcon, to: '/expenses/analytics' }, { label: 'Export CSV', icon: DownloadIcon, onClick: handleExportCsv }, { label: 'Export Excel', icon: DownloadIcon, onClick: handleExportXlsx }]} />
          {canManage && (
            <button
              onClick={() => setShowImport(true)}
              className="flex min-h-11 items-center gap-1.5 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <UploadIcon width={16} height={16} />
              Import CSV
            </button>
          )}
          {canManage && (
            <button
              onClick={startCreate}
              className="flex min-h-11 items-center gap-1.5 rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-700 dark:bg-lagoon-600 dark:hover:bg-lagoon-500"
            >
              <PlusIcon width={16} height={16} />
              New expense
            </button>
          )}
        
          </>
        }
        search={<SearchInput value={search} onChange={setSearch} placeholder="Search expenses…" />}
        extra={<div className="flex flex-wrap items-center gap-2">
{payees.length > 0 && (
          <div className="w-full max-w-xs sm:w-56">
            <SearchableSelect
              options={[{ value: '', label: 'All payees' }, ...payees.map((p) => ({ value: p, label: p }))]}
              value={payeeFilter}
              onChange={setPayeeFilter}
              placeholder="Filter by payee…"
            />
          </div>
        )}
</div>}
        filters={<StatusFilterChips
          options={[{ value: '', label: 'All' }, ...categories.map((c) => ({ value: c, label: c }))]}
          value={categoryFilter}
          onChange={setCategoryFilter}
        />}
      />



      {error && !showForm && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <Modal open={showForm} onClose={() => setShowForm(false)} title={editingId ? 'Edit expense' : 'New expense'} maxWidthClass="max-w-2xl">
        <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
          {error && <p className="text-sm text-red-600 dark:text-red-400 sm:col-span-2">{error}</p>}
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Category</span>
            <select
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c.charAt(0).toUpperCase() + c.slice(1)}
                </option>
              ))}
            </select>
          </label>
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
          <div className="sm:col-span-2">
            <label className="block">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Description</span>
              <input
                type="text"
                required
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              />
            </label>
          </div>
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Date</span>
            <div className="mt-1 flex h-11 w-full items-center overflow-hidden rounded-md border border-slate-300 px-3 focus-within:border-lagoon-500 dark:border-slate-600">
              <input
                type="date"
                required
                value={form.expense_date}
                onChange={(e) => setForm((f) => ({ ...f, expense_date: e.target.value }))}
                className="h-full w-full appearance-none border-0 bg-transparent p-0 text-base focus:outline-none dark:text-white"
              />
            </div>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Payee</span>
            <input
              type="text"
              value={form.payee}
              onChange={(e) => setForm((f) => ({ ...f, payee: e.target.value }))}
              placeholder="Who was paid — a shareholder, employee, vendor…"
              className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            />
          </label>

          <div className="sm:col-span-2">
            <label className="block">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Notes</span>
              <input
                type="text"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              />
            </label>
          </div>
          <div className="flex gap-3 sm:col-span-2">
            <button
              type="submit"
              disabled={submitting}
              className="min-h-11 rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-700 dark:bg-lagoon-600 dark:hover:bg-lagoon-500 disabled:opacity-60"
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

      <div className="mt-6 rounded-3xl bg-white dark:border shadow-sm dark:border-slate-700 dark:bg-slate-900">
        {loading ? (
          <div className="overflow-x-auto">
            <TableSkeleton rows={5} cols={canManage ? ['w-24', 'w-24', 'w-28', 'w-40', 'w-20', 'w-16'] : ['w-24', 'w-24', 'w-28', 'w-40', 'w-20']} />
          </div>
        ) : visibleExpenses.length === 0 ? (
          <EmptyState
            icon={<ExpenseIcon />}
            title={search || categoryFilter || payeeFilter ? 'No expenses match these filters.' : 'No expenses yet.'}
            message={!search && !categoryFilter && !payeeFilter && canManage ? 'Log your first expense to start tracking spending.' : undefined}
            action={!search && !categoryFilter && !payeeFilter && canManage ? { label: 'New expense', onClick: startCreate } : undefined}
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto sm:block">
              <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Payee</th>
                    <th className="px-4 py-3">Description</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    {canManage && <th className="px-4 py-3" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {visibleExpenses.map((expense) => (
                    <tr key={expense.id}>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-400">{expense.expense_date}</td>
                      <td className="whitespace-nowrap px-4 py-3 capitalize text-slate-600 dark:text-slate-400">{expense.category}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-400">{expense.payee || '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900 dark:text-white">{expense.description}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-slate-900 dark:text-white">
                        {expense.amount.toFixed(2)}
                      </td>
                      {canManage && (
                        <td className="whitespace-nowrap px-4 py-3">
                          <div className="flex justify-end gap-1.5">
                            <IconActionButton icon={PencilIcon} tone="slate" onClick={() => startEdit(expense)} title="Edit" label="Edit expense" />
                            <IconActionButton
                              icon={TrashIcon}
                              tone="red"
                              onClick={() => handleDelete(expense)}
                              title="Delete"
                              label="Delete expense"
                            />
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-200 dark:border-slate-700">
                    <td colSpan={4} className="px-4 py-3 text-right text-sm font-semibold text-slate-900 dark:text-white">
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
                {visibleExpenses.map((expense) => (
                  <MobileListAccordion
                    key={expense.id}
                    name="expenses-list"
                    summary={
                      <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-slate-900 dark:text-white">{expense.description}</p>
                          <p className="capitalize text-slate-500 dark:text-slate-400">{expense.category}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-slate-900 dark:text-white">{expense.amount.toFixed(2)}</p>
                        </div>
                      </div>
                    }
                  >
                    <div className="flex justify-between">
                      <dt className="text-slate-500 dark:text-slate-400">Date</dt>
                      <dd className="text-slate-900 dark:text-white">{expense.expense_date}</dd>
                    </div>
                    {expense.payee && (
                      <div className="flex justify-between">
                        <dt className="text-slate-500 dark:text-slate-400">Payee</dt>
                        <dd className="text-slate-900 dark:text-white">{expense.payee}</dd>
                      </div>
                    )}
                    {canManage && (
                      <div className="flex gap-1.5 pt-1">
                        <IconActionButton icon={PencilIcon} tone="slate" onClick={() => startEdit(expense)} title="Edit" label="Edit expense" />
                        <IconActionButton
                          icon={TrashIcon}
                          tone="red"
                          onClick={() => handleDelete(expense)}
                          title="Delete"
                          label="Delete expense"
                        />
                      </div>
                    )}
                  </MobileListAccordion>
                ))}
              </div>
              <div className="mt-2.5 flex justify-between rounded-3xl bg-white dark:border px-4 py-3 text-sm font-semibold text-slate-900 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-white">
                <span>Total</span>
                <span>{total.toFixed(2)}</span>
              </div>
            </div>
          </>
        )}
      </div>

      {pageInfo && <Pagination page={pageInfo.page} totalPages={pageInfo.totalPages} onChange={setPage} />}

      {canManage && !showForm && <FloatingActionButton onClick={startCreate} label="New expense" />}

      {canManage && <ImportModal open={showImport} onClose={() => setShowImport(false)} token={token} onImported={load} />}

      {confirmDialog}
    </div>
  );
}
