import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import Modal from '../../components/Modal';
import KpiCard from '../../components/KpiCard';
import MobileListAccordion from '../../components/MobileListAccordion';
import { TrendDownIcon, TrendUpIcon, BankIcon, AlertTriangleIcon, RefreshIcon } from '../../components/icons';

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
    setRecordRate('');
    setRecordError('');
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
      const { costMvr, monthLabel: label } = await api.supplierCosts.record({ month: recordTarget.month, exchange_rate: rateNum }, token);
      toast(`Recorded ${symbol}${costMvr.toFixed(2)} as a currency exchange expense for ${label}.`, { type: 'success' });
      setRecordTarget(null);
    } catch (err) {
      setRecordError(err.message);
    } finally {
      setRecording(false);
    }
  }

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Supplier Costs</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Automatically calculated from what's actually been sold — every invoice line item's quantity × its
          product's own cost price (USD), rolled up by month and year. Not a manual entry tool: to actually record a
          currency exchange purchase against a figure below, use "Record as expense" (or the Expenses page directly).
        </p>
      </div>

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          icon={<TrendDownIcon />}
          label="This month"
          value={`$${currentMonth.usdCost.toFixed(2)}`}
          sub={monthLabel(currentMonth.month)}
          tone={currentMonth.usdCost > 0 ? 'warning' : 'neutral'}
        />
        <KpiCard icon={<TrendUpIcon />} label="This year" value={`$${(currentYear?.usdCost ?? 0).toFixed(2)}`} tone="neutral" />
        <KpiCard icon={<BankIcon />} label="All-time" value={`$${data.totals.usdCost.toFixed(2)}`} tone="neutral" />
        <KpiCard
          icon={<AlertTriangleIcon />}
          label="Unmatched line items"
          value={data.totals.unmatchedItemCount}
          sub="no product / cost price on file"
          tone={data.totals.unmatchedItemCount > 0 ? 'warning' : 'positive'}
        />
      </div>

      <Modal
        open={Boolean(recordTarget)}
        onClose={() => {
          setRecordTarget(null);
          setRecordError('');
        }}
        title="Record as expense"
        maxWidthClass="max-w-lg"
      >
        {recordTarget && (
          <div className="grid gap-3">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {monthLabel(recordTarget.month)} — ${recordTarget.usdCost.toFixed(2)} USD owed to suppliers, from{' '}
              {recordTarget.itemCount} sold line item{recordTarget.itemCount === 1 ? '' : 's'}.
            </p>
            <label className="block">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Exchange rate (MVR per USD)</span>
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
            <div className="grid gap-1 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800">
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>Cost (USD)</span>
                <span>${recordTarget.usdCost.toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-semibold text-slate-900 dark:text-white">
                <span>Expense to record ({symbol})</span>
                <span>
                  {symbol}
                  {((Number(recordRate) || 0) * recordTarget.usdCost).toFixed(2)}
                </span>
              </div>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              This creates a real "currency exchange" expense on the Expenses page — the same category any manual
              exchange record already uses.
            </p>

            {recordError && <p className="text-sm text-red-600 dark:text-red-400">{recordError}</p>}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleRecord}
                disabled={recording}
                className="min-h-11 rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500 disabled:opacity-60"
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

      <div className="mt-6 rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">By month</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Trailing 12 months, oldest first.</p>
        </div>
        <div className="hidden overflow-x-auto sm:block">
          <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
            <thead>
              <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                <th className="px-5 py-3">Month</th>
                <th className="px-4 py-3 text-right">Line items</th>
                <th className="px-4 py-3 text-right">Unmatched</th>
                <th className="px-4 py-3 text-right">USD owed</th>
                {canManage && <th className="px-5 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.byMonth.map((m) => (
                <tr key={m.month}>
                  <td className="px-5 py-3 font-medium text-slate-900 dark:text-white">{monthLabel(m.month)}</td>
                  <td className="px-4 py-3 text-right dark:text-white">{m.itemCount}</td>
                  <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-400">{m.unmatchedItemCount || '—'}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-medium dark:text-white">${m.usdCost.toFixed(2)}</td>
                  {canManage && (
                    <td className="whitespace-nowrap px-5 py-3 text-right">
                      {m.usdCost > 0 && (
                        <button
                          onClick={() => openRecord(m)}
                          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          <RefreshIcon width={14} height={14} />
                          Record as expense
                        </button>
                      )}
                    </td>
                  )}
                </tr>
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
                  <span className="text-slate-500 dark:text-slate-400">${m.usdCost.toFixed(2)}</span>
                </div>
              }
            >
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Line items</dt>
                <dd className="text-slate-900 dark:text-white">{m.itemCount}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Unmatched</dt>
                <dd className="text-slate-900 dark:text-white">{m.unmatchedItemCount || '—'}</dd>
              </div>
              {canManage && m.usdCost > 0 && (
                <div className="pt-1">
                  <button
                    onClick={() => openRecord(m)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <RefreshIcon width={14} height={14} />
                    Record as expense
                  </button>
                </div>
              )}
            </MobileListAccordion>
          ))}
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Year by year</h2>
        </div>
        <div className="hidden overflow-x-auto sm:block">
          <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
            <thead>
              <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                <th className="px-5 py-3">Year</th>
                <th className="px-4 py-3 text-right">Line items</th>
                <th className="px-4 py-3 text-right">Unmatched</th>
                <th className="px-5 py-3 text-right">USD owed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.byYear.map((y) => (
                <tr key={y.year}>
                  <td className="px-5 py-3 font-medium text-slate-900 dark:text-white">{y.year}</td>
                  <td className="px-4 py-3 text-right dark:text-white">{y.itemCount}</td>
                  <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-400">{y.unmatchedItemCount || '—'}</td>
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
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Unmatched</dt>
                <dd className="text-slate-900 dark:text-white">{y.unmatchedItemCount || '—'}</dd>
              </div>
            </MobileListAccordion>
          ))}
        </div>
      </div>
    </div>
  );
}
