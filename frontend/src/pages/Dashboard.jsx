import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import RevenueTrendChart from '../components/RevenueTrendChart';
import StatusDonutChart from '../components/StatusDonutChart';
import BalanceHero from '../components/BalanceHero';
import StatBars from '../components/StatBars';
import AttentionCarousel from '../components/AttentionCarousel';
import KpiCard from '../components/KpiCard';
import DashboardRail from '../components/DashboardRail';
import Accordion from '../components/Accordion';
import {
  AlertTriangleIcon,
  LicenseIcon,
  BankIcon,
  CheckCircleIcon,
  UsersIcon,
  ProductIcon,
  QuoteIcon,
  InvoiceIcon,
  RefreshIcon,
  ExpenseIcon,
  SettingsIcon,
} from '../components/icons';
import { money } from '../lib/money';

// The current calendar year — used only for the "This year at a glance
// (2026)" section title below. The actual current-year figures themselves
// come from GET /api/dashboard/overview's own yearOverview section (see
// that route for why this no longer needs a byYear array to pick a row
// out of on the frontend).
const CURRENT_YEAR = new Date().getFullYear();

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

const SHORTCUTS = [
  { to: '/clients', label: 'Clients', module: 'clients', icon: UsersIcon },
  { to: '/products', label: 'Products', module: 'products', icon: ProductIcon },
  { to: '/quotes', label: 'Quotes', module: 'quotes', icon: QuoteIcon },
  { to: '/invoices', label: 'Invoices', module: 'invoices', icon: InvoiceIcon },
  { to: '/recurring-invoices', label: 'Recurring', module: 'recurring_invoices', icon: RefreshIcon },
  { to: '/licenses', label: 'Licenses', module: 'licenses', icon: LicenseIcon },
  { to: '/expenses', label: 'Expenses', module: 'expenses', icon: ExpenseIcon },
  { to: '/financials', label: 'Financials', module: 'financials', icon: BankIcon },
  { to: '/settings', label: 'Settings', module: 'settings', icon: SettingsIcon },
];

// How many shortcuts fit comfortably in the right rail's narrow column.
const RAIL_SHORTCUT_LIMIT = 6;

export default function Dashboard() {
  const { user, token, can } = useAuth();
  const [summary, setSummary] = useState(null);
  const [settings, setSettings] = useState(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [error, setError] = useState('');
  const [overdueInvoices, setOverdueInvoices] = useState([]);
  const [expiringLicenses, setExpiringLicenses] = useState([]);
  const [quoteAnalytics, setQuoteAnalytics] = useState(null);
  const [invoiceAnalytics, setInvoiceAnalytics] = useState(null);
  const [licenseAnalytics, setLicenseAnalytics] = useState(null);
  const [expenseAnalytics, setExpenseAnalytics] = useState(null);

  const canViewFinancials = can('financials', 'view');
  const canViewQuotes = can('quotes', 'view');
  const canViewInvoices = can('invoices', 'view');
  const canViewLicenses = can('licenses', 'view');
  const canViewExpenses = can('expenses', 'view');
  const canSeeAttentionPanel = canViewFinancials && (canViewInvoices || canViewLicenses);
  const canSeeYearOverview = canViewQuotes || canViewInvoices || canViewLicenses || canViewExpenses;

  // One combined fetch (GET /api/dashboard/overview) replaces what used to
  // be up to 8 separate requests fired in parallel on every page load —
  // financials summary, settings, two "needs attention" list fetches, and
  // four per-module analytics calls. better-sqlite3 is synchronous, so
  // those 8 requests never actually ran in parallel on the backend anyway;
  // this collapses them into one request handled by one blocking pass
  // through the DB, not just fewer round-trips. Each section of the
  // response is independently permission-gated server-side (see
  // routes/dashboard.js), coming back `null`/`[]` for a grant the caller
  // doesn't hold rather than 403ing the whole request — so a
  // partial-access staff user still gets exactly the sections they can see.
  useEffect(() => {
    api.dashboard
      .overview(token)
      .then((data) => {
        if (data.financials) setSummary(data.financials);
        if (data.settings) setSettings(data.settings);
        setOverdueInvoices(data.overdueInvoices || []);
        setExpiringLicenses(data.expiringLicenses || []);
        setQuoteAnalytics(data.yearOverview?.quotes || null);
        setInvoiceAnalytics(data.yearOverview?.invoices || null);
        setLicenseAnalytics(data.yearOverview?.licenses || null);
        setExpenseAnalytics(data.yearOverview?.expenses || null);
      })
      .catch((err) => setError(err.message))
      // Flips whether the fetch succeeds or fails — the render below waits
      // on this alongside `summary` so the hero/KPI figures never paint
      // with the '$' fallback symbol for one frame before snapping to the
      // real currency symbol once this resolves.
      .finally(() => setSettingsLoaded(true));
  }, [token]);

  const symbol = settings?.currency_symbol || '$';
  const permittedShortcuts = SHORTCUTS.filter((s) => can(s.module, 'view'));

  const firstName = user?.name?.split(' ')[0];

  // A single, unified "needs attention" list — overdue invoices first
  // (already sorted oldest-due-first), then expiring licenses (already
  // sorted soonest-first) — shared by both renderings of this data: the
  // full-detail Accordion shown below `xl:` (no rail there) and the
  // compact DashboardRail list shown at `xl:` and up.
  const attentionItems = [
    ...overdueInvoices.map((inv) => ({
      key: `inv-${inv.id}`,
      to: `/invoices/${inv.id}`,
      icon: AlertTriangleIcon,
      tone: 'red',
      title: inv.client_name,
      subtitle: `${inv.number} · ${money(symbol, inv.balance_due)} overdue`,
    })),
    ...expiringLicenses.map((lic) => ({
      key: `lic-${lic.id}`,
      to: '/licenses',
      icon: LicenseIcon,
      tone: 'amber',
      title: `${lic.name} · ${lic.client_name}`,
      subtitle: `Expires ${lic.expiry_date}`,
    })),
  ];

  // Every ring gauge below reads as "this much of what's been invoiced" —
  // one consistent denominator (totalInvoiced) across all four cards,
  // rather than four unrelated, harder-to-compare percentages. Guarded
  // against a brand-new business with nothing invoiced yet (0/0).
  const ringPct = (value) => (summary && summary.totalInvoiced > 0 ? (value / summary.totalInvoiced) * 100 : 0);

  async function handleDownloadReceipt(invoiceId, paymentId) {
    setError('');
    try {
      await api.invoices.openReceiptPdf(invoiceId, paymentId, token);
    } catch (err) {
      setError(err.message);
    }
  }

  // "This year at a glance" — six KpiCards drawing on each module's own
  // existing analytics endpoint (see currentYearRow() above), one per
  // module the viewer actually holds a `view` grant for. Deliberately not
  // every field each analytics endpoint returns — Paid/Outstanding/Overdue
  // already have their own ring cards above, so this section covers what
  // those don't: how much activity happened this year, not just the money
  // balance right now. Each card links straight to that module's own full
  // analytics page (the real "everything" this section is a preview of).
  function yearOverviewSection() {
    // routes/dashboard.js's own overview endpoint already returns just this
    // year's own figures for each module (see that route's own top-of-file
    // note) — no `byYear` array to pick a row out of here anymore.
    const q = quoteAnalytics;
    const inv = invoiceAnalytics;
    const lic = licenseAnalytics;
    const exp = expenseAnalytics;
    const decided = q ? (q.accepted || 0) + (q.declined || 0) : 0;

    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {canViewQuotes && q && (
          <Link to="/quotes/analytics" className="block">
            <KpiCard
              icon={<QuoteIcon width={17} height={17} />}
              label="Quotes issued"
              value={q.created || 0}
              sub={`${money(symbol, q.amountQuoted || 0)} quoted`}
            />
          </Link>
        )}
        {canViewQuotes && q && (
          <Link to="/quotes/analytics" className="block">
            <KpiCard
              tone="positive"
              icon={<CheckCircleIcon width={17} height={17} />}
              label="Quotes accepted"
              value={q.accepted || 0}
              sub={decided > 0 ? `of ${decided} decided` : 'None decided yet'}
            />
          </Link>
        )}
        {canViewInvoices && inv && (
          <Link to="/invoices/analytics" className="block">
            <KpiCard
              icon={<InvoiceIcon width={17} height={17} />}
              label="Invoices issued"
              value={inv.issued || 0}
              sub={`${money(symbol, inv.amountInvoiced || 0)} invoiced`}
            />
          </Link>
        )}
        {canViewInvoices && inv && (
          <Link to="/invoices/analytics" className="block">
            <KpiCard
              tone="positive"
              icon={<CheckCircleIcon width={17} height={17} />}
              label="Collected"
              value={money(symbol, inv.amountCollected || 0)}
              sub={`${inv.paymentsReceived || 0} payment${inv.paymentsReceived === 1 ? '' : 's'}`}
            />
          </Link>
        )}
        {canViewLicenses && lic && (
          <Link to="/licenses/analytics" className="block">
            <KpiCard
              icon={<LicenseIcon width={17} height={17} />}
              label="New licenses"
              value={lic.newLicenses || 0}
              sub={`${lic.renewals || 0} renewed`}
            />
          </Link>
        )}
        {canViewExpenses && exp && (
          <Link to="/expenses/analytics" className="block">
            <KpiCard
              tone="warning"
              icon={<ExpenseIcon width={17} height={17} />}
              label="Expenses"
              value={money(symbol, exp.total || 0)}
              sub={`${exp.count || 0} recorded`}
            />
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{greeting()}</p>
      <h1 className="font-display text-3xl font-extrabold text-ink dark:text-white">{firstName}</h1>
      {/* Waits on the same `settingsLoaded` flag the financial content below
          gates on (see that section's own currency-symbol-flash note) —
          painting `user?.email` immediately and swapping to
          `settings.business_name` a moment later, once the independent
          settings fetch resolves, read as a visible flash/flicker rather
          than a clean single paint. A non-breaking space holds the line's
          height in the meantime so nothing shifts once the real value
          arrives. */}
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        {settingsLoaded ? settings?.business_name || user?.email : ' '}
      </p>

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {!canViewFinancials ? (
        <p className="mt-8 text-sm text-slate-500 dark:text-slate-400">
          {permittedShortcuts.length === 0
            ? 'Nothing to show yet — ask an admin to grant you access to what you need.'
            : 'Use the menu to open the pages you have access to.'}
        </p>
      ) : !summary || !settingsLoaded ? (
        <p className="mt-8 text-sm text-slate-500 dark:text-slate-400">Loading…</p>
      ) : (
        <div className="mt-8 flex flex-col gap-6 xl:flex-row xl:items-start">
          {/* Main column */}
          <div className="min-w-0 flex-1">
            {/* Studio stage 2 order, built for a phone first: what needs a
                human (overdue invoices, expiring licenses) comes before any
                figure, then the one number this app can most vouch for (bank
                balance), then this year's paid/outstanding/overdue as a single
                comparable list, then recent payments. The detail panels
                (revenue chart, status split, year at a glance) follow as
                collapsible cards. All of it reads the same single
                /dashboard/overview response as before — no new requests —
                and every section keeps its existing permission gate. At
                `xl:` the rail carries Needs attention instead, so the
                carousel is hidden there (never both). */}
            {canSeeAttentionPanel && (
              <div className="xl:hidden">
                <AttentionCarousel items={attentionItems} />
              </div>
            )}

            <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <BalanceHero
                icon={<BankIcon width={15} height={15} />}
                label="Bank balance"
                value={money(symbol, summary.bankBalance)}
                sub={`${summary.clientCount} active client${summary.clientCount === 1 ? '' : 's'}`}
                trend={summary.monthlyTrend}
                trendLabel="Collected, last 6 months"
              />
              <StatBars
                title={`This year · ${money(symbol, summary.totalInvoiced)} invoiced`}
                items={[
                  {
                    key: 'paid',
                    label: 'Paid',
                    value: money(symbol, summary.totalPaid),
                    percent: ringPct(summary.totalPaid),
                    tone: 'positive',
                  },
                  {
                    key: 'outstanding',
                    label: 'Outstanding',
                    value: money(symbol, summary.totalOutstanding),
                    sub: 'Awaiting payment',
                    percent: ringPct(summary.totalOutstanding),
                    tone: 'warning',
                  },
                  {
                    key: 'overdue',
                    label: 'Overdue',
                    value: money(symbol, summary.overdueAmount),
                    sub: `${summary.overdueCount} invoice${summary.overdueCount === 1 ? '' : 's'}`,
                    percent: ringPct(summary.overdueAmount),
                    tone: 'negative',
                  },
                ]}
              />
            </div>

            <section className="mt-6 rounded-[28px] bg-white p-2 shadow-sm dark:bg-slate-900">
              <h2 className="px-4 pb-1 pt-3 font-display text-base font-extrabold text-slate-900 dark:text-white">Recent payments</h2>
              {summary.recentPayments.length === 0 ? (
                <p className="px-4 pb-4 text-sm text-slate-500 dark:text-slate-400">No payments recorded yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {summary.recentPayments.slice(0, 5).map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-900 dark:text-white">{p.client_name}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          <button
                            type="button"
                            onClick={() => handleDownloadReceipt(p.invoice_id, p.id)}
                            className="min-h-6 font-medium text-lagoon-700 hover:text-lagoon-600 dark:text-lagoon-300"
                          >
                            {p.receipt_number}
                          </button>
                          {' · '}
                          {p.paid_at}
                        </p>
                      </div>
                      <span className="shrink-0 font-display font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                        +{money(symbol, p.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <div className="mt-6">
              <Accordion title="Revenue, last 6 months" defaultOpen={false}>
                <RevenueTrendChart data={summary.monthlyTrend} currencySymbol={symbol} />
              </Accordion>
            </div>

            <div className="mt-6">
              <Accordion title="Invoices by status" defaultOpen={false}>
                <StatusDonutChart counts={summary.invoiceCounts} />
              </Accordion>
            </div>

            {canSeeYearOverview && (
              <div className="mt-6">
                <Accordion title={`This year at a glance (${CURRENT_YEAR})`} defaultOpen={false}>
                  {yearOverviewSection()}
                </Accordion>
              </div>
            )}
          </div>

          {/* Right rail — profile card, shortcuts, needs attention. Desktop
              only (`xl:` and up); the phone/tablet experience gets the same
              data through the Accordion/pill-row equivalents above instead
              of a cramped narrow rail. */}
          <div className="hidden shrink-0 xl:block xl:w-[300px]">
            <DashboardRail
              user={user}
              shortcuts={permittedShortcuts.slice(0, RAIL_SHORTCUT_LIMIT)}
              attentionItems={canSeeAttentionPanel ? attentionItems : []}
            />
          </div>
        </div>
      )}
    </div>
  );
}
