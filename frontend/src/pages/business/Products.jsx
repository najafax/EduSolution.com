import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import SearchInput from '../../components/SearchInput';
import FloatingActionButton from '../../components/FloatingActionButton';
import Pagination from '../../components/Pagination';
import Modal from '../../components/Modal';
import MobileListAccordion from '../../components/MobileListAccordion';
import IconActionButton from '../../components/IconActionButton';
import ImportResultsTable from '../../components/ImportResultsTable';
import { PlusIcon, PencilIcon, TrashIcon, UploadIcon } from '../../components/icons';
import { useConfirm } from '../../lib/useConfirm';
import { useDebouncedValue } from '../../lib/useDebouncedValue';

const EMPTY_FORM = { name: '', description: '', unit_price: '', tax_rate: '', visible_in_portal: false };

// Same template content as pages/business/Import.jsx's own `products` entry
// in its TEMPLATES map — duplicated rather than imported (this page has no
// other reason to depend on that one, and it's a plain string), same
// acceptable-duplication call routes/expenses.js's EXPENSE_CATEGORIES makes
// against routes/import.js's own copy. Keep both in sync if the columns
// ever change.
const PRODUCTS_CSV_TEMPLATE =
  'name,description,unit_price,tax_rate,visible_in_portal\n' +
  'LMS Pro Annual License,Learning management system — annual plan,1200,0,true\n' +
  'Consulting Hour,General consulting, billed hourly,75,0,false\n';

function downloadProductsTemplate() {
  const blob = new Blob([PRODUCTS_CSV_TEMPLATE], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'products-import-template.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// The embedded counterpart to the standalone Import page's `products` type
// (routes/import.js's POST /api/import/products backs both) — asked for
// directly on this page rather than sending someone to the generic Import
// page just to bring in a product catalog. Same preview-then-confirm
// contract: nothing is written until "Confirm import" is clicked, and a row
// matching an existing product by name updates it in place instead of
// creating a duplicate (see routes/import.js's own existingProductMap()).
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
      setPreview(await api.import.run('products', csvText, false, token));
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
      const result = await api.import.run('products', csvText, true, token);
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
    <Modal open={open} onClose={handleClose} title="Import products" maxWidthClass="max-w-2xl">
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Bring in a product catalog from a CSV file. Preview first to catch errors — nothing is saved until you confirm.
        A row matching an existing product by name updates it in place instead of creating a duplicate.
      </p>

      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Expected columns</p>
        <p className="mt-1 break-words font-mono text-xs text-slate-600 dark:text-slate-400">
          name*, description, unit_price*, tax_rate, visible_in_portal
        </p>
        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">* required</p>
        <button
          type="button"
          onClick={downloadProductsTemplate}
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
          className="min-h-11 rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500 disabled:opacity-60"
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

// visible_in_portal is opt-in (see db/index.js's own migration note) — most
// products stay invisible here, so the badge is only shown for the
// out-of-the-ordinary case where a product IS opted in, same reasoning
// Clients.jsx's own PortalBadge only renders for a non-'none' portal_status.
function PortalVisibleBadge() {
  return (
    <span className="inline-block rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
      Portal
    </span>
  );
}

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
  const [showImport, setShowImport] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const { confirm, confirmDialog } = useConfirm();

  const symbol = settings?.currency_symbol || '$';

  function load() {
    // Only show the loading skeleton on the very first load — once there's
    // a list on screen, a refetch (search/page change) keeps the current
    // rows visible until the new ones arrive instead of flashing to a
    // fixed-row-count skeleton whose height matches neither the old nor new
    // result count, which read as the page visibly jumping.
    if (products.length === 0) setLoading(true);
    api.products
      .list(token, { q: debouncedSearch, page })
      .then(({ products, ...rest }) => {
        setProducts(products);
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
      visible_in_portal: Boolean(product.visible_in_portal),
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
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setShowImport(true)}
              className="flex min-h-11 items-center gap-1.5 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <UploadIcon width={16} height={16} />
              Import CSV
            </button>
            <button
              onClick={startCreate}
              className="flex min-h-11 items-center gap-1.5 rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500"
            >
              <PlusIcon width={16} height={16} />
              New product
            </button>
          </div>
        )}
      </div>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        A reusable catalog of products and services — pick one when building a quote or invoice to autofill its
        description, price, and tax instead of typing it from scratch each time.
      </p>

      <div className="mt-4 sm:max-w-sm">
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
          <div className="sm:col-span-2">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.visible_in_portal}
                onChange={(e) => setForm((f) => ({ ...f, visible_in_portal: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-300 text-lagoon-600 focus:ring-lagoon-500"
              />
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Visible in client portal</span>
            </label>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Lets clients pick this product when requesting a quote from their portal. Off by default — turn it on
              per product you want clients to see.
            </p>
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
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900 dark:text-white">
                        <div className="flex items-center gap-2">
                          {product.name}
                          {Boolean(product.visible_in_portal) && <PortalVisibleBadge />}
                        </div>
                      </td>
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
                      <div className="flex min-w-0 items-center gap-2">
                        <p className="truncate font-medium text-slate-900 dark:text-white">{product.name}</p>
                        {Boolean(product.visible_in_portal) && <PortalVisibleBadge />}
                      </div>
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

      {canManage && <ImportModal open={showImport} onClose={() => setShowImport(false)} token={token} onImported={load} />}

      {confirmDialog}
    </div>
  );
}
