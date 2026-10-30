import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { api } from '../../lib/api';
import { todayStr } from '../../lib/date';
import { Btn } from './ui';
import OverviewTab from './OverviewTab';
import IncomeTab from './IncomeTab';
import ExpensesTab from './ExpensesTab';
import CashTab from './CashTab';
import EquityTab from './EquityTab';

// The one Finance page: Overview / Income / Expenses / Cash & USD / Equity.
// The period picker drives the Overview figures and the PDF reports; the
// other tabs show the live state of their own lists. "New entry" jumps to the
// right tab and opens its form (`entry` carries the request down).

const TABS = [
  { key: 'overview', label: 'Overview', module: 'financials', Comp: OverviewTab },
  { key: 'income', label: 'Income', module: 'financials', Comp: IncomeTab },
  { key: 'expenses', label: 'Expenses', module: 'expenses', Comp: ExpensesTab },
  { key: 'cash', label: 'Cash & USD', module: 'financials', Comp: CashTab },
  { key: 'equity', label: 'Equity', module: 'financials', Comp: EquityTab },
];

const ENTRIES = [
  ['payment', 'Payment received', 'Against an invoice', 'income', 'financials'],
  ['expense', 'Expense', 'Rent, salaries, software', 'expenses', 'expenses'],
  ['buy-usd', 'Buy USD', 'Move MVR into USD', 'cash', 'financials'],
  ['supplier-invoice', 'Supplier invoice', 'Record a bill to pay', 'cash', 'financials'],
  ['contribution', 'Owner contribution', 'Money put in', 'equity', 'financials'],
  ['draw', 'Owner draw', 'Money taken out', 'equity', 'financials'],
];

function periodRange(key) {
  const today = todayStr();
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const pad = (n) => String(n).padStart(2, '0');
  const lastDay = (yy, mm) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  if (key === 'year') return { from: `${y}-01-01`, to: today };
  if (key === 'lastyear') return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
  if (key === 'month') return { from: `${y}-${pad(m)}-01`, to: today };
  if (key === 'lastmonth') {
    const py = m === 1 ? y - 1 : y;
    const pm = m === 1 ? 12 : m - 1;
    return { from: `${py}-${pad(pm)}-01`, to: `${py}-${pad(pm)}-${lastDay(py, pm)}` };
  }
  return { from: '', to: '' };
}

const PERIODS = [
  ['year', 'This year'],
  ['lastyear', 'Last year'],
  ['month', 'This month'],
  ['lastmonth', 'Last month'],
  ['all', 'All time'],
];

export default function Finance() {
  const { token, can } = useAuth();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const tabs = TABS.filter((t) => can(t.module, 'view'));
  const tab = tabs.find((t) => t.key === params.get('tab')) || tabs[0];
  const [period, setPeriod] = useState('year');
  const range = useMemo(() => periodRange(period), [period]);
  const [entry, setEntry] = useState(null);
  // /finance?tab=expenses&new=expense (from the phone Create sheet) opens that form once.
  useEffect(() => {
    const wanted = params.get('new');
    if (!wanted) return;
    setEntry(wanted);
    const next = new URLSearchParams(params);
    next.delete('new');
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [sheet, setSheet] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef(null);

  useEffect(() => {
    if (!exportOpen) return undefined;
    const close = (e) => !exportRef.current?.contains(e.target) && setExportOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [exportOpen]);

  if (!tab) {
    return <div className="px-4 py-10 sm:px-6 lg:px-8"><p className="text-slate-600 dark:text-slate-300">You don’t have access to the Finance page.</p></div>;
  }

  const goTab = (key) => setParams({ tab: key }, { replace: true });
  const canExport = can('financials', 'view');
  const reportRange = { from: range.from || '2000-01-01', to: range.to || todayStr() };
  const REPORTS = [
    ['Sales report', api.reports.salesPdf],
    ['Tax report', api.reports.taxPdf],
    ['Profit and loss', api.reports.profitLossPdf],
    ['Expense report', api.reports.expensesPdf],
    ['Bank statement', api.reports.bankBalancePdf],
  ];

  async function openReport(fn) {
    setExportOpen(false);
    try {
      await fn(reportRange.from, reportRange.to, token);
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  }

  function startEntry([key, , , target]) {
    setSheet(false);
    setEntry(key);
    goTab(target);
  }

  const Comp = tab.Comp;
  const allowedEntries = ENTRIES.filter((e) => can(e[4], 'manage'));

  return (
    <div className="px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-extrabold text-slate-900 dark:text-white">Finance</h1>
        <div className="flex flex-wrap items-center gap-2">
          {canExport && (
            <select
              aria-label="Period"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="min-h-10 rounded-xl border-0 bg-white px-3 text-sm font-semibold dark:bg-slate-800 dark:text-white"
            >
              {PERIODS.map(([k, l]) => (
                <option key={k} value={k}>{l}</option>
              ))}
            </select>
          )}
          {canExport && (
            <div className="relative" ref={exportRef}>
              <Btn onClick={() => setExportOpen((v) => !v)} aria-haspopup="true" aria-expanded={exportOpen}>Reports ▾</Btn>
              {exportOpen && (
                <div className="absolute right-0 top-full z-20 mt-1.5 w-56 rounded-2xl bg-white p-1.5 shadow-xl dark:border dark:border-slate-700 dark:bg-slate-900">
                  {REPORTS.map(([label, fn]) => (
                    <button key={label} type="button" onClick={() => openReport(fn)} className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100 dark:text-white dark:hover:bg-slate-800">
                      {label} (PDF)
                    </button>
                  ))}
                  <p className="px-3 py-1.5 text-xs text-slate-500 dark:text-slate-400">Uses the period above.</p>
                </div>
              )}
            </div>
          )}
          {allowedEntries.length > 0 && (
            <Btn tone="primary" onClick={() => setSheet(true)} >+ New entry</Btn>
          )}
        </div>
      </div>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-1" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={t.key === tab.key}
            onClick={() => goTab(t.key)}
            className={`min-h-10 shrink-0 whitespace-nowrap rounded-full px-4 text-sm font-semibold ${
              t.key === tab.key ? 'bg-slate-900 text-white dark:bg-lagoon-600' : 'bg-white text-slate-600 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        <Comp token={token} can={can} range={range} periodLabel={PERIODS.find((p) => p[0] === period)[1]} entry={entry} clearEntry={() => setEntry(null)} goTab={goTab} />
      </div>


      {sheet && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 sm:items-center" onClick={() => setSheet(false)}>
          <div role="dialog" aria-label="New entry" onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-t-3xl bg-white p-5 sm:rounded-3xl dark:bg-slate-900">
            <h2 className="font-display text-lg font-extrabold text-slate-900 dark:text-white">What happened?</h2>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {allowedEntries.map((e) => (
                <button key={e[0]} type="button" onClick={() => startEntry(e)} className="rounded-2xl bg-slate-100 p-3 text-left dark:bg-slate-800">
                  <span className="block text-sm font-semibold text-slate-900 dark:text-white">{e[1]}</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">{e[2]}</span>
                </button>
              ))}
            </div>
            <Btn className="mt-3 w-full" onClick={() => setSheet(false)}>Cancel</Btn>
          </div>
        </div>
      )}
    </div>
  );
}
