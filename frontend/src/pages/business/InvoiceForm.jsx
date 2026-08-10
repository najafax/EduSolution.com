import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import LineItemsEditor from '../../components/LineItemsEditor';
import SearchableSelect from '../../components/SearchableSelect';

const todayStr = () => new Date().toISOString().slice(0, 10);
const todayPlus = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

export default function InvoiceForm() {
  const { token, can } = useAuth();
  const { id } = useParams();
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
  const [discountType, setDiscountType] = useState('percentage');
  const [discountValue, setDiscountValue] = useState(0);
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState([{ description: '', quantity: 1, unit_price: 0 }]);
  const [loading, setLoading] = useState(isEditing);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [lockedStatus, setLockedStatus] = useState(null);

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
        setItems(items.map((i) => ({ description: i.description, quantity: i.quantity, unit_price: i.unit_price })));
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
        await api.invoices.update(id, payload, token);
        navigate(`/invoices/${id}`);
      } else {
        const { invoice } = await api.invoices.create(payload, token);
        navigate(`/invoices/${invoice.id}`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="mx-auto max-w-3xl px-4 py-10 text-sm text-slate-500 sm:px-6">Loading…</div>;
  if (!canManage) {
    return <div className="mx-auto max-w-3xl px-4 py-10 text-sm text-slate-500 sm:px-6">You don't have permission to view this page.</div>;
  }
  if (lockedStatus) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 text-sm text-slate-500 sm:px-6">
        This invoice has been {lockedStatus === 'paid' ? 'paid' : 'sent to the client'} and can no longer be edited.{' '}
        <Link to={`/invoices/${id}`} className="text-indigo-600 hover:text-indigo-500">
          View invoice
        </Link>
        .
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-bold text-slate-900">{isEditing ? 'Edit invoice' : 'New invoice'}</h1>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Client</span>
            <SearchableSelect
              options={clients.map((c) => ({ value: c.id, label: c.name, sublabel: c.company }))}
              value={clientId}
              onChange={setClientId}
              placeholder="Search clients…"
            />
            {clients.length === 0 && (
              <span className="mt-1 block text-xs text-slate-500">
                No clients yet — <Link to="/clients" className="text-indigo-600">add one first</Link>.
              </span>
            )}
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">Tax rate (%)</span>
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={taxRate}
              onChange={(e) => setTaxRate(e.target.value)}
              className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-indigo-500 focus:outline-none"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">Discount type</span>
            <select
              value={discountType}
              onChange={(e) => setDiscountType(e.target.value)}
              className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-indigo-500 focus:outline-none"
            >
              <option value="percentage">Percentage</option>
              <option value="fixed">Fixed amount</option>
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">
              Discount value {discountType === 'percentage' ? '(%)' : ''}
            </span>
            <input
              type="number"
              min="0"
              max={discountType === 'percentage' ? 100 : undefined}
              step="0.01"
              value={discountValue}
              onChange={(e) => setDiscountValue(e.target.value)}
              className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-indigo-500 focus:outline-none"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">Issue date</span>
            <input
              type="date"
              required
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
              className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-indigo-500 focus:outline-none"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">Due date</span>
            <input
              type="date"
              required
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-indigo-500 focus:outline-none"
            />
          </label>
        </div>

        <div>
          <span className="text-sm font-medium text-slate-700">Line items</span>
          <div className="mt-1">
            <LineItemsEditor items={items} onChange={setItems} currencySymbol={settings?.currency_symbol} products={products} />
          </div>
        </div>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-indigo-500 focus:outline-none"
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="min-h-11 rounded-md bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {submitting ? 'Saving…' : 'Save invoice'}
          </button>
        </div>
      </form>
    </div>
  );
}
