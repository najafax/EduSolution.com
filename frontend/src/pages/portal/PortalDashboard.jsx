import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { usePortalAuth } from '../../context/PortalAuthContext';
import KpiCard from '../../components/KpiCard';
import { QuoteIcon, InvoiceIcon, LicenseIcon, TrendUpIcon } from '../../components/icons';

const SHORTCUTS = [
  { to: '/portal/quotes', label: 'Quotes', message: 'View and respond to quotes.', icon: QuoteIcon },
  { to: '/portal/invoices', label: 'Invoices', message: 'View invoices and download receipts.', icon: InvoiceIcon },
  { to: '/portal/licenses', label: 'Licenses', message: 'Check what’s active or expiring soon.', icon: LicenseIcon },
];

// One icon per activity type, from routes/clientPortal.js's own GET
// /activity — keyed by that route's `type` field so a future type just
// needs an entry added here, same "one shared icon map" convention
// components/NotificationCenter.jsx already establishes for its own
// per-category icons.
const ACTIVITY_ICONS = {
  quote_sent: QuoteIcon,
  quote_response: QuoteIcon,
  invoice_issued: InvoiceIcon,
  payment: TrendUpIcon,
  license_renewed: LicenseIcon,
};

export default function PortalDashboard() {
  const { account, settings, token } = usePortalAuth();
  const [quotes, setQuotes] = useState(null);
  const [invoices, setInvoices] = useState(null);
  const [licenses, setLicenses] = useState(null);
  const [activity, setActivity] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.portal.quotes.list(token), api.portal.invoices.list(token), api.portal.licenses.list(token)])
      .then(([q, i, l]) => {
        setQuotes(q.quotes);
        setInvoices(i.invoices);
        setLicenses(l.licenses);
      })
      .catch((err) => setError(err.message));
    // Independent, best-effort fetch — a failed activity feed shouldn't
    // block the KPI strip/shortcut tiles above from rendering, same
    // reasoning Dashboard.jsx's own "Needs attention" panel fetches are
    // kept separate from its main financials-summary call.
    api.portal
      .activity(token)
      .then(({ activity }) => setActivity(activity))
      .catch(() => setActivity([]));
  }, [token]);

  const symbol = settings?.currency_symbol || '$';
  const loaded = quotes && invoices && licenses;
  const pendingQuotes = quotes?.filter((q) => q.status === 'sent').length ?? 0;
  const outstandingInvoices = invoices?.filter((i) => i.status !== 'void' && i.balance_due > 0) ?? [];
  const outstandingTotal = outstandingInvoices.reduce((sum, i) => sum + i.balance_due, 0);
  const activeLicenses = licenses?.filter((l) => l.display_status === 'active' || l.display_status === 'expiring_soon').length ?? 0;

  return (
    <div className="px-4 py-10 sm:px-6">
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

      {/* A chronological "what's happened" feed — synthesized server-side
          from the same quotes/invoices/payments/licenses tables the three
          KPI cards above already read, not activity_log (see
          routes/clientPortal.js's GET /activity for why). Renders nothing
          at all once loaded-and-empty, same "only show the exception case"
          convention this app already follows elsewhere — a brand-new
          client with no history yet doesn't need an empty panel telling
          them so. */}
      {activity && activity.length > 0 && (
        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <h2 className="font-semibold text-slate-900 dark:text-white">Recent activity</h2>
          <div className="mt-3 flex flex-col divide-y divide-slate-100 dark:divide-slate-800">
            {activity.map((item, index) => {
              const Icon = ACTIVITY_ICONS[item.type] || QuoteIcon;
              return (
                <Link
                  key={`${item.type}-${index}`}
                  to={item.link}
                  className="flex items-center gap-3 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-lagoon-50 text-lagoon-600 dark:bg-lagoon-950 dark:text-lagoon-400">
                    <Icon width={15} height={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-slate-900 dark:text-white">{item.label}</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">{item.date}</span>
                  </span>
                  {item.amount !== null && (
                    <span className="shrink-0 font-medium text-slate-900 dark:text-white">
                      {symbol}
                      {item.amount.toFixed(2)}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
