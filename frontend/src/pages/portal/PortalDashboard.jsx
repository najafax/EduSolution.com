import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { usePortalAuth } from '../../context/PortalAuthContext';
import KpiCard from '../../components/KpiCard';
import { QuoteIcon, InvoiceIcon, LicenseIcon } from '../../components/icons';

const SHORTCUTS = [
  { to: '/portal/quotes', label: 'Quotes', message: 'View and respond to quotes.', icon: QuoteIcon },
  { to: '/portal/invoices', label: 'Invoices', message: 'View invoices and download receipts.', icon: InvoiceIcon },
  { to: '/portal/licenses', label: 'Licenses', message: 'Check what’s active or expiring soon.', icon: LicenseIcon },
];

export default function PortalDashboard() {
  const { account, settings, token } = usePortalAuth();
  const [quotes, setQuotes] = useState(null);
  const [invoices, setInvoices] = useState(null);
  const [licenses, setLicenses] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.portal.quotes.list(token), api.portal.invoices.list(token), api.portal.licenses.list(token)])
      .then(([q, i, l]) => {
        setQuotes(q.quotes);
        setInvoices(i.invoices);
        setLicenses(l.licenses);
      })
      .catch((err) => setError(err.message));
  }, [token]);

  const symbol = settings?.currency_symbol || '$';
  const loaded = quotes && invoices && licenses;
  const pendingQuotes = quotes?.filter((q) => q.status === 'sent').length ?? 0;
  const outstandingInvoices = invoices?.filter((i) => i.status !== 'void' && i.balance_due > 0) ?? [];
  const outstandingTotal = outstandingInvoices.reduce((sum, i) => sum + i.balance_due, 0);
  const activeLicenses = licenses?.filter((l) => l.display_status === 'active' || l.display_status === 'expiring_soon').length ?? 0;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-2xl font-extrabold text-slate-900 dark:text-white">Welcome, {account?.clientName}</h1>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        {settings?.business_name ? `Here's a quick look at your account with ${settings.business_name}.` : "Here's a quick look at your account."}
      </p>

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {loaded && (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <KpiCard
            icon={<QuoteIcon width={18} height={18} />}
            label="Awaiting your response"
            value={pendingQuotes}
            tone={pendingQuotes > 0 ? 'warning' : 'neutral'}
          />
          <KpiCard
            icon={<InvoiceIcon width={18} height={18} />}
            label="Outstanding balance"
            value={`${symbol}${outstandingTotal.toFixed(2)}`}
            sub={`${outstandingInvoices.length} invoice${outstandingInvoices.length === 1 ? '' : 's'}`}
            tone={outstandingInvoices.length > 0 ? 'negative' : 'neutral'}
            className="col-span-2 sm:col-span-1"
          />
          <KpiCard icon={<LicenseIcon width={18} height={18} />} label="Active licenses" value={activeLicenses} tone="positive" />
        </div>
      )}

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {SHORTCUTS.map(({ to, label, message, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-lagoon-300 hover:shadow-md dark:border-slate-700 dark:bg-slate-900"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-lagoon-50 text-lagoon-600 dark:bg-lagoon-950 dark:text-lagoon-400">
              <Icon width={18} height={18} />
            </span>
            <p className="mt-3 font-semibold text-slate-900 dark:text-white">{label}</p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{message}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
