import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import Modal from '../../components/Modal';
import KpiCard from '../../components/KpiCard';
import MobileListAccordion from '../../components/MobileListAccordion';
import IconActionButton from '../../components/IconActionButton';
import StatusFilterChips from '../../components/StatusFilterChips';
import SupplierInvoiceModal from '../../components/SupplierInvoiceModal';
import { TrendDownIcon, BankIcon, RefreshIcon, CheckCircleIcon, PlusIcon, PencilIcon, TrashIcon, DownloadIcon, ClockIcon } from '../../components/icons';
import { todayStr } from '../../lib/date';
import { useConfirm } from '../../lib/useConfirm';

// USD & suppliers. A supplier sends a custom invoice; you pay the full
// amount of it from the USD account. Buying USD is NOT an expense (it swaps
// MVR for USD); the expense is booked when a supplier invoice is paid.
//   To pay                  supplier invoices received, not yet paid (exact)
//   Waiting for an invoice  sales whose supplier invoice hasn't arrived yet (estimate)
// See routes/supplierInvoices.js, routes/supplierCosts.js, lib/usdLedger.js.
const usd = (n) => `$${Number(n || 0).toFixed(2)}`;
const num = (v) => Number(v) || 0;

const TYPE_STYLE = {
  opening: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  buy: 'bg-lagoon-100 text-lagoon-800 dark:bg-lagoon-950 dark:text-lagoon-300',
  supplier_payment: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  sell: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
};

const MODAL_TITLE = {
  buy: 'Buy USD',
  sell: 'Convert USD back to MVR',
  opening: 'Opening USD balance',
};

const INPUT =
  'mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white';
const LABEL = 'text-sm font-medium text-slate-700 dark:text-slate-300';
const PRIMARY_BTN =
  'flex min-h-11 items-center gap-1.5 rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-700 dark:bg-lagoon-600 dark:hover:bg-lagoon-500';
const SECONDARY_BTN =
  'flex min-h-11 items-center gap-1.5 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800';
const ACTION_BTN =
  'inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800';
const PAY_BTN =
  'inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 dark:bg-lagoon-600 dark:hover:bg-lagoon-500';

function StatusPill({ si }) {
  let label = 'To pay';
  let cls = 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300';
  if (si.status === 'paid') {
    label = 'Paid';
    cls = 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300';
  } else if (si.is_overdue) {
    label = 'Overdue';
    cls = 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300';
  }
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}

function linkedLabel(si) {
  if (!si.links.length) return 'Not linked';
  const names = si.links.map((l) => l.invoice_number);
  const shown = names.slice(0, 2).join(', ');
  return names.length > 2 ? `${shown} +${names.length - 2}` : shown;
}

const EMPTY_FORM = { txn_date: '', usd_amount: '', mvr_amount: '', rate: '', reference: '', notes: '' };

export default function SupplierCosts() {
  const { token, can } = useAuth();
  const { toast } = useToast();
  const canView = can('financials', 'view');
  const canManage = can('financials', 'manage');
  const { confirm, confirmDialog } = useConfirm();

  const [data, setData] = useState(null);
  const [account, setAccount] = useState(null);
  const [invoices, setInvoices] = useState(null);
  const [tab, setTab] = useState('unpaid');
  const [error, setError] = useState('');
  const [settings, setSettings] = useState(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // Buy / convert / opening balance modal: { type, editingId } | null
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Supplier invoice modal: { invoice, presetLink } | null
  const [siModal, setSiModal] = useState(null);
  const [trackFrom, setTrackFrom] = useState('');

  function load() {
    api.supplierCosts.report(token).then((d) => { setData(d); setTrackFrom(d.trackFrom); }).catch((err) => setError(err.message));
    api.usdAccount.get(token).then(setAccount).catch((err) => setError(err.message));
    api.supplierInvoices.list(token).then((d) => setInvoices(d.supplierInvoices)).catch((err) => setError(err.message));
  }

  useEffect(() => {
    if (!canView) return;
    load();
    api.settings
      .getSummary(token)
      .then(({ settings }) => setSettings(settings))
      .catch(() => {})
      .finally(() => setSettingsLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, canView]);

  if (!canView) {
    return <div className="px-4 py-10 text-sm text-slate-500 dark:text-slate-400 sm:px-6 lg:px-8">You are not authorized to view this page.</div>;
  }

  const symbol = settings?.currency_symbol || '$';

  if (error && !data) return <div className="px-4 py-10 text-sm text-red-600 dark:text-red-400 sm:px-6 lg:px-8">{error}</div>;
  if (!data || !account || !invoices || !settingsLoaded) return <div className="px-4 py-10 text-sm text-slate-500 dark:text-slate-400 sm:px-6 lg:px-8">Loading…</div>;

  const shown = invoices.filter((s) => s.status === tab);
  const unpaidCount = invoices.filter((s) => s.status === 'unpaid').length;

  function openModal(type, init = {}, editingId = null) {
    setForm({ ...EMPTY_FORM, txn_date: todayStr(), ...init });
    setFormError('');
    setModal({ type, editingId });
  }

  function openEdit(t) {
    openModal(
      t.type,
      {
        txn_date: t.txn_date,
        usd_amount: String(t.usd_amount),
        mvr_amount: t.type === 'supplier_payment' ? '' : String(t.mvr_amount),
        reference: t.reference,
        notes: t.notes,
      },
      t.id,
    );
  }

  async function handleSave(e) {
    e.preventDefault();
    const type = modal.type;
    const payload = { type, txn_date: form.txn_date, usd_amount: num(form.usd_amount), reference: form.reference, notes: form.notes };
    if (type === 'opening') payload.rate = num(form.rate);
    else payload.mvr_amount = num(form.mvr_amount);
    setSaving(true);
    setFormError('');
    try {
      if (modal.editingId) await api.usdAccount.update(modal.editingId, payload, token);
      else await api.usdAccount.create(payload, token);
      toast(modal.editingId ? 'Entry updated.' : 'Entry saved.', { type: 'success' });
      setModal(null);
      load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteEntry(t) {
    if (!(await confirm({ title: 'Delete this entry?', message: `${t.type_label}: ${usd(t.usd_amount)} on ${t.txn_date}. Balances and profit figures are recalculated.`, confirmLabel: 'Delete' }))) return;
    try {
      await api.usdAccount.remove(t.id, token);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handlePay(si) {
    const avg = account.avgRate || 0;
    const cost = avg > 0 ? ` The expense is booked at ${symbol}${(si.usd_amount * avg).toFixed(2)} (average cost).` : '';
    if (
      !(await confirm({
        title: `Pay ${si.supplier} ${usd(si.usd_amount)}?`,
        message: `Pays the full amount of ${si.number ? `invoice ${si.number}` : 'this invoice'} from the USD account (${usd(account.balanceUsd)} available).${cost}`,
        confirmLabel: 'Pay in full',
        danger: false,
      }))
    )
      return;
    setError('');
    try {
      await api.supplierInvoices.pay(si.id, {}, token);
      toast(`Paid ${si.supplier} ${usd(si.usd_amount)}.`, { type: 'success' });
      load();
    } catch (err) {
      setError(err.message);
      const short = Math.max(si.usd_amount - account.balanceUsd, 0);
      if (short > 0) openModal('buy', { usd_amount: short.toFixed(2) });
    }
  }

  async function handleUnpay(si) {
    if (!(await confirm({ title: 'Undo this payment?', message: `${usd(si.usd_amount)} goes back to the USD account and the invoice returns to "To pay".`, confirmLabel: 'Undo payment' }))) return;
    try {
      await api.supplierInvoices.unpay(si.id, token);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeleteInvoice(si) {
    if (!(await confirm({ title: 'Delete this supplier invoice?', message: `${si.supplier} ${si.number} · ${usd(si.usd_amount)}`, confirmLabel: 'Delete' }))) return;
    try {
      await api.supplierInvoices.remove(si.id, token);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleNoInvoiceNeeded(a) {
    if (!(await confirm({ title: `No supplier invoice needed for ${a.number}?`, message: 'It stops showing as waiting. You can bring it back later.', confirmLabel: 'Not needed', danger: false }))) return;
    try {
      await api.supplierCosts.markDone(a.invoice_id, true, token);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveTrackFrom() {
    try {
      await api.supplierCosts.setTrackFrom(trackFrom, token);
      toast('Saved.', { type: 'success' });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  // Live preview numbers for the modal.
  const fUsd = num(form.usd_amount);
  const fMvr = num(form.mvr_amount);
  const avg = account.avgRate || 0;
  const effectiveRate = modal && fUsd > 0 ? (modal.type === 'opening' ? num(form.rate) : fMvr / fUsd) : 0;
  const sellFx = fMvr - fUsd * avg;

  const short = data.shortfallUsd > 0;

  function invoiceActions(si) {
    if (!canManage) return si.has_file ? <IconActionButton icon={DownloadIcon} tone="lagoon" onClick={() => api.supplierInvoices.openFile(si.id, token)} title="View invoice file" label="View invoice file" /> : null;
    return (
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {si.status === 'unpaid' && (
          <button onClick={() => handlePay(si)} className={PAY_BTN}>
            <CheckCircleIcon width={14} height={14} />
            Pay in full
          </button>
        )}
        {si.has_file && <IconActionButton icon={DownloadIcon} tone="lagoon" onClick={() => api.supplierInvoices.openFile(si.id, token)} title="View invoice file" label="View invoice file" />}
        <IconActionButton icon={PencilIcon} tone="slate" onClick={() => setSiModal({ invoice: si })} title={si.status === 'paid' ? 'Client invoices' : 'Edit'} label={si.status === 'paid' ? 'Edit client invoice links' : 'Edit supplier invoice'} />
        {si.status === 'paid' ? (
          <button onClick={() => handleUnpay(si)} className={ACTION_BTN}>
            Undo payment
          </button>
        ) : (
          <IconActionButton icon={TrashIcon} tone="red" onClick={() => handleDeleteInvoice(si)} title="Delete" label="Delete supplier invoice" />
        )}
      </div>
    );
  }

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8 xl:py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-extrabold text-slate-900 dark:text-white">USD &amp; suppliers</h1>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setSiModal({ invoice: null })} className={PRIMARY_BTN}>
              <PlusIcon width={16} height={16} />
              Supplier invoice
            </button>
            <button onClick={() => openModal('buy')} className={SECONDARY_BTN}>
              <PlusIcon width={16} height={16} />
              Buy USD
            </button>
            <button onClick={() => openModal('sell')} className={SECONDARY_BTN}>
              <TrendDownIcon width={16} height={16} />
              Convert to MVR
            </button>
          </div>
        )}
      </div>

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {account.warning && <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{account.warning}</p>}
      {confirmDialog}

      {!account.hasOpening && (
        <div className="mt-4 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <p className="font-medium">Set your opening USD balance</p>
          <p className="mt-1">
            Enter what is in your USD account today and the average rate it cost you. Date it today (or the day you start tracking here) so older history isn't re-valued.
          </p>
          {canManage && (
            <button onClick={() => openModal('opening')} className="mt-2 rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700">
              Set opening balance
            </button>
          )}
        </div>
      )}

      {short ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-red-50 p-4 text-sm text-red-900 dark:bg-red-950 dark:text-red-200">
          <p>
            <b>You need to buy {usd(data.shortfallUsd)}</b> to pay every supplier invoice
            {data.shortfallMvr ? ` (about ${symbol}${data.shortfallMvr.toFixed(2)} at ${data.rate})` : ''}.
          </p>
          {canManage && (
            <button onClick={() => openModal('buy', { usd_amount: data.shortfallUsd.toFixed(2) })} className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700">
              Buy {usd(data.shortfallUsd)}
            </button>
          )}
        </div>
      ) : (
        data.toPayCount > 0 && (
          <p className="mt-4 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
            The USD account covers every unpaid supplier invoice, with {usd(data.coverUsd)} to spare.
          </p>
        )
      )}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          icon={<BankIcon />}
          label="USD balance"
          value={usd(account.balanceUsd)}
          sub={account.avgRate ? `Worth ${symbol}${account.bookValueMvr.toFixed(2)} at ${account.avgRate.toFixed(2)} avg` : 'No USD held'}
          tone="neutral"
        />
        <KpiCard
          icon={<TrendDownIcon />}
          label="Supplier invoices to pay"
          value={usd(data.toPayUsd)}
          sub={data.toPayCount ? `${data.toPayCount} invoice${data.toPayCount === 1 ? '' : 's'}${data.overdueUsd > 0 ? ` · ${usd(data.overdueUsd)} overdue` : ''}` : 'Nothing to pay'}
          tone={data.overdueUsd > 0 ? 'negative' : data.toPayUsd > 0 ? 'warning' : 'positive'}
        />
        <KpiCard
          icon={<ClockIcon />}
          label="Waiting for an invoice"
          value={usd(data.awaitingUsd)}
          sub={`Estimate · ${data.awaiting.length} sale${data.awaiting.length === 1 ? '' : 's'}`}
          tone="neutral"
        />
        <KpiCard
          icon={<RefreshIcon />}
          label="Paid this year"
          value={usd(data.paidThisYearUsd)}
          sub={`${data.paidThisYearCount} supplier invoice${data.paidThisYearCount === 1 ? '' : 's'}`}
          tone="neutral"
        />
      </div>

      <details className="mt-4 rounded-2xl bg-white/60 px-4 py-3 text-sm text-slate-600 dark:bg-slate-900 dark:text-slate-400">
        <summary className="cursor-pointer font-medium text-slate-800 dark:text-slate-200">How this works</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li><b>Enter each supplier invoice when it arrives.</b> You always pay the full amount, so "Pay in full" is one click.</li>
          <li><b>Buying USD is not an expense.</b> It moves money from your MVR account to your USD account. Your MVR bank balance goes down, your USD balance goes up, profit doesn't change.</li>
          <li><b>Paying a supplier invoice is the expense.</b> It is booked in MVR at the USD account's average cost.</li>
          <li><b>Link a supplier invoice to the client invoices it is for</b> (one or many, with an amount each). Sales with no supplier invoice yet show under "Waiting for an invoice", estimated from the product's cost price.</li>
          <li>Converting USD back to MVR books a gain or loss against the average cost.</li>
        </ul>
      </details>

      <Modal open={Boolean(modal)} onClose={() => setModal(null)} title={modal ? `${modal.editingId ? 'Edit: ' : ''}${MODAL_TITLE[modal.type]}` : ''} maxWidthClass="max-w-lg">
        {modal && (
          <form onSubmit={handleSave} className="grid gap-3">
            {modal.type === 'opening' && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                What is in the USD account at the start of this date, and its average cost. Anything recorded before this date is left out of the balance.
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className={LABEL}>Date</span>
                <input type="date" required value={form.txn_date} onChange={(e) => setForm((f) => ({ ...f, txn_date: e.target.value }))} className={INPUT} />
              </label>
              <label className="block">
                <span className={LABEL}>USD amount</span>
                <input type="number" min="0" step="0.01" required autoFocus value={form.usd_amount} onChange={(e) => setForm((f) => ({ ...f, usd_amount: e.target.value }))} className={INPUT} />
              </label>
            </div>

            {modal.type === 'opening' && (
              <label className="block">
                <span className={LABEL}>Average rate (MVR per USD)</span>
                <input type="number" min="0" step="0.0001" required value={form.rate} onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))} className={INPUT} />
              </label>
            )}
            {(modal.type === 'buy' || modal.type === 'sell') && (
              <label className="block">
                <span className={LABEL}>{modal.type === 'buy' ? 'MVR paid' : 'MVR received'}</span>
                <input type="number" min="0" step="0.01" required value={form.mvr_amount} onChange={(e) => setForm((f) => ({ ...f, mvr_amount: e.target.value }))} className={INPUT} />
              </label>
            )}


            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className={LABEL}>Reference</span>
                <input type="text" value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} placeholder="Bank ref / invoice no." className={INPUT} />
              </label>
              <label className="block">
                <span className={LABEL}>Notes</span>
                <input type="text" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className={INPUT} />
              </label>
            </div>

            <div className="grid gap-1 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800">
              {(modal.type === 'buy' || modal.type === 'opening') && (
                <div className="flex justify-between text-slate-700 dark:text-slate-200">
                  <span>Rate</span>
                  <span>{effectiveRate > 0 ? effectiveRate.toFixed(4) : '—'}</span>
                </div>
              )}
              {modal.type === 'buy' && <p className="text-xs text-slate-500 dark:text-slate-400">Moves MVR to USD. Not an expense.</p>}
              {modal.type === 'sell' && (
                <div className="flex justify-between font-semibold text-slate-900 dark:text-white">
                  <span>{sellFx >= 0 ? 'FX gain' : 'FX loss'}</span>
                  <span>{avg > 0 ? `${symbol}${Math.abs(sellFx).toFixed(2)}` : '—'}</span>
                </div>
              )}
            </div>

            {formError && <p className="text-sm text-red-600 dark:text-red-400">{formError}</p>}
            <div className="flex gap-3">
              <button type="submit" disabled={saving} className="min-h-11 rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60 dark:bg-lagoon-600 dark:hover:bg-lagoon-500">
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button type="button" onClick={() => setModal(null)} className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
                Cancel
              </button>
            </div>
          </form>
        )}
      </Modal>


      <SupplierInvoiceModal
        open={Boolean(siModal)}
        onClose={() => setSiModal(null)}
        token={token}
        invoice={siModal?.invoice || null}
        presetLink={siModal?.presetLink || null}
        onSaved={() => {
          setSiModal(null);
          toast('Saved.', { type: 'success' });
          load();
        }}
      />

      <div className="mt-6 rounded-3xl bg-white dark:border shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Supplier invoices</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Each one is paid in full from the USD account.</p>
          </div>
          <StatusFilterChips
            options={[
              { value: 'unpaid', label: `To pay${unpaidCount ? ` (${unpaidCount})` : ''}` },
              { value: 'paid', label: 'Paid' },
            ]}
            value={tab}
            onChange={setTab}
          />
        </div>
        {shown.length === 0 ? (
          <p className="p-5 text-sm text-slate-500 dark:text-slate-400">
            {tab === 'unpaid' ? 'No unpaid supplier invoices. Use "Supplier invoice" when a bill arrives.' : 'No paid supplier invoices yet.'}
          </p>
        ) : (
          <>
            <div className="hidden overflow-x-auto sm:block">
              <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                    <th className="px-5 py-3">Supplier</th>
                    <th className="px-4 py-3">{tab === 'paid' ? 'Paid' : 'Due'}</th>
                    <th className="px-4 py-3">For client invoices</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {shown.map((si) => (
                    <tr key={si.id}>
                      <td className="px-5 py-3">
                        <p className="font-medium text-slate-900 dark:text-white">{si.supplier}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{si.number || 'No number'} · {si.invoice_date}</p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-300">{tab === 'paid' ? si.paid_at : si.due_date || '—'}</td>
                      <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300" title={si.links.map((l) => `${l.invoice_number} ${l.client_name || ''} ${usd(l.usd_amount)}`).join('\n')}>
                        {linkedLabel(si)}
                        {si.links.length > 0 && si.unassigned_usd > 0 && <span className="block text-amber-600 dark:text-amber-400">{usd(si.unassigned_usd)} not assigned</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-medium text-slate-900 dark:text-white">{usd(si.usd_amount)}</td>
                      <td className="px-4 py-3"><StatusPill si={si} /></td>
                      <td className="px-5 py-3">{invoiceActions(si)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col gap-2.5 p-4 sm:hidden">
              {shown.map((si) => (
                <MobileListAccordion
                  key={si.id}
                  name="supplier-invoices"
                  accent={si.status === 'paid' ? 'bg-emerald-500' : si.is_overdue ? 'bg-red-500' : 'bg-amber-500'}
                  summary={
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-900 dark:text-white">{si.supplier}</p>
                        <p className="text-slate-500 dark:text-slate-400">{si.number || 'No number'}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-medium text-slate-900 dark:text-white">{usd(si.usd_amount)}</p>
                        <StatusPill si={si} />
                      </div>
                    </div>
                  }
                >
                  <div className="flex justify-between">
                    <dt className="text-slate-500 dark:text-slate-400">{si.status === 'paid' ? 'Paid' : 'Due'}</dt>
                    <dd className="text-slate-900 dark:text-white">{si.status === 'paid' ? si.paid_at : si.due_date || '—'}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500 dark:text-slate-400">For</dt>
                    <dd className="text-right text-slate-900 dark:text-white">
                      {linkedLabel(si)}
                      {si.links.length > 0 && si.unassigned_usd > 0 && <span className="block text-amber-600 dark:text-amber-400">{usd(si.unassigned_usd)} not assigned</span>}
                    </dd>
                  </div>
                  {invoiceActions(si)}
                </MobileListAccordion>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="mt-6 rounded-3xl bg-white dark:border shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Waiting for a supplier invoice</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Sales since {data.trackFrom} whose supplier cost isn't covered by an invoice yet. The amount is an estimate from product cost prices.
          </p>
        </div>
        {data.awaiting.length === 0 ? (
          <p className="p-5 text-sm text-slate-500 dark:text-slate-400">Nothing is waiting. Every recent sale is covered.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.awaiting.map((a) => (
              <li key={a.invoice_id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900 dark:text-white">{a.number} <span className="font-normal text-slate-500 dark:text-slate-400">· {a.client_name}</span></p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {a.issue_date} · about {usd(a.remainingUsd)}
                    {a.linkedUsd > 0 ? ` still to invoice (${usd(a.linkedUsd)} already linked)` : ' to be invoiced'}
                  </p>
                </div>
                {canManage && (
                  <div className="flex flex-wrap gap-1.5">
                    <button onClick={() => setSiModal({ invoice: null, presetLink: { invoice_id: a.invoice_id, usd_amount: a.remainingUsd } })} className={ACTION_BTN}>
                      <PlusIcon width={14} height={14} />
                      Add supplier invoice
                    </button>
                    <button onClick={() => handleNoInvoiceNeeded(a)} className={ACTION_BTN}>Not needed</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {canManage && (
          <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 px-5 py-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
            <label className="block">
              Only count sales from
              <input type="date" value={trackFrom} onChange={(e) => setTrackFrom(e.target.value)} className="ml-2 min-h-9 rounded-md border border-slate-300 px-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
            </label>
            <button onClick={saveTrackFrom} disabled={!trackFrom || trackFrom === data.trackFrom} className={`${ACTION_BTN} disabled:opacity-50`}>Save</button>
          </div>
        )}
      </div>

      <div className="mt-6 rounded-3xl bg-white dark:border shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">USD account activity</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Newest first. Balance is after each entry.</p>
        </div>
        {account.transactions.length === 0 ? (
          <p className="p-5 text-sm text-slate-500 dark:text-slate-400">No entries yet. Set the opening balance, then record purchases and supplier payments.</p>
        ) : (
          <>
            <div className="hidden overflow-x-auto sm:block">
              <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                    <th className="px-5 py-3">Date</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3 text-right">USD</th>
                    <th className="px-4 py-3 text-right">{symbol}</th>
                    <th className="px-4 py-3 text-right">Rate</th>
                    <th className="px-4 py-3 text-right">USD balance</th>
                    <th className="px-4 py-3">Details</th>
                    {canManage && <th className="px-5 py-3" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {account.transactions.map((t) => (
                    <tr key={t.id}>
                      <td className="whitespace-nowrap px-5 py-3 text-slate-600 dark:text-slate-400">{t.txn_date}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_STYLE[t.type]}`}>{t.type_label}</span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-medium dark:text-white">
                        {t.type === 'buy' || t.type === 'opening' ? '+' : '−'}
                        {usd(t.usd_amount)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-slate-600 dark:text-slate-300">
                        {t.type === 'supplier_payment' ? `${t.costMvr.toFixed(2)} cost` : t.mvr_amount.toFixed(2)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-slate-600 dark:text-slate-300">
                        {t.type === 'supplier_payment' ? (t.usd_amount ? (t.costMvr / t.usd_amount).toFixed(4) : '—') : (t.mvr_amount / t.usd_amount).toFixed(4)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right dark:text-white">{usd(t.balanceUsd)}</td>
                      <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                        {[t.payee, t.type === 'sell' && `${t.fxMvr >= 0 ? 'gain' : 'loss'} ${symbol}${Math.abs(t.fxMvr).toFixed(2)}`, t.reference]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </td>
                      {canManage && (
                        <td className="whitespace-nowrap px-5 py-3">
                          <div className="flex justify-end gap-1.5">
                            <IconActionButton icon={PencilIcon} tone="slate" onClick={() => openEdit(t)} title="Edit" label="Edit entry" />
                            <IconActionButton icon={TrashIcon} tone="red" onClick={() => handleDeleteEntry(t)} title="Delete" label="Delete entry" />
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col gap-2.5 p-4 sm:hidden">
              {account.transactions.map((t) => (
                <MobileListAccordion
                  key={t.id}
                  name="usd-ledger"
                  summary={
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-900 dark:text-white">{t.type_label}</p>
                        <p className="text-slate-500 dark:text-slate-400">{t.txn_date}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-slate-900 dark:text-white">
                          {t.type === 'buy' || t.type === 'opening' ? '+' : '−'}
                          {usd(t.usd_amount)}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Bal {usd(t.balanceUsd)}</p>
                      </div>
                    </div>
                  }
                >
                  <div className="flex justify-between">
                    <dt className="text-slate-500 dark:text-slate-400">{t.type === 'supplier_payment' ? 'Cost booked' : symbol}</dt>
                    <dd className="text-slate-900 dark:text-white">{(t.type === 'supplier_payment' ? t.costMvr : t.mvr_amount).toFixed(2)}</dd>
                  </div>
                  {t.payee && (
                    <div className="flex justify-between">
                      <dt className="text-slate-500 dark:text-slate-400">Supplier</dt>
                      <dd className="text-slate-900 dark:text-white">{t.payee}</dd>
                    </div>
                  )}
                  {t.reference && (
                    <div className="flex justify-between">
                      <dt className="text-slate-500 dark:text-slate-400">Reference</dt>
                      <dd className="text-slate-900 dark:text-white">{t.reference}</dd>
                    </div>
                  )}
                  {canManage && (
                    <div className="flex gap-1.5 pt-1">
                      <IconActionButton icon={PencilIcon} tone="slate" onClick={() => openEdit(t)} title="Edit" label="Edit entry" />
                      <IconActionButton icon={TrashIcon} tone="red" onClick={() => handleDeleteEntry(t)} title="Delete" label="Delete entry" />
                    </div>
                  )}
                </MobileListAccordion>
              ))}
            </div>
          </>
        )}
      </div>


    </div>
  );
}
