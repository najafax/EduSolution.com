import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { usePortalAuth } from '../../context/PortalAuthContext';
import StatusBadge from '../../components/StatusBadge';
import EmptyState from '../../components/EmptyState';
import { InvoiceIcon } from '../../components/icons';

export default function PortalInvoices() {
  const { token, settings } = usePortalAuth();
  const [invoices, setInvoices] = useState(null);
  const [error, setError] = useState('');
  const symbol = settings?.currency_symbol || '$';

  useEffect(() => {
    api.portal.invoices
      .list(token)
      .then(({ invoices }) => setInvoices(invoices))
      .catch((err) => setError(err.message));
  }, [token]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Invoices</h1>

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {!invoices ? (
        <p className="mt-10 text-center text-sm text-slate-500 dark:text-slate-400">Loading…</p>
      ) : invoices.length === 0 ? (
        <div className="mt-6 rounded-lg border border-slate-200 dark:border-slate-700">
          <EmptyState icon={<InvoiceIcon />} title="No invoices yet." message="Any invoices billed to you will show up here." />
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-2.5">
          {invoices.map((invoice) => (
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
