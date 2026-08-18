import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useUndoableDelete } from '../../lib/useUndoableDelete';
import { useConfirm } from '../../lib/useConfirm';
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
import { ExpenseIcon } from '../../components/icons';

const EMPTY_FORM = { category: 'other', description: '', amount: '', expense_date: todayStr(), payee: '', notes: '' };

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
  const [categoryFilter, setCategoryFilter] = useState('');
  const [payeeFilter, setPayeeFilter] = useState('');

  const { pendingIds, deleteWithUndo } = useUndoableDelete((id) => api.expenses.remove(id, token));
  const visibleExpenses = expenses.filter((e) => !pendingIds.has(e.id));
  const { confirm, confirmDialog } = useConfirm();

  function load() {
    setLoading(true);
    api.expenses
      .list(token, { q: search, page, category: categoryFilter, payee: payeeFilter })
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

  useEffect(load, [token, search, page, categoryFilter, payeeFilter]);
  useEffect(() => {
    setPage(1);
  }, [search, categoryFilter, payeeFilter]);

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
        <div className="flex gap-2">
          <button
            onClick={handleExportCsv}
            className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Export CSV
          </button>
          <button
            onClick={handleExportXlsx}
            className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Export Excel
          </button>
          {canManage && (
            <button
              onClick={startCreate}
              className="min-h-11 rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500"
            >
              New expense
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="max-w-sm flex-1">
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

      {error && !showForm && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <Modal open={showForm} onClose={() => setShowForm(false)} title={editingId ? 'Edit expense' : 'New expense'} maxWidthClass="max-w-2xl">
        <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
          {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Category</span>
            <select
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none"
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c.charAt(0).toUpperCase() + c.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Amount</span>
            <input
              type="number"
              min="0.01"
              step="0.01"
              required
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none"
            />
          </label>
          <div className="sm:col-span-2">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Description</span>
              <input
                type="text"
                required
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none"
              />
            </label>
          </div>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Date</span>
            <div className="mt-1 flex h-11 w-full items-center overflow-hidden rounded-md border border-slate-300 px-3 focus-within:border-lagoon-500">
              <input
                type="date"
                required
                value={form.expense_date}
                onChange={(e) => setForm((f) => ({ ...f, expense_date: e.target.value }))}
                className="h-full w-full appearance-none border-0 bg-transparent p-0 text-base focus:outline-none"
              />
            </div>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Payee</span>
            <input
              type="text"
              value={form.payee}
              onChange={(e) => setForm((f) => ({ ...f, payee: e.target.value }))}
              placeholder="Who was paid — a shareholder, employee, vendor…"
              className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none"
            />
          </label>
          <div className="sm:col-span-2">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Notes</span>
              <input
                type="text"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none"
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
              className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
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
                      <td className="whitespace-nowrap px-4 py-3 text-right text-slate-900 dark:text-white">{expense.amount.toFixed(2)}</td>
                      {canManage && (
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <button onClick={() => startEdit(expense)} className="mr-3 text-lagoon-600 hover:text-lagoon-500">
                            Edit
                          </button>
                          <button onClick={() => handleDelete(expense)} className="text-red-600 hover:text-red-500">
                            Delete
                          </button>
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
                        <p className="shrink-0 text-slate-900 dark:text-white">{expense.amount.toFixed(2)}</p>
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
                      <div className="flex gap-4 pt-1">
                        <button onClick={() => startEdit(expense)} className="text-lagoon-600 hover:text-lagoon-500">
                          Edit
                        </button>
                        <button onClick={() => handleDelete(expense)} className="text-red-600 hover:text-red-500">
                          Delete
                        </button>
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
