import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useUnsavedChangesGuard } from '../../lib/useUnsavedChangesGuard';
import LineItemsEditor from '../../components/LineItemsEditor';
import SearchableSelect from '../../components/SearchableSelect';

const todayStr = () => new Date().toISOString().slice(0, 10);
const todayPlus = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

// Renders standalone as the routed `/invoices/new` and `/invoices/:id/edit`
// pages (the default), or `embedded` inside a Modal when opened from the
// Invoices list page's "New invoice" button — see QuoteForm.jsx for the
// same pattern.
export default function InvoiceForm({ embedded = false, idOverride, onSuccess, onCancel }) {
  const { token, can } = useAuth();
  const params = useParams();
  const id = embedded ? idOverride : params.id;
  const navigate = useNavigate();
  const isEditing = Boolean(id);
  const canManage = can('invoices', 'manage');

  const [clients, setClients] = useState([]);
  const [products, setProducts] = useState([]);
  const [settings, setSettings] = useState(null);
  const [clientId, setClientId] = useState('');
  const [issueDate, setIssueDate] = useState(todayStr());
  const [dueDate, setDueDate] = useState(todayPlus(14));
  const [taxRate, setTaxRate] = useState(0);
  // Tracks whether the tax rate should keep auto-recomputing as items change
  // (a live weighted average of their product tax rates) or has been taken
  // over by the user manually editing the field — otherwise every item edit
  // would silently overwrite a deliberate override like "0% for this
  // tax-exempt client" back to the catalog-derived rate.
  const [taxRateAuto, setTaxRateAuto] = useState(true);
  const [discountType, setDiscountType] = useState('percentage');
  const [discountValue, setDiscountValue] = useState(0);
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(isEditing);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [lockedStatus, setLockedStatus] = useState(null);
  const [dirty, setDirty] = useState(false);
  const initializedRef = useRef(false);

  const { confirmDiscard } = useUnsavedChangesGuard(dirty);

  useEffect(() => {
    if (loading) return;
    if (!initializedRef.current) {
      initializedRef.current = true;
      return;
    }
    setDirty(true);
  }, [clientId, issueDate, dueDate, taxRate, discountType, discountValue, notes, items, loading]);

  useEffect(() => {
    api.clients.list(token).then(({ clients }) => setClients(clients));
    api.products.list(token).then(({ products }) => setProducts(products)).catch(() => {});
    api.settings.get(token).then(({ settings }) => setSettings(settings)).catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!isEditing) return;
    api.invoices
      .get(id, token)
      .then(({ invoice, items }) => {
        if (invoice.status === 'sent' || invoice.status === 'paid') {
          setLockedStatus(invoice.status);
          return;
        }
        setClientId(String(invoice.client_id));
        setIssueDate(invoice.issue_date);
        setDueDate(invoice.due_date);
        setTaxRate(invoice.tax_rate);
        setDiscountType(invoice.discount_type);
        setDiscountValue(invoice.discount_value);
        setNotes(invoice.notes);
        setItems(items.map((i) => ({ description: i.description, quantity: i.quantity, unit_price: i.unit_price, product_id: i.product_id })));
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id, isEditing, token]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!clientId) {
      setError('Please select a client');
      return;
    }
    if (items.length === 0) {
      setError('Please add at least one item from the product catalog');
      return;
    }
    setSubmitting(true);
    const payload = {
      client_id: Number(clientId),
      issue_date: issueDate,
      due_date: dueDate,
      tax_rate: Number(taxRate),
      discount_type: discountType,
      discount_value: Number(discountValue),
      notes,
      items,
    };
    try {
      if (isEditing) {
        const { invoice } = await api.invoices.update(id, payload, token);
        setDirty(false);
        if (onSuccess) onSuccess(invoice);
        else navigate(`/invoices/${id}`);
      } else {
        const { invoice } = await api.invoices.create(payload, token);
        setDirty(false);
        if (onSuccess) onSuccess(invoice);
        else navigate(`/invoices/${invoice.id}`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    const loadingEl = <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>;
    return embedded ? loadingEl : <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">{loadingEl}</div>;
  }
  if (!canManage) {
    const deniedEl = <p className="text-sm text-slate-500 dark:text-slate-400">You don't have permission to view this page.</p>;
    return embedded ? deniedEl : <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">{deniedEl}</div>;
  }
  if (lockedStatus) {
    const lockedEl = (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        This invoice has been {lockedStatus === 'paid' ? 'paid' : 'sent to the client'} and can no longer be edited.{' '}
        <Link to={`/invoices/${id}`} className="text-indigo-600 hover:text-indigo-500">
          View invoice
        </Link>
        .
      </p>
    );
    return embedded ? lockedEl : <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">{lockedEl}</div>;
  }

  const formEl = (
      <form onSubmit={handleSubmit} className={embedded ? 'flex flex-col gap-4' : 'mt-6 flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900'}>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Client</span>
            <SearchableSelect
              options={clients.map((c) => ({ value: c.id, label: c.name }))}
              value={clientId}
              onChange={setClientId}
              placeholder="Search clients…"
            />
            {clients.length === 0 && (
              <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                No clients yet — <Link to="/clients" className="text-indigo-600">add one first</Link>.
              </span>
            )}
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Tax rate (%)</span>
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={taxRate}
              onChange={(e) => {
                setTaxRate(e.target.value);
                setTaxRateAuto(false);
              }}
              className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-indigo-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Discount type</span>
            <select
              value={discountType}
              onChange={(e) => setDiscountType(e.target.value)}
              className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-indigo-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            >
              <option value="percentage">Percentage</option>
              <option value="fixed">Fixed amount</option>
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Discount value {discountType === 'percentage' ? '(%)' : ''}
            </span>
            <input
              type="number"
              min="0"
              max={discountType === 'percentage' ? 100 : undefined}
              step="0.01"
              value={discountValue}
              onChange={(e) => setDiscountValue(e.target.value)}
              className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-indigo-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Issue date</span>
            <div className="mt-1 flex h-11 w-full items-center overflow-hidden rounded-md border border-slate-300 px-3 focus-within:border-indigo-500 dark:border-slate-600">
              <input
                type="date"
                required
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
                className="h-full w-full appearance-none border-0 bg-transparent p-0 text-base focus:outline-none dark:text-white"
              />
            </div>
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Due date</span>
            <div className="mt-1 flex h-11 w-full items-center overflow-hidden rounded-md border border-slate-300 px-3 focus-within:border-indigo-500 dark:border-slate-600">
              <input
                type="date"
                required
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="h-full w-full appearance-none border-0 bg-transparent p-0 text-base focus:outline-none dark:text-white"
              />
            </div>
          </label>
        </div>

        <div>
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Line items</span>
          <div className="mt-1">
            <LineItemsEditor
              items={items}
              onChange={setItems}
              currencySymbol={settings?.currency_symbol}
              products={products}
              catalogOnly
              onProductTaxRate={(rate) => {
                if (taxRateAuto) setTaxRate(rate);
              }}
            />
          </div>
        </div>

        <label className="block">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-indigo-500 focus:outline-none"
          />
        </label>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="min-h-11 rounded-md bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {submitting ? 'Saving…' : 'Save invoice'}
          </button>
          {embedded && (
            <button
              type="button"
              onClick={() => {
                if (confirmDiscard()) onCancel();
              }}
              className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
          )}
        </div>
      </form>
  );

  if (embedded) return formEl;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{isEditing ? 'Edit invoice' : 'New invoice'}</h1>
      {formEl}
    </div>
  );
}
