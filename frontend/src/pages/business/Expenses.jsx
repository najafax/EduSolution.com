import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
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
import IconActionButton from '../../components/IconActionButton';
import { ExpenseIcon, DownloadIcon, PlusIcon, PencilIcon, TrashIcon, ReportIcon } from '../../components/icons';

const EMPTY_FORM = {
  category: 'other',
  description: '',
  amount: '',
  expense_date: todayStr(),
  payee: '',
  notes: '',
  exchange_rate: '',
  payee_account_number: '',
  usd_destination: '',
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

  function startEdit(expense) {
    setForm({
      category: expense.category,
      description: expense.description,
      amount: expense.amount,
      expense_date: expense.expense_date,
      payee: expense.payee,
      notes: expense.notes,
      exchange_rate: expense.exchange_rate ?? '',
      payee_account_number: expense.payee_account_number || '',
      usd_destination: expense.usd_destination || '',
    });
    setEditingId(expense.id);
    setShowForm(true);
  }

  const isCurrencyExchange = form.category === 'currency exchange';
  const exchangeRateNum = Number(form.exchange_rate);
  const amountUsdPreview =
    isCurrencyExchange && form.amount && exchangeRateNum > 0 ? Number(form.amount) / exchangeRateNum : null;

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

  async function handleExportCsv() {
    setError('');
    try {
      await api.expenses.exportCsv(token);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleExportXlsx() {
    setError('');
    try {
      await api.expenses.exportXlsx(token);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Expenses</h1>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/expenses/analytics"
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
              onClick={startCreate}
              className="flex min-h-11 items-center gap-1.5 rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500"
            >
              <PlusIcon width={16} height={16} />
              New expense
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 sm:max-w-sm">
          <SearchInput value={search} onChange={setSearch} placeholder="Search expenses…" />
        </div>
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
      </div>

      <div className="mt-3">
        <StatusFilterChips
          options={[{ value: '', label: 'All' }, ...categories.map((c) => ({ value: c, label: c }))]}
          value={categoryFilter}
          onChange={setCategoryFilter}
        />
      </div>

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

          {isCurrencyExchange && (
            <div className="sm:col-span-2 grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2 dark:border-slate-700 dark:bg-slate-800/50">
              <p className="text-xs text-slate-500 dark:text-slate-400 sm:col-span-2">
                Amount above is what was paid in local currency to buy USD. Enter the rate used to see how much USD the
                company received.
              </p>
              <label className="block">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Exchange rate</span>
                <input
                  type="number"
                  min="0.0001"
                  step="0.0001"
                  required={isCurrencyExchange}
                  value={form.exchange_rate}
                  onChange={(e) => setForm((f) => ({ ...f, exchange_rate: e.target.value }))}
                  placeholder="e.g. 15.42"
                  className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Amount received (USD)</span>
                <div className="mt-1 flex min-h-11 w-full items-center rounded-md border border-slate-200 bg-slate-100 px-3 text-base text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                  {amountUsdPreview !== null ? `$${amountUsdPreview.toFixed(2)}` : '—'}
                </div>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Payee account number</span>
                <input
                  type="text"
                  value={form.payee_account_number}
                  onChange={(e) => setForm((f) => ({ ...f, payee_account_number: e.target.value }))}
                  placeholder="Account the USD was paid to"
                  className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">USD destination</span>
                <input
                  type="text"
                  value={form.usd_destination}
                  onChange={(e) => setForm((f) => ({ ...f, usd_destination: e.target.value }))}
                  placeholder="What the USD was used for — e.g. EduPage license renewal"
                  className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                />
              </label>
            </div>
          )}

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
                        {expense.amount_usd !== null && (
                          <p className="text-xs font-normal text-slate-500 dark:text-slate-400">
                            ${expense.amount_usd.toFixed(2)} @ {expense.exchange_rate}
                          </p>
                        )}
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
                          {expense.amount_usd !== null && (
                            <p className="text-xs text-slate-500 dark:text-slate-400">${expense.amount_usd.toFixed(2)}</p>
                          )}
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
                    {expense.amount_usd !== null && (
                      <div className="flex justify-between">
                        <dt className="text-slate-500 dark:text-slate-400">Exchange rate</dt>
                        <dd className="text-slate-900 dark:text-white">{expense.exchange_rate}</dd>
                      </div>
                    )}
                    {expense.amount_usd !== null && (
                      <div className="flex justify-between">
                        <dt className="text-slate-500 dark:text-slate-400">Amount (USD)</dt>
                        <dd className="text-slate-900 dark:text-white">${expense.amount_usd.toFixed(2)}</dd>
                      </div>
                    )}
                    {expense.payee_account_number && (
                      <div className="flex justify-between">
                        <dt className="text-slate-500 dark:text-slate-400">Payee account number</dt>
                        <dd className="text-slate-900 dark:text-white">{expense.payee_account_number}</dd>
                      </div>
                    )}
                    {expense.usd_destination && (
                      <div className="flex justify-between">
                        <dt className="text-slate-500 dark:text-slate-400">USD destination</dt>
                        <dd className="text-slate-900 dark:text-white">{expense.usd_destination}</dd>
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
              <div className="mt-2.5 flex justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-white">
                <span>Total</span>
                <span>{total.toFixed(2)}</span>
              </div>
            </div>
          </>
        )}
      </div>

      {pageInfo && <Pagination page={pageInfo.page} totalPages={pageInfo.totalPages} onChange={setPage} />}

      {canManage && !showForm && <FloatingActionButton onClick={startCreate} label="New expense" />}

      {confirmDialog}
    </div>
  );
}
