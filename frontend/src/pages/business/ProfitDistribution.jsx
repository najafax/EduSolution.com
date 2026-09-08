import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../lib/useConfirm';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import Modal from '../../components/Modal';
import SearchInput from '../../components/SearchInput';
import SearchableSelect from '../../components/SearchableSelect';
import StatusFilterChips from '../../components/StatusFilterChips';
import Pagination from '../../components/Pagination';
import FloatingActionButton from '../../components/FloatingActionButton';
import { TableSkeleton } from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import MobileListAccordion from '../../components/MobileListAccordion';
import IconActionButton from '../../components/IconActionButton';
import { BankIcon, PlusIcon, PencilIcon, TrashIcon, CheckCircleIcon, XIcon, UsersIcon, RefreshIcon } from '../../components/icons';

// Internal profit calculator — revenue received (MVR) minus what it cost to
// buy USD to pay a supplier, split among shareholders by ownership_percent
// once distributed. Deliberately never shown anywhere a client can see it,
// even when a record links back to a real invoice (see db/index.js's own
// CREATE TABLE comment for the full reasoning). A draft record is purely a
// calculator; "Distribute" (pays shareholders off the record's own
// estimated rate) and "Record USD purchase" (the real conversion, at
// whatever the real rate turns out to be — the one action that actually
// subtracts the cost from the bank balance, whenever it actually happens)
// are the two independent real actions — see routes/deals.js's own note on
// why they're separate rather than one.
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

// A deal with a USD cost reads as one of three states, independent of
// its own draft/distributed status — nothing rendered at all once there's
// no USD cost to convert in the first place (the common case for a
// service deal with no supplier cost).
function ConversionPill({ deal }) {
  if (!(deal.cost_usd_total > 0)) return null;
  if (deal.expense_id) {
    return (
      <span className="inline-flex shrink-0 rounded-full bg-lagoon-50 px-2 py-0.5 text-xs font-medium text-lagoon-700 dark:bg-lagoon-950 dark:text-lagoon-300">
        USD converted
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
      Pending USD conversion
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

  const [distributeTarget, setDistributeTarget] = useState(null);
  const [distributing, setDistributing] = useState(false);
  const [distributeError, setDistributeError] = useState('');

  // Recording the real USD purchase — independent of distribute above, see
  // routes/deals.js's own POST /:id/convert-usd. convertRate prefills from
  // the deal's own current (estimated) exchange_rate but is freely
  // editable, since the whole point is entering the real rate you actually
  // got.
  const [convertTarget, setConvertTarget] = useState(null);
  const [convertRate, setConvertRate] = useState('');
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState('');

  const [viewTarget, setViewTarget] = useState(null);

  // Bulk distribute-all: a single confirm-then-act button, no form of its
  // own — reports back what actually happened (distributed vs. skipped,
  // each skip with its own reason) since a batch can partially succeed.
  const [bulkDistributing, setBulkDistributing] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);

  // TEMPORARY: bulk-clears draft/test records — see routes/deals.js's own
  // DELETE /drafts. Remove this button (and that route) once it's no
  // longer needed for cleanup.
  const [deletingDrafts, setDeletingDrafts] = useState(false);
  // TEMPORARY: bulk-clears distributed/test records, reversing their real
  // expense + owner_draws side effects too — see routes/deals.js's own
  // DELETE /distributed.
  const [deletingDistributed, setDeletingDistributed] = useState(false);

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
  const draftCount = useMemo(() => deals.filter((d) => d.status === 'draft').length, [deals]);

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
    setForm(EMPTY_FORM);
    setEditingId(null);
    setFormError('');
    setShowForm(true);
  }

  function startEdit(deal) {
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
      setForm((f) => ({
        ...f,
        revenue_amount: invoice.total,
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

  async function handleDistribute() {
    if (!distributeTarget) return;
    setDistributeError('');
    setDistributing(true);
    try {
      await api.deals.distribute(distributeTarget.id, token);
      toast('Profit distributed.', { type: 'success' });
      setDistributeTarget(null);
      load();
    } catch (err) {
      setDistributeError(err.message);
    } finally {
      setDistributing(false);
    }
  }

  function openConvert(deal) {
    setConvertTarget(deal);
    setConvertRate(deal.exchange_rate ? String(deal.exchange_rate) : '');
    setConvertError('');
  }

  async function handleConvert() {
    if (!convertTarget) return;
    const rateNum = Number(convertRate);
    if (!Number.isFinite(rateNum) || rateNum <= 0) {
      setConvertError('Enter the real exchange rate you actually got.');
      return;
    }
    setConvertError('');
    setConverting(true);
    try {
      await api.deals.convertUsd(convertTarget.id, { exchange_rate: rateNum }, token);
      toast('USD purchase recorded — the cost has now left the bank balance.', { type: 'success' });
      setConvertTarget(null);
      load();
    } catch (err) {
      setConvertError(err.message);
    } finally {
      setConverting(false);
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

  // Distributes every eligible draft record in one call — see
  // routes/deals.js's own POST /distribute-all. An ineligible draft (no
  // profit, or a USD cost with no exchange rate set) is skipped with its
  // own reason rather than blocking the rest of the batch.
  async function handleDistributeAll() {
    if (
      !(await confirm({
        title: 'Distribute all eligible drafts?',
        message:
          'Every draft record with a positive net profit (and a real exchange rate for any USD cost) will be distributed now. This writes real expense and owner-payout records and cannot be undone from here.',
        confirmLabel: 'Distribute all',
      }))
    )
      return;
    setBulkResult(null);
    setBulkDistributing(true);
    try {
      const { distributed, skipped } = await api.deals.distributeAll(token);
      setBulkResult({ distributed, skipped });
      toast(
        `Distributed ${distributed.length} deal${distributed.length === 1 ? '' : 's'}${skipped.length > 0 ? `, skipped ${skipped.length}` : ''}.`,
        { type: distributed.length > 0 ? 'success' : 'error' },
      );
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBulkDistributing(false);
    }
  }

  // TEMPORARY: see routes/deals.js's own DELETE /drafts note.
  async function handleDeleteDrafts() {
    if (
      !(await confirm({
        title: 'Delete every draft record?',
        message:
          'This clears out test/draft records only — any already-distributed record is real financial history and is never touched. A draft that already had its USD purchase recorded has that expense reversed too.',
        confirmLabel: 'Delete drafts',
      }))
    )
      return;
    setDeletingDrafts(true);
    try {
      const { deleted } = await api.deals.removeDrafts(token);
      toast(`Deleted ${deleted} draft record${deleted === 1 ? '' : 's'}.`, { type: 'success' });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setDeletingDrafts(false);
    }
  }

  // TEMPORARY: see routes/deals.js's own DELETE /distributed note — this
  // is the one that actually undoes a test distribution's effect on the
  // bank balance, by deleting the linked expense + shareholder payout rows
  // along with the deal itself, not just the deal record on its own.
  async function handleDeleteDistributed() {
    if (
      !(await confirm({
        title: 'Delete every distributed record?',
        message:
          'This permanently deletes every already-distributed record, along with the supplier-cost expense and shareholder payouts it created — reversing its effect on the bank balance. Only use this for test data; a real distribution should never be deleted this way.',
        confirmLabel: 'Delete distributed',
      }))
    )
      return;
    setDeletingDistributed(true);
    try {
      const { deleted } = await api.deals.removeDistributed(token);
      toast(`Deleted ${deleted} distributed record${deleted === 1 ? '' : 's'} and their linked expense/payout entries.`, { type: 'success' });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setDeletingDistributed(false);
    }
  }

  // "Record USD purchase" is independent of a record's own draft/
  // distributed status (see routes/deals.js's own convertDealToUsd() note
  // on why the two actions don't gate each other) — shown whenever there's
  // a real USD cost still waiting to be converted, alongside whatever
  // status-specific actions the record already has.
  function rowActions(deal) {
    if (!canManage) return null;
    const convertAction =
      deal.cost_usd_total > 0 && !deal.expense_id ? (
        <IconActionButton
          icon={RefreshIcon}
          tone="amber"
          onClick={() => openConvert(deal)}
          title="Record USD purchase"
          label="Record the real USD purchase for this record"
        />
      ) : null;
    if (deal.status === 'draft') {
      return (
        <>
          <IconActionButton icon={PencilIcon} tone="slate" onClick={() => startEdit(deal)} title="Edit" label="Edit record" />
          <IconActionButton
            icon={CheckCircleIcon}
            tone="emerald"
            onClick={() => setDistributeTarget(deal)}
            title="Distribute"
            label="Distribute record"
          />
          {convertAction}
          <IconActionButton icon={TrashIcon} tone="red" onClick={() => handleDelete(deal)} title="Delete" label="Delete record" />
        </>
      );
    }
    return (
      <>
        <IconActionButton icon={UsersIcon} tone="lagoon" onClick={() => openView(deal)} title="View split" label="View distribution" />
        {convertAction}
      </>
    );
  }

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Profit Distribution</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Revenue received minus what it cost to buy USD for a supplier — the rest split among shareholders by
            ownership. Distributing pays shareholders off an estimate; the USD cost only leaves the bank once you
            separately record the real purchase. Purely internal; nothing here is ever shown to a client.
          </p>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            {draftCount > 0 && (
              <button
                onClick={handleDistributeAll}
                disabled={bulkDistributing}
                className="flex min-h-11 items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-4 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-60 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
              >
                <RefreshIcon width={16} height={16} className={bulkDistributing ? 'animate-spin' : ''} />
                {bulkDistributing ? 'Distributing…' : 'Distribute all'}
              </button>
            )}
            <button
              onClick={startCreate}
              className="flex min-h-11 items-center gap-1.5 rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500"
            >
              <PlusIcon width={16} height={16} />
              New record
            </button>
          </div>
        )}
      </div>

      {canManage && (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          <button
            onClick={handleDeleteDrafts}
            disabled={deletingDrafts}
            title="Temporary cleanup tool — clears draft/test records only, never a distributed one"
            className="flex min-h-9 items-center gap-1.5 rounded-md border border-red-200 px-3 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-60 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
          >
            <TrashIcon width={14} height={14} />
            {deletingDrafts ? 'Deleting…' : 'Delete all drafts (test cleanup)'}
          </button>
          <button
            onClick={handleDeleteDistributed}
            disabled={deletingDistributed}
            title="Temporary cleanup tool — deletes distributed records AND their linked expense/shareholder-payout rows, reversing the bank balance effect"
            className="flex min-h-9 items-center gap-1.5 rounded-md border border-red-200 px-3 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-60 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
          >
            <TrashIcon width={14} height={14} />
            {deletingDistributed ? 'Deleting…' : 'Delete all distributed (test cleanup)'}
          </button>
        </div>
      )}

      {bulkResult && (
        <div className="mt-4 rounded-md border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <p className="font-medium text-slate-900 dark:text-white">
              Distributed {bulkResult.distributed.length}, skipped {bulkResult.skipped.length}
            </p>
            <button
              onClick={() => setBulkResult(null)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              aria-label="Dismiss"
            >
              <XIcon width={14} height={14} />
            </button>
          </div>
          {bulkResult.skipped.length > 0 && (
            <ul className="mt-2 space-y-1 text-slate-600 dark:text-slate-400">
              {bulkResult.skipped.map((s) => (
                <li key={s.id}>
                  <span className="font-medium text-slate-800 dark:text-slate-200">{s.description}:</span> {s.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {shareholders.length > 0 && eligibleShareholders.length === 0 && (
        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          No active shareholder has an ownership percentage set yet, so a record can't be distributed. Set one on the
          Shareholders page.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="sm:max-w-sm">
          <SearchInput value={search} onChange={setSearch} placeholder="Search records…" />
        </div>
        <StatusFilterChips options={STATUS_OPTIONS} value={status} onChange={setStatus} />
      </div>

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

      <Modal
        open={Boolean(distributeTarget)}
        onClose={() => {
          setDistributeTarget(null);
          setDistributeError('');
        }}
        title="Distribute this record"
        maxWidthClass="max-w-lg"
      >
        {distributeTarget && (
          <div className="grid gap-3">
            <p className="text-sm text-slate-600 dark:text-slate-400">{distributeTarget.description}</p>
            {(() => {
              const linkedInvoice = distributeTarget.invoice_id ? invoices.find((inv) => inv.id === distributeTarget.invoice_id) : null;
              if (!distributeTarget.invoice_id || !linkedInvoice || !(linkedInvoice.amount_paid > 0)) {
                return (
                  <p className="text-sm text-amber-700 dark:text-amber-400">
                    This record isn't linked to a real, paid invoice — edit it and pick one before distributing.
                    Without one, the revenue was never actually added to the bank balance, so distributing would
                    incorrectly subtract money that isn't there.
                  </p>
                );
              }
              return null;
            })()}
            <div className="grid gap-1 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800">
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>Revenue</span>
                <span>
                  {symbol}
                  {distributeTarget.revenue_amount.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>Supplier cost {distributeTarget.cost_usd_total > 0 && !distributeTarget.expense_id ? '(estimate)' : ''}</span>
                <span>
                  {symbol}
                  {distributeTarget.cost_mvr.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between font-semibold text-slate-900 dark:text-white">
                <span>Net profit</span>
                <span
                  className={distributeTarget.net_profit < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}
                >
                  {symbol}
                  {distributeTarget.net_profit.toFixed(2)}
                </span>
              </div>
            </div>

            {distributeTarget.cost_usd_total > 0 && !distributeTarget.expense_id && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                This only pays shareholders their share of the estimate above — the USD cost itself stays in the bank
                balance, untouched, until you record the real purchase separately with "Record USD purchase" (whenever
                that actually happens, at whatever the real rate is that day).
              </p>
            )}

            {eligibleShareholders.length === 0 ? (
              <p className="text-sm text-amber-700 dark:text-amber-400">
                No active shareholder has an ownership percentage set — add one on the Shareholders page first.
              </p>
            ) : (
              <div>
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Split preview</p>
                <div className="mt-1 divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
                  {eligibleShareholders.map((s) => (
                    <div key={s.id} className="flex justify-between px-3 py-2 text-sm">
                      <span className="text-slate-700 dark:text-slate-300">
                        {s.name} ({s.ownership_percent}%)
                      </span>
                      <span className="font-medium text-slate-900 dark:text-white">
                        {symbol}
                        {round2((distributeTarget.net_profit * s.ownership_percent) / 100).toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {distributeError && <p className="text-sm text-red-600 dark:text-red-400">{distributeError}</p>}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleDistribute}
                disabled={
                  distributing ||
                  eligibleShareholders.length === 0 ||
                  distributeTarget.net_profit <= 0 ||
                  !distributeTarget.invoice_id ||
                  !invoices.find((inv) => inv.id === distributeTarget.invoice_id && inv.amount_paid > 0)
                }
                className="min-h-11 rounded-md bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
              >
                {distributing ? 'Distributing…' : 'Distribute'}
              </button>
              <button
                type="button"
                onClick={() => setDistributeTarget(null)}
                className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              >
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
              {viewTarget.deal.cost_usd_total > 0 && (
                <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span>USD purchase</span>
                  <span>
                    {viewTarget.deal.converted_at
                      ? `Recorded ${viewTarget.deal.converted_at.slice(0, 10)} at rate ${viewTarget.deal.exchange_rate}`
                      : 'Not yet recorded — cost still reserved in the bank balance'}
                  </span>
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

      <Modal
        open={Boolean(convertTarget)}
        onClose={() => {
          setConvertTarget(null);
          setConvertError('');
        }}
        title="Record USD purchase"
        maxWidthClass="max-w-lg"
      >
        {convertTarget && (
          <div className="grid gap-3">
            <p className="text-sm text-slate-600 dark:text-slate-400">{convertTarget.description}</p>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Enter the real rate you actually got today when you bought the USD ({symbol}
              {convertTarget.cost_usd_total.toFixed(2)} to convert) — this is what actually subtracts the cost from
              the bank balance. It's stayed there, untouched, until now.
            </p>
            <label className="block">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Exchange rate (MVR per USD)</span>
              <input
                type="number"
                min="0"
                step="0.0001"
                autoFocus
                value={convertRate}
                onChange={(e) => setConvertRate(e.target.value)}
                placeholder="e.g. 15.4"
                className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              />
            </label>
            <div className="grid gap-1 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800">
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>Cost (USD)</span>
                <span>${convertTarget.cost_usd_total.toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-semibold text-slate-900 dark:text-white">
                <span>Cost to record ({symbol})</span>
                <span>
                  {symbol}
                  {round2(convertTarget.cost_usd_total * (Number(convertRate) || 0)).toFixed(2)}
                </span>
              </div>
            </div>

            {convertError && <p className="text-sm text-red-600 dark:text-red-400">{convertError}</p>}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleConvert}
                disabled={converting}
                className="min-h-11 rounded-md bg-amber-600 px-4 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-60"
              >
                {converting ? 'Recording…' : 'Record purchase'}
              </button>
              <button
                type="button"
                onClick={() => setConvertTarget(null)}
                className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </Modal>

      <div className="mt-6 rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
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
                          <ConversionPill deal={deal} />
                        </div>
                      </td>
                      {canManage && (
                        <td className="whitespace-nowrap px-4 py-3">
                          <div className="flex justify-end gap-1.5">{rowActions(deal)}</div>
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
                          <ConversionPill deal={deal} />
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
                  {canManage && <div className="flex flex-wrap gap-1.5 pt-1">{rowActions(deal)}</div>}
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
