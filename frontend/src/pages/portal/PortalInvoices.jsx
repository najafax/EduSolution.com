import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { usePortalAuth } from '../../context/PortalAuthContext';
import { startOfMonthStr, todayStr } from '../../lib/date';
import StatusBadge from '../../components/StatusBadge';
import EmptyState from '../../components/EmptyState';
import SearchInput from '../../components/SearchInput';
import { InvoiceIcon, DownloadIcon } from '../../components/icons';

export default function PortalInvoices() {
  const { token, settings } = usePortalAuth();
  const [invoices, setInvoices] = useState(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [showStatement, setShowStatement] = useState(false);
  const [statementRange, setStatementRange] = useState({ from: startOfMonthStr(), to: todayStr() });
  const [statementBusy, setStatementBusy] = useState(false);
  const symbol = settings?.currency_symbol || '$';

  useEffect(() => {
    api.portal.invoices
      .list(token)
      .then(({ invoices }) => setInvoices(invoices))
      .catch((err) => setError(err.message));
  }, [token]);

  // Client-side only — see PortalLicenses.jsx's own note on why this list
  // doesn't need a server-side search param.
  const filtered = invoices?.filter((i) => i.number.toLowerCase().includes(search.trim().toLowerCase())) ?? [];

  async function handleDownloadStatement() {
    setError('');
    setStatementBusy(true);
    try {
      await api.portal.openStatementPdf(statementRange.from, statementRange.to, token);
    } catch (err) {
      setError(err.message);
    } finally {
      setStatementBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Invoices</h1>
        <button
          onClick={() => setShowStatement((v) => !v)}
          className="flex min-h-11 items-center gap-1.5 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <DownloadIcon width={16} height={16} />
          Download statement
        </button>
      </div>

      {/* A consolidated statement of account for bookkeeping, distinct
          from a single receipt (already downloadable from PortalInvoiceDetail.jsx)
          — a date range plus one PDF covering every invoice issued in it. */}
      {showStatement && (
        <div className="mt-3 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">From</span>
            <div className="mt-1 flex h-11 items-center overflow-hidden rounded-md border border-slate-300 px-3 focus-within:border-lagoon-500 dark:border-slate-600">
              <input
                type="date"
                value={statementRange.from}
                onChange={(e) => setStatementRange((r) => ({ ...r, from: e.target.value }))}
                className="h-full appearance-none border-0 bg-transparent p-0 text-base focus:outline-none dark:text-white"
              />
            </div>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">To</span>
            <div className="mt-1 flex h-11 items-center overflow-hidden rounded-md border border-slate-300 px-3 focus-within:border-lagoon-500 dark:border-slate-600">
              <input
                type="date"
                value={statementRange.to}
                onChange={(e) => setStatementRange((r) => ({ ...r, to: e.target.value }))}
                className="h-full appearance-none border-0 bg-transparent p-0 text-base focus:outline-none dark:text-white"
              />
            </div>
          </label>
          <button
            onClick={handleDownloadStatement}
            disabled={statementBusy}
            className="min-h-11 rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500 disabled:opacity-60"
          >
            {statementBusy ? 'Preparing…' : 'Download PDF'}
          </button>
        </div>
      )}

      {invoices && invoices.length > 0 && (
        <div className="mt-4 max-w-sm">
          <SearchInput value={search} onChange={setSearch} placeholder="Search invoices…" />
        </div>
      )}

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {!invoices ? (
        <p className="mt-10 text-center text-sm text-slate-500 dark:text-slate-400">Loading…</p>
      ) : invoices.length === 0 ? (
        <div className="mt-6 rounded-lg border border-slate-200 dark:border-slate-700">
          <EmptyState icon={<InvoiceIcon />} title="No invoices yet." message="Any invoices billed to you will show up here." />
        </div>
      ) : filtered.length === 0 ? (
        <p className="mt-10 text-center text-sm text-slate-500 dark:text-slate-400">No invoices match "{search}".</p>
      ) : (
        <div className="mt-6 flex flex-col gap-2.5">
          {filtered.map((invoice) => (
            <Link
              key={invoice.id}
              to={`/portal/invoices/${invoice.id}`}
              className={`flex items-center justify-between gap-3 rounded-2xl border bg-white p-4 shadow-sm transition hover:shadow-md dark:bg-slate-900 ${
                invoice.is_overdue ? 'border-red-200 dark:border-red-900' : 'border-slate-200 hover:border-lagoon-300 dark:border-slate-700'
              }`}
            >
              <div className="min-w-0">
                <p className="font-medium text-slate-900 dark:text-white">{invoice.number}</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Due {invoice.due_date}
                  {invoice.is_overdue && <span className="ml-1 font-medium text-red-600 dark:text-red-400">· Overdue</span>}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <div className="text-right">
                  <p className="font-semibold text-slate-900 dark:text-white">
                    {symbol}
                    {invoice.balance_due.toFixed(2)}
                  </p>
                  {invoice.balance_due > 0 && invoice.balance_due < invoice.total && (
                    <p className="text-xs text-slate-500 dark:text-slate-400">balance due</p>
                  )}
                </div>
                <StatusBadge status={invoice.is_overdue ? 'overdue' : invoice.status} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
