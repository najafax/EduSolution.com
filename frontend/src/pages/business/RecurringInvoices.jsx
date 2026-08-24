import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { todayStr } from '../../lib/date';
import LineItemsEditor from '../../components/LineItemsEditor';
import FloatingActionButton from '../../components/FloatingActionButton';
import SearchableSelect from '../../components/SearchableSelect';
import SearchInput from '../../components/SearchInput';
import Pagination from '../../components/Pagination';
import Modal from '../../components/Modal';
import MobileListAccordion from '../../components/MobileListAccordion';
import IconActionButton from '../../components/IconActionButton';
import { PlusIcon, PencilIcon, TrashIcon } from '../../components/icons';
import { useConfirm } from '../../lib/useConfirm';
import { useDebouncedValue } from '../../lib/useDebouncedValue';

const EMPTY_FORM = {
  client_id: '',
  frequency: 'monthly',
  tax_rate: 0,
  discount_type: 'percentage',
  discount_value: 0,
  due_in_days: 14,
  next_run_date: todayStr(),
  notes: '',
  active: true,
};

export default function RecurringInvoices() {
  const { token, can } = useAuth();
  const canManage = can('recurring_invoices', 'manage');
  const [recurring, setRecurring] = useState([]);
  const [pageInfo, setPageInfo] = useState(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [clients, setClients] = useState([]);
  const [products, setProducts] = useState([]);
  const [settings, setSettings] = useState(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [items, setItems] = useState([{ description: '', quantity: 1, unit_price: 0 }]);
  const [submitting, setSubmitting] = useState(false);
  const { confirm, confirmDialog } = useConfirm();

  function load() {
    // Only show the loading skeleton on the very first load — once there's
    // a list on screen, a refetch (search/page change) keeps the current
    // rows visible until the new ones arrive instead of flashing to a
    // fixed-row-count skeleton whose height matches neither the old nor new
    // result count, which read as the page visibly jumping.
    if (recurring.length === 0) setLoading(true);
    api.recurringInvoices
      .list(token, { q: debouncedSearch, page })
      .then(({ recurringInvoices, ...rest }) => {
        setRecurring(recurringInvoices);
        setPageInfo(rest.totalPages ? rest : null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [token, debouncedSearch, page]);
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);
  useEffect(() => {
    api.clients.list(token).then(({ clients }) => setClients(clients));
    api.products.list(token).then(({ products }) => setProducts(products)).catch(() => {});
    // .finally flips settingsLoaded whether the fetch succeeds or fails —
    // the loading gate below waits on this too (on the initial load only,
    // same as the list itself — see load()'s own note), so a template's
    // amount figures never flash '$' before the real currency symbol
    // arrives (see Dashboard.jsx's own note on this race for the full
    // story).
    api.settings
      .get(token)
      .then(({ settings }) => setSettings(settings))
      .catch(() => {})
      .finally(() => setSettingsLoaded(true));
  }, [token]);

  function startCreate() {
    setForm(EMPTY_FORM);
    setItems([{ description: '', quantity: 1, unit_price: 0 }]);
    setEditingId(null);
    setShowForm(true);
  }

  async function startEdit(row) {
    setError('');
    try {
      const { recurring, items } = await api.recurringInvoices.get(row.id, token);
      setForm({
        client_id: String(recurring.client_id),
        frequency: recurring.frequency,
        tax_rate: recurring.tax_rate,
        discount_type: recurring.discount_type,
        discount_value: recurring.discount_value,
        due_in_days: recurring.due_in_days,
        next_run_date: recurring.next_run_date,
        notes: recurring.notes,
        active: Boolean(recurring.active),
      });
      setItems(items.map((i) => ({ description: i.description, quantity: i.quantity, unit_price: i.unit_price })));
      setEditingId(recurring.id);
      setShowForm(true);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!form.client_id) {
      setError('Please select a client');
      return;
    }
    setSubmitting(true);
    const payload = {
      client_id: Number(form.client_id),
      frequency: form.frequency,
      tax_rate: Number(form.tax_rate),
      discount_type: form.discount_type,
      discount_value: Number(form.discount_value),
      due_in_days: Number(form.due_in_days),
      next_run_date: form.next_run_date,
      notes: form.notes,
      active: form.active,
      items,
    };
    try {
      if (editingId) {
        await api.recurringInvoices.update(editingId, payload, token);
      } else {
        await api.recurringInvoices.create(payload, token);
      }
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id) {
    if (
      !(await confirm({
        title: 'Delete this recurring invoice?',
        message: 'Invoices already generated from it are not affected.',
        confirmLabel: 'Delete',
      }))
    )
      return;
    setError('');
    try {
      await api.recurringInvoices.remove(id, token);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  const symbol = settings?.currency_symbol || '$';

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Recurring invoices</h1>
        {canManage && (
          <button
            onClick={startCreate}
            className="flex min-h-11 items-center gap-1.5 rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500"
          >
            <PlusIcon width={16} height={16} />
            New template
          </button>
        )}
      </div>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
        Each template automatically creates a draft invoice on its next run date — review and send it from the{' '}
        <Link to="/invoices" className="text-lagoon-600 hover:text-lagoon-500">
          Invoices
        </Link>{' '}
        page like any other.
      </p>

      <div className="mt-4 sm:max-w-sm">
        <SearchInput value={search} onChange={setSearch} placeholder="Search recurring invoices…" />
      </div>

      {error && !showForm && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <Modal open={showForm} onClose={() => setShowForm(false)} title={editingId ? 'Edit template' : 'New template'} maxWidthClass="max-w-3xl">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Client</span>
              <SearchableSelect
                options={clients.map((c) => ({ value: c.id, label: c.name }))}
                value={form.client_id}
                onChange={(value) => setForm((f) => ({ ...f, client_id: value }))}
                placeholder="Search clients…"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Frequency</span>
              <select
                value={form.frequency}
                onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value }))}
                className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              >
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Next run date</span>
              <div className="mt-1 flex h-11 w-full items-center overflow-hidden rounded-md border border-slate-300 px-3 focus-within:border-lagoon-500 dark:border-slate-600">
                <input
                  type="date"
                  required
                  value={form.next_run_date}
                  onChange={(e) => setForm((f) => ({ ...f, next_run_date: e.target.value }))}
                  className="h-full w-full appearance-none border-0 bg-transparent p-0 text-base focus:outline-none dark:text-white"
                />
              </div>
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Due (days after issue)</span>
              <input
                type="number"
                min="0"
                value={form.due_in_days}
                onChange={(e) => setForm((f) => ({ ...f, due_in_days: e.target.value }))}
                className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Tax rate (%)</span>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={form.tax_rate}
                onChange={(e) => setForm((f) => ({ ...f, tax_rate: e.target.value }))}
                className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Discount type</span>
              <select
                value={form.discount_type}
                onChange={(e) => setForm((f) => ({ ...f, discount_type: e.target.value }))}
                className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              >
                <option value="percentage">Percentage</option>
                <option value="fixed">Fixed amount</option>
              </select>
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Discount value {form.discount_type === 'percentage' ? '(%)' : ''}
              </span>
              <input
                type="number"
                min="0"
                max={form.discount_type === 'percentage' ? 100 : undefined}
                step="0.01"
                value={form.discount_value}
                onChange={(e) => setForm((f) => ({ ...f, discount_value: e.target.value }))}
                className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              />
            </label>

            {editingId && (
              <label className="flex items-center gap-2 self-end pb-2">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                  className="h-5 w-5 rounded border-slate-300"
                />
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Active</span>
              </label>
            )}
          </div>

          <div>
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Line items</span>
            <div className="mt-1">
              <LineItemsEditor items={items} onChange={setItems} currencySymbol={symbol} products={products} />
            </div>
          </div>

          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Notes</span>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={2}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            />
          </label>

          <div className="flex gap-3">
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
        {loading || !settingsLoaded ? (
          <p className="p-6 text-sm text-slate-500 dark:text-slate-400">Loading…</p>
        ) : recurring.length === 0 ? (
          <p className="p-6 text-sm text-slate-500 dark:text-slate-400">
            {search ? `No recurring invoices match "${search}".` : 'No recurring invoices yet.'}
          </p>
        ) : (
          <>
            <div className="hidden overflow-x-auto sm:block">
              <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                    <th className="px-4 py-3">Client</th>
                    <th className="px-4 py-3">Frequency</th>
                    <th className="px-4 py-3">Next run</th>
                    <th className="px-4 py-3">Status</th>
                    {canManage && <th className="px-4 py-3" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {recurring.map((row) => (
                    <tr key={row.id}>
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900 dark:text-white">{row.client_name}</td>
                      <td className="whitespace-nowrap px-4 py-3 capitalize text-slate-600 dark:text-slate-400">{row.frequency}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-400">{row.next_run_date}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            row.active
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
                              : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                          }`}
                        >
                          {row.active ? 'Active' : 'Paused'}
                        </span>
                      </td>
                      {canManage && (
                        <td className="whitespace-nowrap px-4 py-3">
                          <div className="flex justify-end gap-1.5">
                            <IconActionButton icon={PencilIcon} tone="slate" onClick={() => startEdit(row)} title="Edit" label="Edit template" />
                            <IconActionButton
                              icon={TrashIcon}
                              tone="red"
                              onClick={() => handleDelete(row.id)}
                              title="Delete"
                              label="Delete template"
                            />
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-2.5 sm:hidden">
              {recurring.map((row) => (
                <MobileListAccordion
                  key={row.id}
                  name="recurring-list"
                  summary={
                    <div className="flex items-center justify-between gap-3">
                      <p className="min-w-0 truncate font-medium text-slate-900 dark:text-white">{row.client_name}</p>
                      <span
                        className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          row.active
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
                            : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                        }`}
                      >
                        {row.active ? 'Active' : 'Paused'}
                      </span>
                    </div>
                  }
                >
                  <div className="flex justify-between">
                    <dt className="text-slate-500 dark:text-slate-400">Frequency</dt>
                    <dd className="capitalize text-slate-900 dark:text-white">{row.frequency}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500 dark:text-slate-400">Next run</dt>
                    <dd className="text-slate-900 dark:text-white">{row.next_run_date}</dd>
                  </div>
                  {canManage && (
                    <div className="flex gap-1.5 pt-1">
                      <IconActionButton icon={PencilIcon} tone="slate" onClick={() => startEdit(row)} title="Edit" label="Edit template" />
                      <IconActionButton
                        icon={TrashIcon}
                        tone="red"
                        onClick={() => handleDelete(row.id)}
                        title="Delete"
                        label="Delete template"
                      />
                    </div>
                  )}
                </MobileListAccordion>
              ))}
            </div>
          </>
        )}
      </div>

      {pageInfo && <Pagination page={pageInfo.page} totalPages={pageInfo.totalPages} onChange={setPage} />}

      {canManage && !showForm && <FloatingActionButton onClick={startCreate} label="New recurring invoice" />}

      {confirmDialog}
    </div>
  );
}
