import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../lib/useConfirm';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import Modal from '../../components/Modal';
import PageToolbar from '../../components/PageToolbar';
import SearchInput from '../../components/SearchInput';
import SearchableSelect from '../../components/SearchableSelect';
import StatusFilterChips from '../../components/StatusFilterChips';
import Pagination from '../../components/Pagination';
import FloatingActionButton from '../../components/FloatingActionButton';
import { TableSkeleton } from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import MobileListAccordion from '../../components/MobileListAccordion';
import IconActionButton from '../../components/IconActionButton';
import RowActions from '../../components/RowActions';
import { BankIcon, PlusIcon, PencilIcon, TrashIcon, XIcon, UsersIcon, RefreshIcon } from '../../components/icons';

// Internal profit calculator — revenue received (MVR) minus what it cost to
// buy USD to pay a supplier, split among shareholders by ownership_percent
// once distributed. Deliberately never shown anywhere a client can see it,
// even when a record links back to a real invoice (see db/index.js's own
// CREATE TABLE comment for the full reasoning). "Distribute" pays
// shareholders off the record's own typed-in exchange rate. Recording the
// *real* USD purchase is deliberately not this page's job at all — that
// lives on the Expenses page directly, or on the automatic Supplier Costs
// report (see pages/business/SupplierCosts.jsx), which computes the same
// USD-owed-to-suppliers figure from real sold line items rather than from
// this record's own cost_price fields; an earlier version of this page had
// its own "Record USD purchase" action, removed at explicit request so
// this stays purely the internal profit-split calculator.
//
// Named "Profit Distribution" on this page/nav/route — the backend (the
// `deals`/`deal_items` tables, routes/deals.js, /api/deals, and this file's
// own api.deals.* calls) keeps its original internal names; only the
// user-facing surface changed.
const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'distributed', label: 'Distributed' },
];

const EMPTY_FORM = { description: '', invoice_id: '', payee: '', revenue_amount: '', exchange_rate: '', items: [] };

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function StatusPill({ status }) {
  return (
    <span
      className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
        status === 'distributed'
          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
          : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
      }`}
    >
      {status === 'distributed' ? 'Distributed' : 'Draft'}
    </span>
  );
}

// A type-to-filter product picker that never "holds" a selection — every
// pick immediately appends a new cost item and resets back to an empty
// search box, same one-shot-reset behavior components/LineItemsEditor.jsx's
// own inline ProductPicker already establishes for the identical reason.
function ProductPicker({ products, onPick }) {
  const options = products.map((p) => ({
    value: p.id,
    label: p.name,
    sublabel: p.cost_price ? `Cost: $${p.cost_price.toFixed(2)}` : 'No cost price set',
  }));
  return (
    <SearchableSelect
      options={options}
      value=""
      onChange={(idStr) => {
        const product = products.find((p) => String(p.id) === idStr);
        if (product) onPick(product);
      }}
      placeholder="Add a cost item from the product catalog…"
    />
  );
}

export default function ProfitDistribution() {
  const { token, can } = useAuth();
  const { toast } = useToast();
  const canManage = can('financials', 'manage');

  const [deals, setDeals] = useState([]);
  const [pageInfo, setPageInfo] = useState(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [shareholders, setShareholders] = useState([]);
  const [products, setProducts] = useState([]);
  const [invoices, setInvoices] = useState([]);

  const [settings, setSettings] = useState(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const symbol = settings?.currency_symbol || '$';

  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  // Tax on the linked invoice (tax collected is owed to the tax authority, not
  // profit): { tax, pretax } or null. Display/convenience only, never saved.
  const [taxInfo, setTaxInfo] = useState(null);

  const [viewTarget, setViewTarget] = useState(null);

  const [auto, setAuto] = useState(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [trueUpTarget, setTrueUpTarget] = useState(null);
  const [trueUpRate, setTrueUpRate] = useState('');
  const [trueUpPlan, setTrueUpPlan] = useState(null);
  const [trueUpError, setTrueUpError] = useState('');
  const [trueUpBusy, setTrueUpBusy] = useState(false);

  const { confirm, confirmDialog } = useConfirm();

  function load() {
    if (deals.length === 0) setLoading(true);
    api.deals
      .list(token, { q: debouncedSearch, status, page })
      .then(({ deals: rows, ...rest }) => {
        setDeals(rows);
        setPageInfo(rest.totalPages ? rest : null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [token, debouncedSearch, status, page]);
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, status]);

  useEffect(() => {
    api.shareholders
      .list(token)
      .then(({ shareholders }) => setShareholders(shareholders))
      .catch(() => {});
    api.products
      .list(token)
      .then(({ products }) => setProducts(products))
      .catch(() => {});
    api.invoices
      .list(token)
      .then(({ invoices }) => setInvoices(invoices))
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    api.settings
      .getSummary(token)
      .then(({ settings }) => setSettings(settings))
      .catch(() => {})
      .finally(() => setSettingsLoaded(true));
  }, [token]);

  const eligibleShareholders = useMemo(() => shareholders.filter((s) => s.active && s.ownership_percent > 0), [shareholders]);

  const invoiceOptions = useMemo(
    () =>
      invoices
        .filter((inv) => inv.amount_paid > 0)
        .map((inv) => ({
          value: inv.id,
          label: `${inv.number} — ${inv.client_name}`,
          sublabel: `Paid ${symbol}${inv.amount_paid.toFixed(2)} of ${symbol}${inv.total.toFixed(2)}`,
        })),
    [invoices, symbol],
  );

  // Mirrors routes/deals.js's own withComputedDeal() exactly, so the form's
  // own live totals never disagree with what a save would actually compute.
  const formCostUsdTotal = round2(form.items.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.cost_price) || 0), 0));
  const formRate = Number(form.exchange_rate) || 0;
  const formCostMvr = formRate ? round2(formCostUsdTotal * formRate) : 0;
  const formNetProfit = round2((Number(form.revenue_amount) || 0) - formCostMvr);

  function startCreate() {
    setTaxInfo(null);
    setForm(EMPTY_FORM);
    setEditingId(null);
    setFormError('');
    setShowForm(true);
  }

  function startEdit(deal) {
    setTaxInfo(deal.invoice_tax_amount > 0 ? { tax: deal.invoice_tax_amount, pretax: deal.invoice_pretax_total } : null);
    setForm({
      description: deal.description,
      invoice_id: deal.invoice_id ? String(deal.invoice_id) : '',
      payee: deal.payee || '',
      revenue_amount: deal.revenue_amount,
      exchange_rate: deal.exchange_rate ?? '',
      items: (deal.items || []).map((item) => ({ ...item })),
    });
    setEditingId(deal.id);
    setFormError('');
    setShowForm(true);
  }

  // Picking an invoice pulls in its total as the revenue figure and, when
  // no cost items have been added yet, auto-populates them from that
  // invoice's own line items — for each one, the matching product's own
  // cost_price (see products.cost_price). An item with no product_id (a
  // manually-typed invoice line) or a since-deleted product just comes in
  // at $0, same as any other line item — still freely editable afterward.
  async function handlePickInvoice(invoiceIdStr) {
    setForm((f) => ({ ...f, invoice_id: invoiceIdStr }));
    if (!invoiceIdStr) return;
    try {
      const { invoice, items } = await api.invoices.get(invoiceIdStr, token);
      const nextItems = items.map((item) => {
        const product = item.product_id ? products.find((p) => p.id === item.product_id) : null;
        return {
          product_id: item.product_id || null,
          description: item.description,
          quantity: item.quantity,
          cost_price: product ? product.cost_price : 0,
        };
      });
      const tax = round2(invoice.tax_amount || 0);
      const pretax = round2(invoice.total - tax);
      setTaxInfo(tax > 0 ? { tax, pretax } : null);
      setForm((f) => ({
        ...f,
        // Pre-tax by default: tax collected is owed to the tax authority, not profit to split.
        revenue_amount: pretax,
        items: f.items.length === 0 ? nextItems : f.items,
      }));
    } catch (err) {
      setFormError(err.message);
    }
  }

  function addItemFromProduct(product) {
    setForm((f) => ({
      ...f,
      items: [...f.items, { product_id: product.id, description: product.name, quantity: 1, cost_price: product.cost_price || 0 }],
    }));
  }

  function addBlankItem() {
    setForm((f) => ({ ...f, items: [...f.items, { product_id: null, description: '', quantity: 1, cost_price: 0 }] }));
  }

  function updateItem(index, patch) {
    setForm((f) => ({ ...f, items: f.items.map((item, i) => (i === index ? { ...item, ...patch } : item)) }));
  }

  function removeItem(index) {
    setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== index) }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError('');
    if (!form.description.trim()) {
      setFormError('Description is required.');
      return;
    }
    if (!form.invoice_id) {
      setFormError('Link this record to a real, paid invoice — distributing an unlinked record would subtract money that was never added to the bank balance.');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        description: form.description,
        invoice_id: form.invoice_id || null,
        payee: form.payee,
        revenue_amount: Number(form.revenue_amount) || 0,
        exchange_rate: form.exchange_rate === '' ? null : Number(form.exchange_rate),
        items: form.items.map((item) => ({
          product_id: item.product_id || null,
          description: item.description,
          quantity: Number(item.quantity) || 0,
          cost_price: Number(item.cost_price) || 0,
        })),
      };
      if (editingId) {
        await api.deals.update(editingId, payload, token);
        toast('Record updated.', { type: 'success' });
      } else {
        await api.deals.create(payload, token);
        toast('Record created.', { type: 'success' });
      }
      setShowForm(false);
      load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(deal) {
    if (!(await confirm({ title: `Delete "${deal.description}"?`, message: 'This draft record will be removed.', confirmLabel: 'Delete' }))) return;
    try {
      await api.deals.remove(deal.id, token);
      toast('Record deleted.', { type: 'success' });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function openView(deal) {
    try {
      const data = await api.deals.get(deal.id, token);
      setViewTarget(data);
    } catch (err) {
      setError(err.message);
    }
  }

  function loadAuto() {
    api.deals.autoSettings(token).then(setAuto).catch(() => {});
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadAuto, [token]);

  async function toggleAuto() {
    setAutoBusy(true);
    try {
      if (!auto.enabled) {
        const ok = await confirm({
          title: 'Turn on automatic distribution?',
          message:
            'Every night, each invoice fully paid on or after 1 January 2027 (the date profit distribution officially starts) is split among active shareholders by their ownership %. Older invoices are never touched. Supplier cost uses the USD account average rate and can be adjusted to the actual rate afterward.',
          confirmLabel: 'Turn on',
          danger: false,
        });
        if (!ok) return;
      }
      await api.deals.setAuto(!auto.enabled, token);
      loadAuto();
      toast(auto.enabled ? 'Automatic distribution turned off.' : 'Automatic distribution turned on.', { type: 'success' });
    } catch (err) {
      setError(err.message);
    } finally {
      setAutoBusy(false);
    }
  }

  async function runAutoNow() {
    setAutoBusy(true);
    try {
      const r = await api.deals.autoRun(token);
      if (r.skipped) toast('Nothing to run — ' + (r.skipped === 'off' ? 'automatic distribution is off.' : 'no active shareholders with an ownership %.'), { type: 'info' });
      else toast(`Distributed ${r.distributed.length} invoice(s); ${r.waiting.length} waiting.`, { type: 'success' });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setAutoBusy(false);
    }
  }

  function openTrueUp(deal) {
    setTrueUpTarget(deal);
    setTrueUpRate(auto?.usdAverageRate ? String(auto.usdAverageRate) : String(deal.exchange_rate || ''));
    setTrueUpPlan(null);
    setTrueUpError('');
  }

  useEffect(() => {
    if (!trueUpTarget || !(Number(trueUpRate) > 0)) {
      setTrueUpPlan(null);
      return undefined;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      api.deals
        .trueUpPreview(trueUpTarget.id, trueUpRate, token)
        .then((plan) => !cancelled && (setTrueUpPlan(plan), setTrueUpError('')))
        .catch((err) => !cancelled && (setTrueUpPlan(null), setTrueUpError(err.message)));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [trueUpTarget, trueUpRate, token]);

  async function submitTrueUp() {
    setTrueUpBusy(true);
    try {
      await api.deals.trueUp(trueUpTarget.id, Number(trueUpRate), token);
      toast('Payout adjusted to the actual rate.', { type: 'success' });
      setTrueUpTarget(null);
      load();
    } catch (err) {
      setTrueUpError(err.message);
    } finally {
      setTrueUpBusy(false);
    }
  }

  function rowActions(deal) {
    if (!canManage) return null;
    if (deal.status === 'draft') {
      return (
        <>
          <IconActionButton icon={PencilIcon} tone="slate" onClick={() => startEdit(deal)} title="Edit" label="Edit record" />
          <IconActionButton icon={TrashIcon} tone="red" onClick={() => handleDelete(deal)} title="Delete" label="Delete record" />
        </>
      );
    }
    return (
      <>
        <IconActionButton icon={UsersIcon} tone="lagoon" onClick={() => openView(deal)} title="View split" label="View distribution" />
        {deal.cost_usd_total > 0 && (
          <IconActionButton
            icon={RefreshIcon}
            tone="amber"
            onClick={() => openTrueUp(deal)}
            title="Adjust to actual rate"
            label="Adjust payout to actual USD rate"
          />
        )}
      </>
    );
  }

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8 xl:py-6">
      <PageToolbar
        title="Profit Distribution" 
        actions={canManage && (
<>
            <button
              onClick={startCreate}
              className="flex min-h-11 items-center gap-1.5 rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-700 dark:bg-lagoon-600 dark:hover:bg-lagoon-500"
            >
              <PlusIcon width={16} height={16} />
              New record
            </button>
          </>
)}
        search={<SearchInput value={search} onChange={setSearch} placeholder="Search records…" />}
        filters={<StatusFilterChips options={STATUS_OPTIONS} value={status} onChange={setStatus} />}
      />

      {canManage && auto && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-white p-4 text-sm dark:border dark:border-slate-700 dark:bg-slate-900">
          <div className="min-w-0">
            <p className="font-medium text-slate-900 dark:text-white">
              Automatic distribution: {auto.enabled ? `on (invoices paid since ${auto.from})` : 'off'}
            </p>
            <p className="text-slate-500 dark:text-slate-400">
              Each night, fully paid invoices are split by shareholder %. Cost uses the USD account average rate
              {auto.usdAverageRate ? ` (now ${auto.usdAverageRate})` : ''}; adjust to the actual rate afterward.
            </p>
          </div>
          <div className="flex gap-2">
            {auto.enabled && (
              <button onClick={runAutoNow} disabled={autoBusy} className="min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
                Run now
              </button>
            )}
            <button onClick={toggleAuto} disabled={autoBusy} className="min-h-11 rounded-md bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60 dark:bg-lagoon-600 dark:hover:bg-lagoon-500">
              {auto.enabled ? 'Turn off' : 'Turn on'}
            </button>
          </div>
        </div>
      )}

      {shareholders.length > 0 && eligibleShareholders.length === 0 && (
        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          No active shareholder has an ownership percentage set yet, so a record can't be distributed. Set one on the
          Shareholders page.
        </p>
      )}


      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editingId ? 'Edit record' : 'New record'}
        maxWidthClass="max-w-2xl"
      >
        <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
          {formError && <p className="text-sm text-red-600 dark:text-red-400 sm:col-span-2">{formError}</p>}
          <div className="sm:col-span-2">
            <label className="block">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Description</span>
              <input
                type="text"
                required
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="e.g. LMS licenses for Green Valley School"
                className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              />
            </label>
          </div>
          <div className="sm:col-span-2">
            <label className="block">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Link to a paid invoice</span>
              <SearchableSelect
                options={invoiceOptions}
                value={form.invoice_id}
                onChange={handlePickInvoice}
                placeholder="Search paid invoices…"
              />
            </label>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Required — the invoice itself is never changed and shows nothing about this record, this is purely for
              your own traceability, but distributing requires a real, paid invoice behind the revenue figure above.
              Without one, the revenue was never actually added to the bank balance, so distributing would incorrectly
              subtract money that isn't there.
            </p>
          </div>
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Revenue received ({symbol})</span>
            <input
              type="number"
              min="0"
              step="0.01"
              required
              value={form.revenue_amount}
              onChange={(e) => setForm((f) => ({ ...f, revenue_amount: e.target.value }))}
              className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            />
            {taxInfo && Number(form.revenue_amount) > taxInfo.pretax + 0.01 && (
              <span className="mt-1.5 block text-xs text-amber-700 dark:text-amber-400">
                This is more than the invoice's pre-tax amount. The invoice includes {symbol}{taxInfo.tax.toFixed(2)} tax,
                which is owed to the tax authority, not profit to split.{' '}
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, revenue_amount: taxInfo.pretax }))}
                  className="font-semibold underline"
                >
                  Use pre-tax {symbol}{taxInfo.pretax.toFixed(2)}
                </button>
              </span>
            )}
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Supplier / payee (optional)</span>
            <input
              type="text"
              value={form.payee}
              onChange={(e) => setForm((f) => ({ ...f, payee: e.target.value }))}
              className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            />
          </label>
          <div className="sm:col-span-2">
            <label className="block">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Exchange rate (MVR per USD)</span>
              <input
                type="number"
                min="0"
                step="0.0001"
                value={form.exchange_rate}
                onChange={(e) => setForm((f) => ({ ...f, exchange_rate: e.target.value }))}
                placeholder="e.g. 15.4"
                className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              />
            </label>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Only needed if there's a USD cost below — converts it to {symbol} to work out net profit.
            </p>
          </div>

          <div className="sm:col-span-2 rounded-lg border border-slate-200 dark:border-slate-700">
            <div className="border-b border-slate-200 px-3 py-2 dark:border-slate-700">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Supplier cost items (USD)</span>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {form.items.length === 0 && (
                <p className="px-3 py-3 text-sm text-slate-500 dark:text-slate-400">
                  No cost items yet — pick a product below, or add one manually.
                </p>
              )}
              {form.items.map((item, index) => (
                <div key={index} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <input
                    type="text"
                    value={item.description}
                    onChange={(e) => updateItem(index, { description: e.target.value })}
                    placeholder="Description"
                    className="min-h-9 min-w-[140px] flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.quantity}
                    onChange={(e) => updateItem(index, { quantity: e.target.value })}
                    title="Quantity"
                    className="min-h-9 w-16 rounded-md border border-slate-300 px-2 py-1 text-right text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                  />
                  <span className="text-sm text-slate-400">×</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.cost_price}
                    onChange={(e) => updateItem(index, { cost_price: e.target.value })}
                    title="Cost price (USD)"
                    className="min-h-9 w-24 rounded-md border border-slate-300 px-2 py-1 text-right text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                  />
                  <span className="w-20 shrink-0 text-right text-sm text-slate-900 dark:text-white">
                    ${round2((Number(item.quantity) || 0) * (Number(item.cost_price) || 0)).toFixed(2)}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeItem(index)}
                    className="shrink-0 text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                    aria-label="Remove item"
                  >
                    <XIcon width={16} height={16} />
                  </button>
                </div>
              ))}
            </div>
            <div className="border-t border-slate-200 p-3 dark:border-slate-700">
              <ProductPicker products={products} onPick={addItemFromProduct} />
              <button
                type="button"
                onClick={addBlankItem}
                className="mt-2 text-sm font-medium text-lagoon-700 hover:underline dark:text-lagoon-400"
              >
                + Add custom cost item
              </button>
            </div>
          </div>

          <div className="sm:col-span-2 grid gap-1 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800">
            <div className="flex justify-between text-slate-600 dark:text-slate-400">
              <span>Cost (USD)</span>
              <span>${formCostUsdTotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-slate-600 dark:text-slate-400">
              <span>Cost ({symbol})</span>
              <span>
                {symbol}
                {formCostMvr.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between font-semibold text-slate-900 dark:text-white">
              <span>Net profit</span>
              <span className={formNetProfit < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}>
                {symbol}
                {formNetProfit.toFixed(2)}
              </span>
            </div>
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

      <Modal open={Boolean(trueUpTarget)} onClose={() => setTrueUpTarget(null)} title="Adjust payout to actual rate" maxWidthClass="max-w-lg">
        {trueUpTarget && (
          <div className="grid gap-3">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {trueUpTarget.description} — paid at estimated rate {trueUpTarget.exchange_rate}. Enter the rate the USD actually cost; each
              shareholder's payout is scaled to the new profit and the difference is recorded.
            </p>
            <label className="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-300">
              Actual rate (MVR per USD)
              <input
                type="number"
                step="0.0001"
                min="0"
                value={trueUpRate}
                onChange={(e) => setTrueUpRate(e.target.value)}
                className="min-h-11 rounded-md border border-slate-300 px-3 text-base dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              />
            </label>
            {trueUpPlan && (
              <div className="rounded-md bg-slate-50 p-3 text-sm dark:bg-slate-800">
                <p className="text-slate-600 dark:text-slate-300">
                  Net profit {symbol}{trueUpPlan.oldNet.toFixed(2)} → {symbol}{trueUpPlan.newNet.toFixed(2)}
                </p>
                <ul className="mt-2 space-y-1">
                  {trueUpPlan.rows.map((r) => (
                    <li key={r.name} className="flex justify-between">
                      <span className="text-slate-800 dark:text-slate-200">{r.name}</span>
                      <span className={r.adjustment < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}>
                        {r.adjustment >= 0 ? '+' : ''}{r.adjustment.toFixed(2)} (→ {r.target.toFixed(2)})
                      </span>
                    </li>
                  ))}
                </ul>
                {trueUpPlan.rows.some((r) => r.adjustment < 0) && (
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">A negative amount means that shareholder was overpaid and owes it back.</p>
                )}
              </div>
            )}
            {trueUpError && <p className="text-sm text-red-600 dark:text-red-400">{trueUpError}</p>}
            <div className="flex gap-2">
              <button
                onClick={submitTrueUp}
                disabled={trueUpBusy || !trueUpPlan}
                className="min-h-11 rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60 dark:bg-lagoon-600 dark:hover:bg-lagoon-500"
              >
                {trueUpBusy ? 'Saving…' : 'Apply adjustment'}
              </button>
              <button onClick={() => setTrueUpTarget(null)} className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 dark:border-slate-600 dark:text-slate-200">
                Cancel
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={Boolean(viewTarget)} onClose={() => setViewTarget(null)} title="Distribution" maxWidthClass="max-w-lg">
        {viewTarget && (
          <div className="grid gap-3">
            <p className="text-sm text-slate-600 dark:text-slate-400">{viewTarget.deal.description}</p>
            <div className="grid gap-1 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800">
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>Revenue</span>
                <span>
                  {symbol}
                  {viewTarget.deal.revenue_amount.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>Supplier cost</span>
                <span>
                  {symbol}
                  {viewTarget.deal.cost_mvr.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between font-semibold text-slate-900 dark:text-white">
                <span>Net profit</span>
                <span>
                  {symbol}
                  {viewTarget.deal.net_profit.toFixed(2)}
                </span>
              </div>
              {viewTarget.deal.distributed_at && (
                <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span>Distributed</span>
                  <span>{viewTarget.deal.distributed_at.slice(0, 10)}</span>
                </div>
              )}
            </div>
            <div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Paid to shareholders</p>
              <div className="mt-1 divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
                {viewTarget.distributions.length === 0 ? (
                  <p className="px-3 py-3 text-sm text-slate-500 dark:text-slate-400">No payouts were recorded for this record.</p>
                ) : (
                  viewTarget.distributions.map((d) => (
                    <div key={d.id} className="flex justify-between px-3 py-2 text-sm">
                      <span className="text-slate-700 dark:text-slate-300">{d.taken_by_name}</span>
                      <span className="font-medium text-slate-900 dark:text-white">
                        {symbol}
                        {d.amount.toFixed(2)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <div className="mt-6 rounded-3xl bg-white dark:border shadow-sm dark:border-slate-700 dark:bg-slate-900">
        {loading || !settingsLoaded ? (
          <div className="overflow-x-auto">
            <TableSkeleton rows={4} cols={canManage ? ['w-48', 'w-20', 'w-20', 'w-20', 'w-20', 'w-16'] : ['w-48', 'w-20', 'w-20', 'w-20', 'w-20']} />
          </div>
        ) : deals.length === 0 ? (
          <EmptyState
            icon={<BankIcon />}
            title={search || status ? 'No records match this filter.' : 'No records yet.'}
            message={canManage ? 'Record a deal to work out how much profit there is to distribute.' : undefined}
            action={canManage ? { label: 'New record', onClick: startCreate } : undefined}
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto sm:block">
              <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                    <th className="px-4 py-3">Description</th>
                    <th className="px-4 py-3 text-right">Revenue</th>
                    <th className="px-4 py-3 text-right">Cost</th>
                    <th className="px-4 py-3 text-right">Net profit</th>
                    <th className="px-4 py-3">Status</th>
                    {canManage && <th className="px-4 py-3" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {deals.map((deal) => (
                    <tr key={deal.id}>
                      <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{deal.description}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-slate-900 dark:text-white">
                        {symbol}
                        {deal.revenue_amount.toFixed(2)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-slate-600 dark:text-slate-400">
                        {deal.cost_mvr ? `${symbol}${deal.cost_mvr.toFixed(2)}` : '—'}
                      </td>
                      <td
                        className={`whitespace-nowrap px-4 py-3 text-right font-medium ${
                          deal.net_profit < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'
                        }`}
                      >
                        {symbol}
                        {deal.net_profit.toFixed(2)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusPill status={deal.status} />
                        </div>
                      </td>
                      {canManage && (
                        <td className="whitespace-nowrap px-4 py-3">
                          <RowActions>{rowActions(deal)}</RowActions>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-2.5 sm:hidden">
              {deals.map((deal) => (
                <MobileListAccordion
                  key={deal.id}
                  name="deals-list"
                  summary={
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-slate-900 dark:text-white">{deal.description}</p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                          <StatusPill status={deal.status} />
                        </div>
                      </div>
                      <p
                        className={`shrink-0 font-medium ${
                          deal.net_profit < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'
                        }`}
                      >
                        {symbol}
                        {deal.net_profit.toFixed(2)}
                      </p>
                    </div>
                  }
                >
                  <div className="flex justify-between">
                    <dt className="text-slate-500 dark:text-slate-400">Revenue</dt>
                    <dd className="text-slate-900 dark:text-white">
                      {symbol}
                      {deal.revenue_amount.toFixed(2)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500 dark:text-slate-400">Cost</dt>
                    <dd className="text-slate-900 dark:text-white">{deal.cost_mvr ? `${symbol}${deal.cost_mvr.toFixed(2)}` : '—'}</dd>
                  </div>
                  {canManage && <div className="pt-1"><RowActions fill>{rowActions(deal)}</RowActions></div>}
                </MobileListAccordion>
              ))}
            </div>
          </>
        )}
      </div>

      {pageInfo && <Pagination page={pageInfo.page} totalPages={pageInfo.totalPages} onChange={setPage} />}

      {canManage && !showForm && <FloatingActionButton onClick={startCreate} label="New record" />}

      {confirmDialog}
    </div>
  );
}
