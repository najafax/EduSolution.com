import { Fragment, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import Modal from '../../components/Modal';
import KpiCard from '../../components/KpiCard';
import MobileListAccordion from '../../components/MobileListAccordion';
import IconActionButton from '../../components/IconActionButton';
import { TrendDownIcon, BankIcon, RefreshIcon, CheckCircleIcon, PlusIcon, PencilIcon, TrashIcon } from '../../components/icons';
import { todayStr } from '../../lib/date';
import { useConfirm } from '../../lib/useConfirm';

// The USD account (a ledger of USD in and out, carried at average cost) and
// what the business owes suppliers in USD. Buying USD is NOT an expense — it
// swaps MVR for USD. The expense is booked when USD is paid to a supplier.
// See routes/usdAccount.js, routes/supplierCosts.js and lib/usdLedger.js.
function monthLabel(month) {
  return new Date(`${month}-01T00:00:00`).toLocaleString('default', { month: 'short', year: 'numeric' });
}

const usd = (n) => `$${Number(n || 0).toFixed(2)}`;
const num = (v) => Number(v) || 0;

const STATUS_STYLE = {
  covered: { label: 'Paid', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' },
  partial: { label: 'Partly paid', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' },
  unrecorded: { label: 'To pay', cls: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' },
};

const TYPE_STYLE = {
  opening: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  buy: 'bg-lagoon-100 text-lagoon-800 dark:bg-lagoon-950 dark:text-lagoon-300',
  supplier_payment: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  sell: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
};

const MODAL_TITLE = {
  buy: 'Buy USD',
  supplier_payment: 'Pay supplier from USD account',
  sell: 'Convert USD back to MVR',
  opening: 'Opening USD balance',
};

const INPUT =
  'mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white';
const LABEL = 'text-sm font-medium text-slate-700 dark:text-slate-300';
const ACTION_BTN =
  'inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800';

function StatusPill({ status }) {
  const st = STATUS_STYLE[status];
  if (!st) return <span className="text-slate-400">—</span>;
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>;
}

function LinesList({ lines }) {
  return (
    <ul className="w-full text-xs">
      {lines.map((l) => (
        <li key={l.name} className="flex justify-between gap-3 py-0.5 text-slate-600 dark:text-slate-300">
          <span className="truncate">
            {l.quantity} × {l.name}
          </span>
          <span className="shrink-0">{usd(l.usdCost)}</span>
        </li>
      ))}
    </ul>
  );
}

function MonthActions({ m, onPay, onSettle, onUnsettle }) {
  return (
    <div className="inline-flex flex-wrap justify-end gap-1.5">
      {m.remainingUsd > 0 && (
        <button onClick={() => onPay(m)} className={ACTION_BTN}>
          <RefreshIcon width={14} height={14} />
          Pay supplier
        </button>
      )}
      {m.remainingUsd > 0 && (
        <button onClick={() => onSettle(m)} className={ACTION_BTN} title="Already paid before, no ledger entry will be created">
          <CheckCircleIcon width={14} height={14} />
          Already paid
        </button>
      )}
      {m.settledUsd > 0 && (
        <button onClick={() => onUnsettle(m)} className={ACTION_BTN}>
          Undo
        </button>
      )}
    </div>
  );
}

const EMPTY_FORM = { txn_date: '', usd_amount: '', mvr_amount: '', rate: '', payee: '', reference: '', notes: '', supplier_cost_month: '' };

export default function SupplierCosts() {
  const { token, can } = useAuth();
  const { toast } = useToast();
  const canView = can('financials', 'view');
  const canManage = can('financials', 'manage');
  const { confirm, confirmDialog } = useConfirm();

  const [data, setData] = useState(null);
  const [account, setAccount] = useState(null);
  const [error, setError] = useState('');
  const [settings, setSettings] = useState(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [expanded, setExpanded] = useState(null);

  // modal: { type, editingId } | null
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  function load() {
    api.supplierCosts.report(token).then(setData).catch((err) => setError(err.message));
    api.usdAccount.get(token).then(setAccount).catch((err) => setError(err.message));
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
  if (!data || !account || !settingsLoaded) return <div className="px-4 py-10 text-sm text-slate-500 dark:text-slate-400 sm:px-6 lg:px-8">Loading…</div>;

  const currentYear = data.byYear[0];

  function openModal(type, init = {}, editingId = null) {
    setForm({ ...EMPTY_FORM, txn_date: todayStr(), ...init });
    setFormError('');
    setModal({ type, editingId });
  }

  function openPay(m) {
    openModal('supplier_payment', { usd_amount: String(m.remainingUsd), supplier_cost_month: m.month });
  }

  function openEdit(t) {
    openModal(
      t.type,
      {
        txn_date: t.txn_date,
        usd_amount: String(t.usd_amount),
        mvr_amount: t.type === 'supplier_payment' ? '' : String(t.mvr_amount),
        payee: t.payee,
        reference: t.reference,
        notes: t.notes,
        supplier_cost_month: t.supplier_cost_month,
      },
      t.id,
    );
  }

  async function handleSave(e) {
    e.preventDefault();
    const type = modal.type;
    const payload = {
      type,
      txn_date: form.txn_date,
      usd_amount: num(form.usd_amount),
      payee: form.payee,
      reference: form.reference,
      notes: form.notes,
      supplier_cost_month: type === 'supplier_payment' ? form.supplier_cost_month : '',
    };
    if (type === 'opening') payload.rate = num(form.rate);
    else if (type !== 'supplier_payment') payload.mvr_amount = num(form.mvr_amount);
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

  async function handleDelete(t) {
    if (
      !(await confirm({
        title: 'Delete this entry?',
        message: `${t.type_label}: ${usd(t.usd_amount)} on ${t.txn_date}. Balances and profit figures are recalculated.`,
        confirmLabel: 'Delete',
      }))
    )
      return;
    try {
      await api.usdAccount.remove(t.id, token);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSettle(m) {
    if (
      !(await confirm({
        title: `Mark ${monthLabel(m.month)} as already paid?`,
        message: `This marks ${usd(m.remainingUsd)} as already paid to suppliers (before you used this account). It creates no ledger entry, so no expense or balance changes.`,
        confirmLabel: 'Mark as paid',
        danger: false,
      }))
    )
      return;
    try {
      await api.supplierCosts.settle({ month: m.month }, token);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleUnsettle(m) {
    try {
      await api.supplierCosts.unsettle(m.month, token);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  // Live preview numbers for the modal.
  const fUsd = num(form.usd_amount);
  const fMvr = num(form.mvr_amount);
  const avg = account.avgRate || 0;
  const effectiveRate = modal && modal.type !== 'supplier_payment' && fUsd > 0 ? (modal.type === 'opening' ? num(form.rate) : fMvr / fUsd) : 0;
  const payCost = fUsd * avg;
  const sellFx = fMvr - fUsd * avg;

  const coverTone = data.coverUsd >= 0 ? 'positive' : 'negative';

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8 xl:py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-extrabold text-slate-900 dark:text-white">USD account &amp; supplier costs</h1>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => openModal('buy')}
              className="flex min-h-11 items-center gap-1.5 rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-700 dark:bg-lagoon-600 dark:hover:bg-lagoon-500"
            >
              <PlusIcon width={16} height={16} />
              Buy USD
            </button>
            <button
              onClick={() => openModal('supplier_payment')}
              className="flex min-h-11 items-center gap-1.5 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <RefreshIcon width={16} height={16} />
              Pay supplier
            </button>
            <button
              onClick={() => openModal('sell')}
              className="flex min-h-11 items-center gap-1.5 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
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
            Enter what is in your USD account today and the average rate it cost you, so the balance and supplier costs start from the right figure.
            Date it today (or the day you start tracking here) so older history isn't re-valued.
          </p>
          {canManage && (
            <button
              onClick={() => openModal('opening')}
              className="mt-2 rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
            >
              Set opening balance
            </button>
          )}
        </div>
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
          label="Owed to suppliers"
          value={usd(data.toPayUsd)}
          sub="Last 12 months, not yet paid"
          tone={data.toPayUsd > 0 ? 'warning' : 'positive'}
        />
        <KpiCard
          icon={<RefreshIcon />}
          label={data.coverUsd >= 0 ? 'Covered by account' : 'Need to buy'}
          value={usd(Math.abs(data.coverUsd))}
          sub={data.coverUsd >= 0 ? 'Spare USD after paying what is owed' : 'More USD needed to pay what is owed'}
          tone={coverTone}
        />
        <KpiCard
          icon={<BankIcon />}
          label="Paid to suppliers"
          value={usd(account.totalPaidUsd)}
          sub={`Cost booked ${symbol}${account.totalPaidCostMvr.toFixed(2)}`}
          tone="neutral"
        />
      </div>

      <details className="mt-4 rounded-2xl bg-white/60 px-4 py-3 text-sm text-slate-600 dark:bg-slate-900 dark:text-slate-400">
        <summary className="cursor-pointer font-medium text-slate-800 dark:text-slate-200">How this works</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li><b>Buying USD is not an expense.</b> It moves money from your MVR account to your USD account. Your MVR bank balance goes down, your USD balance goes up, profit doesn't change.</li>
          <li><b>Paying a supplier is the expense.</b> It is booked in MVR at the USD account's average cost (for example, 600 USD at an average of 15.33 = MVR 9,200).</li>
          <li><b>Converting USD back to MVR</b> books a gain or loss against that average cost.</li>
          <li><b>Owed</b> comes from your sent and paid invoices: quantity × the product's USD cost price, saved on the invoice when it is created. Set a cost price on every product you sell, since an item with none counts as $0.</li>
          <li>Tag each supplier payment with the month it settles. That is how "To pay" goes down.</li>
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

            {modal.type === 'supplier_payment' && (
              <>
                <label className="block">
                  <span className={LABEL}>Supplier</span>
                  <input type="text" value={form.payee} onChange={(e) => setForm((f) => ({ ...f, payee: e.target.value }))} placeholder="e.g. Edupage" className={INPUT} />
                </label>
                <label className="block">
                  <span className={LABEL}>Pays off costs for</span>
                  <select value={form.supplier_cost_month} onChange={(e) => setForm((f) => ({ ...f, supplier_cost_month: e.target.value }))} className={INPUT}>
                    <option value="">No specific month (advance / general)</option>
                    {data.byMonth
                      .filter((m) => m.usdCost > 0 || m.month === form.supplier_cost_month)
                      .map((m) => (
                        <option key={m.month} value={m.month}>
                          {monthLabel(m.month)} — {usd(m.remainingUsd)} left
                        </option>
                      ))}
                  </select>
                </label>
              </>
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
              {modal.type === 'supplier_payment' && (
                <>
                  <div className="flex justify-between font-semibold text-slate-900 dark:text-white">
                    <span>Expense booked ({symbol}, at average cost)</span>
                    <span>{avg > 0 ? `${symbol}${payCost.toFixed(2)}` : '—'}</span>
                  </div>
                  <div className="flex justify-between text-slate-600 dark:text-slate-400">
                    <span>USD left after this</span>
                    <span>{usd(Math.max(account.balanceUsd - fUsd, 0))}</span>
                  </div>
                </>
              )}
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

      <div className="mt-6 rounded-3xl bg-white dark:border shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Owed to suppliers, by month</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Trailing 12 months. Tap a month to see what it's made of.</p>
        </div>
        <div className="hidden overflow-x-auto sm:block">
          <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
            <thead>
              <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                <th className="px-5 py-3">Month</th>
                <th className="px-4 py-3 text-right">Owed</th>
                <th className="px-4 py-3 text-right">Paid</th>
                <th className="px-4 py-3 text-right">To pay</th>
                <th className="px-4 py-3">Status</th>
                {canManage && <th className="px-5 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.byMonth.map((m) => (
                <Fragment key={m.month}>
                  <tr onClick={() => m.lines.length > 0 && setExpanded(expanded === m.month ? null : m.month)} className={m.lines.length > 0 ? 'cursor-pointer' : ''}>
                    <td className="px-5 py-3 font-medium text-slate-900 dark:text-white">{monthLabel(m.month)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-medium dark:text-white">{usd(m.usdCost)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-slate-600 dark:text-slate-300">{usd(m.recordedUsd + m.settledUsd)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-medium dark:text-white">{usd(m.remainingUsd)}</td>
                    <td className="px-4 py-3">
                      <StatusPill status={m.status} />
                    </td>
                    {canManage && (
                      <td className="whitespace-nowrap px-5 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <MonthActions m={m} onPay={openPay} onSettle={handleSettle} onUnsettle={handleUnsettle} />
                      </td>
                    )}
                  </tr>
                  {expanded === m.month && (
                    <tr className="bg-slate-50 dark:bg-slate-800/50">
                      <td colSpan={canManage ? 6 : 5} className="px-5 py-3">
                        <LinesList lines={m.lines} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-2.5 p-4 sm:hidden">
          {data.byMonth.map((m) => (
            <MobileListAccordion
              key={m.month}
              name="supplier-cost-months"
              summary={
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-slate-900 dark:text-white">{monthLabel(m.month)}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-slate-500 dark:text-slate-400">{usd(m.usdCost)}</span>
                    <StatusPill status={m.status} />
                  </span>
                </div>
              }
            >
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Paid</dt>
                <dd className="text-slate-900 dark:text-white">{usd(m.recordedUsd + m.settledUsd)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">To pay</dt>
                <dd className="font-medium text-slate-900 dark:text-white">{usd(m.remainingUsd)}</dd>
              </div>
              {m.lines.length > 0 && <LinesList lines={m.lines} />}
              {canManage && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <MonthActions m={m} onPay={openPay} onSettle={handleSettle} onUnsettle={handleUnsettle} />
                </div>
              )}
            </MobileListAccordion>
          ))}
        </div>
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
                        {[t.payee, t.supplier_cost_month && `for ${monthLabel(t.supplier_cost_month)}`, t.type === 'sell' && `${t.fxMvr >= 0 ? 'gain' : 'loss'} ${symbol}${Math.abs(t.fxMvr).toFixed(2)}`, t.reference]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </td>
                      {canManage && (
                        <td className="whitespace-nowrap px-5 py-3">
                          <div className="flex justify-end gap-1.5">
                            <IconActionButton icon={PencilIcon} tone="slate" onClick={() => openEdit(t)} title="Edit" label="Edit entry" />
                            <IconActionButton icon={TrashIcon} tone="red" onClick={() => handleDelete(t)} title="Delete" label="Delete entry" />
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
                  {t.supplier_cost_month && (
                    <div className="flex justify-between">
                      <dt className="text-slate-500 dark:text-slate-400">For month</dt>
                      <dd className="text-slate-900 dark:text-white">{monthLabel(t.supplier_cost_month)}</dd>
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
                      <IconActionButton icon={TrashIcon} tone="red" onClick={() => handleDelete(t)} title="Delete" label="Delete entry" />
                    </div>
                  )}
                </MobileListAccordion>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="mt-6 rounded-3xl bg-white dark:border shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Owed, year by year</h2>
        </div>
        <div className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
          {data.byYear.map((y) => (
            <div key={y.year} className="flex items-center justify-between px-5 py-3">
              <span className="font-medium text-slate-900 dark:text-white">{y.year}</span>
              <span className="text-slate-500 dark:text-slate-400">
                {y.itemCount} item{y.itemCount === 1 ? '' : 's'} · <span className="font-medium text-slate-900 dark:text-white">{usd(y.usdCost)}</span>
              </span>
            </div>
          ))}
          {currentYear === undefined && <p className="px-5 py-3 text-slate-500">No sales yet.</p>}
        </div>
      </div>
    </div>
  );
}
