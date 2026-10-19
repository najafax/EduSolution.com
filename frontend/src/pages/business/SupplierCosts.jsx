import { Fragment, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import Modal from '../../components/Modal';
import KpiCard from '../../components/KpiCard';
import MobileListAccordion from '../../components/MobileListAccordion';
import { TrendDownIcon, TrendUpIcon, BankIcon, RefreshIcon, CheckCircleIcon } from '../../components/icons';
import { todayStr } from '../../lib/date';
import { useConfirm } from '../../lib/useConfirm';

// Automatic, aggregate "how much USD do I owe suppliers" report — computed
// server-side straight from real sold invoice line items × each matched
// product's own cost_price, never entered by hand here. Replaces the
// earlier idea of a per-deal manual USD-conversion action (see
// routes/deals.js's/pages/business/ProfitDistribution.jsx's own notes) —
// this page is deliberately the one place that figure lives, decoupled
// from the deals/profit-distribution calculator entirely. See
// routes/supplierCosts.js.
function monthLabel(month) {
  return new Date(`${month}-01T00:00:00`).toLocaleString('default', { month: 'short', year: 'numeric' });
}

const usd = (n) => `$${Number(n || 0).toFixed(2)}`;

const STATUS_STYLE = {
  covered: { label: 'Recorded', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' },
  partial: { label: 'Partly recorded', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' },
  unrecorded: { label: 'To buy', cls: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' },
};

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

const ACTION_BTN =
  'inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800';

function MonthActions({ m, onRecord, onSettle, onUnsettle }) {
  return (
    <div className="inline-flex flex-wrap justify-end gap-1.5">
      {m.remainingUsd > 0 && (
        <button onClick={() => onRecord(m)} className={ACTION_BTN}>
          <RefreshIcon width={14} height={14} />
          Record purchase
        </button>
      )}
      {m.remainingUsd > 0 && (
        <button onClick={() => onSettle(m)} className={ACTION_BTN} title="Already bought, no expense will be created">
          <CheckCircleIcon width={14} height={14} />
          Already bought
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

export default function SupplierCosts() {
  const { token, can } = useAuth();
  const { toast } = useToast();
  const canView = can('financials', 'view');
  const canManage = can('financials', 'manage');

  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [settings, setSettings] = useState(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const [recordTarget, setRecordTarget] = useState(null);
  const [recordRate, setRecordRate] = useState('');
  const [recordUsd, setRecordUsd] = useState('');
  const [recordDate, setRecordDate] = useState(todayStr());
  const [expanded, setExpanded] = useState(null);
  const { confirm, confirmDialog } = useConfirm();
  const [recording, setRecording] = useState(false);
  const [recordError, setRecordError] = useState('');

  function load() {
    api.supplierCosts
      .report(token)
      .then(setData)
      .catch((err) => setError(err.message));
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
  if (!data || !settingsLoaded) return <div className="px-4 py-10 text-sm text-slate-500 dark:text-slate-400 sm:px-6 lg:px-8">Loading…</div>;

  const currentMonth = data.byMonth[data.byMonth.length - 1];
  const currentYear = data.byYear[0];

  function openRecord(month) {
    setRecordTarget(month);
    setRecordRate(data.lastRate ? String(data.lastRate) : '');
    setRecordUsd(String(month.remainingUsd));
    setRecordDate(todayStr());
    setRecordError('');
  }

  async function handleSettle(m) {
    if (
      !(await confirm({
        title: `Mark ${monthLabel(m.month)} as already bought?`,
        message: `This marks ${usd(m.remainingUsd)} as already purchased (for example, recorded on the Expenses page or bought before you used this report). No expense is created, so nothing is double-counted.`,
        confirmLabel: 'Mark as bought',
        danger: false,
      }))
    )
      return;
    try {
      await api.supplierCosts.settle({ month: m.month }, token);
      toast(`${monthLabel(m.month)} marked as already bought.`, { type: 'success' });
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

  async function handleRecord() {
    if (!recordTarget) return;
    const rateNum = Number(recordRate);
    if (!Number.isFinite(rateNum) || rateNum <= 0) {
      setRecordError('Enter the exchange rate you actually got (or expect to get) for this purchase.');
      return;
    }
    setRecordError('');
    setRecording(true);
    try {
      const { costMvr, monthLabel: label } = await api.supplierCosts.record(
        { month: recordTarget.month, exchange_rate: rateNum, usd_amount: Number(recordUsd), expense_date: recordDate },
        token,
      );
      toast(`Recorded ${symbol}${costMvr.toFixed(2)} as a currency exchange expense for ${label}.`, { type: 'success' });
      setRecordTarget(null);
      load();
    } catch (err) {
      setRecordError(err.message);
    } finally {
      setRecording(false);
    }
  }

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8 xl:py-6">
      <div>
        <h1 className="font-display text-2xl font-extrabold text-slate-900 dark:text-white">Supplier Costs</h1>
      </div>

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {confirmDialog}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          icon={<RefreshIcon />}
          label="Still to buy"
          value={usd(data.toBuyUsd)}
          sub="Last 12 months, not yet recorded"
          tone={data.toBuyUsd > 0 ? 'warning' : 'positive'}
        />
        <KpiCard
          icon={<TrendDownIcon />}
          label="Owed this month"
          value={usd(currentMonth.usdCost)}
          sub={monthLabel(currentMonth.month)}
          tone={currentMonth.usdCost > 0 ? 'warning' : 'neutral'}
        />
        <KpiCard icon={<TrendUpIcon />} label="Owed this year" value={usd(currentYear?.usdCost)} tone="neutral" />
        <KpiCard icon={<BankIcon />} label="Already covered" value={usd(data.recordedUsd)} sub="Last 12 months" tone="positive" />
      </div>

      <details className="mt-4 rounded-2xl bg-white/60 px-4 py-3 text-sm text-slate-600 dark:bg-slate-900 dark:text-slate-400">
        <summary className="cursor-pointer font-medium text-slate-800 dark:text-slate-200">How this is calculated</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Every sent or paid invoice line item (drafts and voids are left out), counted in the month of the invoice date.</li>
          <li>Cost = quantity × the product's cost price in USD. The cost price is saved on the invoice when it is created, so changing a product's cost later doesn't change past months.</li>
          <li>An item with no matching product (matched by product, or by exact name) counts as $0, so set a cost price on every product you sell.</li>
          <li>"Recorded" is what you've already bought: purchases recorded here, plus months marked as already bought. "Still to buy" is the difference.</li>
        </ul>
      </details>

      <Modal
        open={Boolean(recordTarget)}
        onClose={() => {
          setRecordTarget(null);
          setRecordError('');
        }}
        title="Record USD purchase"
        maxWidthClass="max-w-lg"
      >
        {recordTarget && (
          <div className="grid gap-3">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {monthLabel(recordTarget.month)} — {usd(recordTarget.usdCost)} owed to suppliers, {usd(recordTarget.remainingUsd)} still to buy.
            </p>
            {recordTarget.lines?.length > 0 && (
              <ul className="max-h-32 overflow-y-auto rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-800">
                {recordTarget.lines.map((l) => (
                  <li key={l.name} className="flex justify-between gap-3 py-0.5 text-slate-600 dark:text-slate-300">
                    <span className="truncate">
                      {l.quantity} × {l.name}
                    </span>
                    <span className="shrink-0">{usd(l.usdCost)}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">USD to buy now</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={recordUsd}
                  onChange={(e) => setRecordUsd(e.target.value)}
                  className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Rate (MVR per USD)</span>
                <input
                  type="number"
                  min="0"
                  step="0.0001"
                  autoFocus
                  value={recordRate}
                  onChange={(e) => setRecordRate(e.target.value)}
                  placeholder="e.g. 15.4"
                  className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                />
              </label>
            </div>
            <label className="block">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Date of purchase</span>
              <input
                type="date"
                value={recordDate}
                onChange={(e) => setRecordDate(e.target.value)}
                className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              />
            </label>
            <div className="grid gap-1 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800">
              <div className="flex justify-between font-semibold text-slate-900 dark:text-white">
                <span>Expense to record ({symbol})</span>
                <span>
                  {symbol}
                  {((Number(recordRate) || 0) * (Number(recordUsd) || 0)).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>Left to buy after this</span>
                <span>{usd(Math.max(recordTarget.remainingUsd - (Number(recordUsd) || 0), 0))}</span>
              </div>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              This creates a "currency exchange" expense on the Expenses page, dated the purchase date. Deleting that expense
              puts the amount back under "still to buy".
            </p>

            {recordError && <p className="text-sm text-red-600 dark:text-red-400">{recordError}</p>}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleRecord}
                disabled={recording}
                className="min-h-11 rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-700 dark:bg-lagoon-600 dark:hover:bg-lagoon-500 disabled:opacity-60"
              >
                {recording ? 'Recording…' : 'Record purchase'}
              </button>
              <button
                type="button"
                onClick={() => setRecordTarget(null)}
                className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </Modal>

      <div className="mt-6 rounded-3xl bg-white dark:border shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">By month</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Trailing 12 months, oldest first. Tap a month to see what it's made of.</p>
        </div>
        <div className="hidden overflow-x-auto sm:block">
          <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
            <thead>
              <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                <th className="px-5 py-3">Month</th>
                <th className="px-4 py-3 text-right">Owed</th>
                <th className="px-4 py-3 text-right">Recorded</th>
                <th className="px-4 py-3 text-right">To buy</th>
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
                        <MonthActions m={m} onRecord={openRecord} onSettle={handleSettle} onUnsettle={handleUnsettle} />
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
                <dt className="text-slate-500 dark:text-slate-400">Recorded</dt>
                <dd className="text-slate-900 dark:text-white">{usd(m.recordedUsd + m.settledUsd)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Still to buy</dt>
                <dd className="font-medium text-slate-900 dark:text-white">{usd(m.remainingUsd)}</dd>
              </div>
              {m.lines.length > 0 && <LinesList lines={m.lines} />}
              {canManage && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <MonthActions m={m} onRecord={openRecord} onSettle={handleSettle} onUnsettle={handleUnsettle} />
                </div>
              )}
            </MobileListAccordion>
          ))}
        </div>
      </div>

      <div className="mt-6 rounded-3xl bg-white dark:border shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Year by year</h2>
        </div>
        <div className="hidden overflow-x-auto sm:block">
          <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
            <thead>
              <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                <th className="px-5 py-3">Year</th>
                <th className="px-4 py-3 text-right">Line items</th>
                <th className="px-5 py-3 text-right">USD owed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.byYear.map((y) => (
                <tr key={y.year}>
                  <td className="px-5 py-3 font-medium text-slate-900 dark:text-white">{y.year}</td>
                  <td className="px-4 py-3 text-right dark:text-white">{y.itemCount}</td>
                  <td className="px-5 py-3 text-right font-medium dark:text-white">${y.usdCost.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-2.5 p-4 sm:hidden">
          {data.byYear.map((y) => (
            <MobileListAccordion
              key={y.year}
              name="supplier-cost-years"
              summary={
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-slate-900 dark:text-white">{y.year}</span>
                  <span className="text-slate-500 dark:text-slate-400">${y.usdCost.toFixed(2)}</span>
                </div>
              }
            >
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Line items</dt>
                <dd className="text-slate-900 dark:text-white">{y.itemCount}</dd>
              </div>
            </MobileListAccordion>
          ))}
        </div>
      </div>
    </div>
  );
}
