import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { money } from '../../lib/money';
import RevenueTrendChart from '../../components/RevenueTrendChart';
import { Card, Pill, Empty, full, usd, useLoader, useSymbol } from './ui';

// Overview: the profit-and-loss in statement form, the bank and USD
// positions, what needs attention, and the 30/60/90-day cash forecast.
// Everything here comes from existing endpoints; the numbers are the
// backend's own, nothing is recomputed in the browser.

function Stat({ label, value, sub, tone, hero }) {
  return (
    <div className={`min-w-0 rounded-3xl p-4 ${hero ? 'col-span-2 bg-slate-900 text-white lg:col-span-1 dark:bg-lagoon-700' : 'bg-white dark:border dark:border-slate-700 dark:bg-slate-900'}`}>
      <p className={`text-[11px] font-bold uppercase tracking-wide ${hero ? 'opacity-70' : 'text-slate-500 dark:text-slate-400'}`}>{label}</p>
      <p className={`mt-1 truncate font-display font-extrabold tabular-nums ${hero ? 'text-3xl' : 'text-xl'} ${tone === 'neg' ? 'text-red-600 dark:text-red-400' : hero ? '' : 'text-slate-900 dark:text-white'}`}>{value}</p>
      {sub && <p className={`mt-0.5 text-xs ${hero ? 'opacity-70' : 'text-slate-500 dark:text-slate-400'}`}>{sub}</p>}
    </div>
  );
}

function Line({ label, value, strong, indent, onClick, tone }) {
  const body = (
    <>
      <span className={indent ? 'pl-3 text-slate-500 dark:text-slate-400' : ''}>{label}</span>
      <span className={`tabular-nums ${tone === 'neg' ? 'text-red-600 dark:text-red-400' : tone === 'pos' ? 'text-emerald-700 dark:text-emerald-400' : ''}`}>{value}</span>
    </>
  );
  const cls = `flex w-full justify-between gap-3 border-b py-2.5 text-left text-sm ${strong ? 'border-slate-900 font-bold dark:border-slate-300' : 'border-slate-100 dark:border-slate-800'} text-slate-900 dark:text-white`;
  return onClick ? <button type="button" onClick={onClick} className={`${cls} hover:text-lagoon-700`}>{body}</button> : <div className={cls}>{body}</div>;
}

export default function OverviewTab({ token, can, range, periodLabel, goTab }) {
  const symbol = useSymbol(token);
  const { data: s, error } = useLoader(() => api.financials.summary(token, range), [token, range.from, range.to]);
  const { data: fc } = useLoader(() => api.financials.cashForecast(token).catch(() => null), [token]);
  const { data: sup } = useLoader(() => api.supplierCosts.report(token).catch(() => null), [token]);

  if (error) return <p className="text-red-600 dark:text-red-400">{error}</p>;
  if (!s) return <p className="py-8 text-slate-500">Loading…</p>;

  const gross = s.cashRevenue - s.supplierCosts;
  const margin = s.cashRevenue > 0 ? Math.round((s.netProfit / s.cashRevenue) * 100) : null;
  const m = (v) => money(symbol, v);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat hero label={`Net profit · ${periodLabel}`} value={m(s.netProfit)} sub={margin === null ? 'No revenue yet' : `${margin}% margin`} tone={s.netProfit < 0 ? 'neg' : undefined} />
        <Stat label="Revenue" value={m(s.cashRevenue)} sub="Cash received" />
        <Stat label="Expenses" value={m(s.totalExpenses + s.supplierCosts)} sub="Costs + operating" />
        <Stat label="Bank" value={m(s.bankBalance)} sub={`As of ${s.bankBalanceAsOf}`} tone={s.bankBalance < 0 ? 'neg' : undefined} />
        <Stat label="USD account" value={usd(s.usdBalance)} sub={s.usdAvgRate ? `Avg cost ${s.usdAvgRate.toFixed(2)}` : 'No USD yet'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card title="Profit and loss">
            <Line label="Revenue (cash received)" value={full(symbol, s.cashRevenue)} onClick={can('financials', 'view') ? () => goTab('income') : undefined} />
            <Line indent label="− Supplier costs" value={full(symbol, -s.supplierCosts)} onClick={() => goTab('cash')} />
            <Line strong label="Gross profit" value={full(symbol, gross)} />
            <Line indent label="− Operating expenses" value={full(symbol, -s.totalExpenses)} onClick={() => goTab('expenses')} />
            {Math.abs(s.fxResult) > 0.004 && <Line indent label="± Currency gain / loss" value={full(symbol, s.fxResult)} onClick={() => goTab('cash')} />}
            <Line strong label="Net profit" value={full(symbol, s.netProfit)} tone={s.netProfit < 0 ? 'neg' : 'pos'} />
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Tap a line to open the tab behind it. Owner draws, contributions and profit payouts are not part of profit; they move the bank balance only.</p>
          </Card>
          <Card title="Last 6 months">
            <RevenueTrendChart data={s.monthlyTrend} currencySymbol={symbol} />
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Card title="Needs attention">
            {s.overdueCount === 0 && !(sup && (sup.shortfallUsd > 0 || sup.toPayUsd > 0)) && <Empty>Nothing needs attention.</Empty>}
            {s.overdueCount > 0 && (
              <button type="button" onClick={() => goTab('income')} className="flex w-full items-start gap-3 border-b border-slate-100 py-2.5 text-left dark:border-slate-800">
                <Pill tone="neg">Overdue</Pill>
                <span className="text-sm text-slate-900 dark:text-white">{s.overdueCount} invoice{s.overdueCount === 1 ? '' : 's'} · {full(symbol, s.overdueAmount)}</span>
              </button>
            )}
            {sup && sup.toPayUsd > 0 && (
              <button type="button" onClick={() => goTab('cash')} className="flex w-full items-start gap-3 border-b border-slate-100 py-2.5 text-left last:border-0 dark:border-slate-800">
                <Pill tone="warn">Suppliers</Pill>
                <span className="text-sm text-slate-900 dark:text-white">
                  {usd(sup.toPayUsd)} owed{sup.overdueUsd > 0 ? `, ${usd(sup.overdueUsd)} overdue` : ''}
                  {sup.shortfallUsd > 0 && <span className="block text-slate-500 dark:text-slate-400">Buy {usd(sup.shortfallUsd)} more to cover it{sup.shortfallMvr ? ` (about ${full(symbol, sup.shortfallMvr)})` : ''}.</span>}
                </span>
              </button>
            )}
            {sup && sup.awaitingUsd > 0 && (
              <button type="button" onClick={() => goTab('cash')} className="flex w-full items-start gap-3 py-2.5 text-left">
                <Pill tone="neu">To bill</Pill>
                <span className="text-sm text-slate-900 dark:text-white">{sup.awaiting.length} sale{sup.awaiting.length === 1 ? '' : 's'} waiting for a supplier invoice (~{usd(sup.awaitingUsd)})</span>
              </button>
            )}
          </Card>

          {fc && (
            <Card title="Cash forecast">
              <div className="grid grid-cols-3 gap-2">
                {fc.buckets.map((b) => (
                  <div key={b.days} className="rounded-2xl bg-slate-50 p-2.5 dark:bg-slate-800/60">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{b.days} days</p>
                    <p className={`mt-0.5 truncate font-display text-base font-extrabold tabular-nums ${b.projectedBalance < 0 ? 'text-red-600' : 'text-slate-900 dark:text-white'}`}>{m(b.projectedBalance)}</p>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                Starts from today’s bank balance. {fc.overdue.count > 0 ? `${fc.overdue.count} overdue invoice(s) (${full(symbol, fc.overdue.amount)}) are not counted. ` : ''}Owner draws and profit payouts are not forecast.
              </p>
            </Card>
          )}
          <p className="text-center text-xs text-slate-500 dark:text-slate-400">
            Full invoice list: <Link className="underline" to="/invoices">Invoices</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
