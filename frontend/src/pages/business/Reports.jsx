import { useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { todayStr, startOfMonthStr } from '../../lib/date';
import { ReportIcon } from '../../components/icons';

// Each card's `run` receives (from, to, token) and returns the api.reports.*
// promise — same shape as api.invoices.openPdf/api.quotes.openPdf elsewhere,
// so the download itself is just "open the generated PDF in a new tab",
// nothing to store or link to afterward.
const REPORT_TYPES = [
  {
    key: 'sales',
    label: 'Sales report',
    description: 'Every invoice issued in the period — client, date, total, amount collected, and balance still owed.',
    run: api.reports.salesPdf,
  },
  {
    key: 'tax',
    label: 'Tax report',
    description: 'Taxable amount and tax collected per invoice issued in the period, with a grand total for filing.',
    run: api.reports.taxPdf,
  },
  {
    key: 'profit-loss',
    label: 'Profit & loss',
    description: 'Revenue (payments received) against expenses by category for the period, with the net profit or loss.',
    run: api.reports.profitLossPdf,
  },
  {
    key: 'expenses',
    label: 'Expense report',
    description: 'Every expense recorded in the period, grouped by category with subtotals and a grand total.',
    run: api.reports.expensesPdf,
  },
];

// Quick-pick buttons — each returns a { from, to } pair. Kept as plain
// functions (not precomputed values) so "This month"/"This year" are
// always relative to today, not to whenever the page first loaded.
const PRESETS = [
  { label: 'This month', range: () => ({ from: startOfMonthStr(), to: todayStr() }) },
  {
    label: 'Last month',
    range: () => {
      const d = new Date();
      const lastMonthEnd = new Date(d.getFullYear(), d.getMonth(), 0);
      const lastMonthStart = new Date(d.getFullYear(), d.getMonth() - 1, 1);
      const fmt = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
      return { from: fmt(lastMonthStart), to: fmt(lastMonthEnd) };
    },
  },
  {
    label: 'This year',
    range: () => {
      const d = new Date();
      return { from: `${d.getFullYear()}-01-01`, to: todayStr() };
    },
  },
];

export default function Reports() {
  const { token, can } = useAuth();
  const [from, setFrom] = useState(startOfMonthStr());
  const [to, setTo] = useState(todayStr());
  const [busyKey, setBusyKey] = useState('');
  const [error, setError] = useState('');

  if (!can('financials', 'view')) {
    return <div className="px-4 py-10 text-sm text-slate-500 dark:text-slate-400 sm:px-6 lg:px-8">You are not authorized to view this page.</div>;
  }

  const rangeInvalid = from && to && from > to;

  async function handleDownload(report) {
    if (rangeInvalid || !from || !to) {
      setError('Pick a valid date range before downloading.');
      return;
    }
    setError('');
    setBusyKey(report.key);
    try {
      await report.run(from, to, token);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyKey('');
    }
  }

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Reports</h1>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        Download a PDF report for any date range — sales, tax, profit &amp; loss, and expenses.
      </p>

      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-wrap items-end gap-4">
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">From</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="mt-1 min-h-11 rounded-md border border-slate-300 px-3 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">To</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="mt-1 min-h-11 rounded-md border border-slate-300 px-3 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => {
                  const range = preset.range();
                  setFrom(range.from);
                  setTo(range.to);
                }}
                className="min-h-9 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
        {rangeInvalid && <p className="mt-3 text-sm text-red-600 dark:text-red-400">"From" must not be after "To".</p>}
      </div>

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {REPORT_TYPES.map((report) => (
          <div key={report.key} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-lagoon-50 text-lagoon-600 dark:bg-lagoon-950 dark:text-lagoon-400">
                <ReportIcon />
              </span>
              <div>
                <h2 className="font-semibold text-slate-900 dark:text-white">{report.label}</h2>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{report.description}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleDownload(report)}
              disabled={busyKey === report.key}
              className="mt-4 min-h-11 w-full rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500 disabled:opacity-60"
            >
              {busyKey === report.key ? 'Generating…' : 'Download PDF'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
