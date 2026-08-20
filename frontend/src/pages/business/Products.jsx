import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import SearchInput from '../../components/SearchInput';
import FloatingActionButton from '../../components/FloatingActionButton';
import Pagination from '../../components/Pagination';
import Modal from '../../components/Modal';
import MobileListAccordion from '../../components/MobileListAccordion';
import IconActionButton from '../../components/IconActionButton';
import { PlusIcon, PencilIcon, TrashIcon } from '../../components/icons';
import { useConfirm } from '../../lib/useConfirm';

const EMPTY_FORM = { name: '', description: '', unit_price: '', tax_rate: '' };

export default function Products() {
  const { token, can } = useAuth();
  const canManage = can('products', 'manage');

  const [products, setProducts] = useState([]);
  const [pageInfo, setPageInfo] = useState(null);
  const [page, setPage] = useState(1);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState('');
  const { confirm, confirmDialog } = useConfirm();

  const symbol = settings?.currency_symbol || '$';

  function load() {
    setLoading(true);
    api.products
      .list(token, { q: search, page })
      .then(({ products, ...rest }) => {
        setProducts(products);
        setPageInfo(rest.totalPages ? rest : null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [token, search, page]);
  useEffect(() => {
    setPage(1);
  }, [search]);
  useEffect(() => {
    api.settings.get(token).then(({ settings }) => setSettings(settings)).catch(() => {});
  }, [token]);

  function startCreate() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(true);
  }

  function startEdit(product) {
    setForm({
      name: product.name,
      description: product.description,
      unit_price: product.unit_price,
      tax_rate: product.tax_rate,
    });
    setEditingId(product.id);
    setShowForm(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (editingId) {
        await api.products.update(editingId, form, token);
      } else {
        await api.products.create(form, token);
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
    if (!(await confirm({ title: 'Delete this product?', confirmLabel: 'Delete' }))) return;
    setError('');
    try {
      await api.products.remove(id, token);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Products</h1>
        {canManage && (
          <button
            onClick={startCreate}
            className="flex min-h-11 items-center gap-1.5 rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500"
          >
            <PlusIcon width={16} height={16} />
            New product
          </button>
        )}
      </div>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        A reusable catalog of products and services — pick one when building a quote or invoice to autofill its
        description, price, and tax instead of typing it from scratch each time.
      </p>

      <div className="mt-4 max-w-sm">
        <SearchInput value={search} onChange={setSearch} placeholder="Search products…" />
      </div>

      {error && !showForm && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <Modal open={showForm} onClose={() => setShowForm(false)} title={editingId ? 'Edit product' : 'New product'} maxWidthClass="max-w-2xl">
        <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
          {error && <p className="text-sm text-red-600 dark:text-red-400 sm:col-span-2">{error}</p>}
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Name</span>
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Unit price</span>
            <input
              type="number"
              min="0"
              step="0.01"
              required
              value={form.unit_price}
              onChange={(e) => setForm((f) => ({ ...f, unit_price: e.target.value }))}
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
              placeholder="0"
              className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            />
          </label>
          <div className="sm:col-span-2">
            <label className="block">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Description</span>
              <input
                type="text"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
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
          <p className="p-6 text-sm text-slate-500 dark:text-slate-400">Loading…</p>
        ) : products.length === 0 ? (
          <p className="p-6 text-sm text-slate-500 dark:text-slate-400">
            {search ? `No products match "${search}".` : 'No products yet.'}
          </p>
        ) : (
          <>
            <div className="hidden overflow-x-auto sm:block">
              <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Description</th>
                    <th className="px-4 py-3 text-right">Unit price</th>
                    <th className="px-4 py-3 text-right">Tax</th>
                    {canManage && <th className="px-4 py-3" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {products.map((product) => (
                    <tr key={product.id}>
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900 dark:text-white">{product.name}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{product.description || '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-slate-900 dark:text-white">
                        {symbol}
                        {product.unit_price.toFixed(2)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-slate-600 dark:text-slate-400">
                        {product.tax_rate ? `${product.tax_rate}%` : '—'}
                      </td>
                      {canManage && (
                        <td className="whitespace-nowrap px-4 py-3">
                          <div className="flex justify-end gap-1.5">
                            <IconActionButton icon={PencilIcon} tone="slate" onClick={() => startEdit(product)} title="Edit" label="Edit product" />
                            <IconActionButton
                              icon={TrashIcon}
                              tone="red"
                              onClick={() => handleDelete(product.id)}
                              title="Delete"
                              label="Delete product"
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
              {products.map((product) => (
                <MobileListAccordion
                  key={product.id}
                  name="products-list"
                  summary={
                    <div className="flex items-center justify-between gap-3">
                      <p className="min-w-0 truncate font-medium text-slate-900 dark:text-white">{product.name}</p>
                      <p className="shrink-0 text-slate-900 dark:text-white">
                        {symbol}
                        {product.unit_price.toFixed(2)}
                      </p>
                    </div>
                  }
                >
                  <div className="flex justify-between">
                    <dt className="text-slate-500 dark:text-slate-400">Description</dt>
                    <dd className="text-right text-slate-900 dark:text-white">{product.description || '—'}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500 dark:text-slate-400">Tax</dt>
                    <dd className="text-slate-900 dark:text-white">{product.tax_rate ? `${product.tax_rate}%` : '—'}</dd>
                  </div>
                  {canManage && (
                    <div className="flex gap-1.5 pt-1">
                      <IconActionButton icon={PencilIcon} tone="slate" onClick={() => startEdit(product)} title="Edit" label="Edit product" />
                      <IconActionButton
                        icon={TrashIcon}
                        tone="red"
                        onClick={() => handleDelete(product.id)}
                        title="Delete"
                        label="Delete product"
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

      {canManage && !showForm && <FloatingActionButton onClick={startCreate} label="New product" />}

      {confirmDialog}
    </div>
  );
}
