import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { usePortalAuth } from '../../context/PortalAuthContext';
import StatusBadge from '../../components/StatusBadge';
import EmptyState from '../../components/EmptyState';
import SearchInput from '../../components/SearchInput';
import { InvoiceIcon } from '../../components/icons';

export default function PortalInvoices() {
  const { token, settings } = usePortalAuth();
  const [invoices, setInvoices] = useState(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
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

  return (
    <div className="px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Invoices</h1>

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
        <>
          <div className="mt-6 hidden overflow-x-auto rounded-lg border border-slate-200 bg-white sm:block dark:border-slate-700 dark:bg-slate-900">
            <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
              <thead>
                <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                  <th className="px-4 py-3">Number</th>
                  <th className="px-4 py-3">Due</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Balance due</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filtered.map((invoice) => (
                  <tr key={invoice.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                    <td className="whitespace-nowrap px-4 py-3">
                      <Link to={`/portal/invoices/${invoice.id}`} className="font-medium text-lagoon-600 hover:text-lagoon-500">
                        {invoice.number}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-400">
                      {invoice.due_date}
                      {invoice.is_overdue && <span className="ml-1 font-medium text-red-600 dark:text-red-400">· Overdue</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <StatusBadge status={invoice.is_overdue ? 'overdue' : invoice.status} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-slate-900 dark:text-white">
                      {symbol}
                      {invoice.balance_due.toFixed(2)}
                      {invoice.balance_due > 0 && invoice.balance_due < invoice.total && (
                        <span className="ml-1 text-xs font-normal text-slate-500 dark:text-slate-400">of {symbol}{invoice.total.toFixed(2)}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-6 flex flex-col gap-2.5 sm:hidden">
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
        </>
      )}
    </div>
  );
}
