import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { useDashboardShortcuts } from '../lib/useDashboardShortcuts';
import RevenueTrendChart from '../components/RevenueTrendChart';
import StatusDonutChart from '../components/StatusDonutChart';
import RingKpiCard from '../components/RingKpiCard';
import DashboardRail from '../components/DashboardRail';
import Accordion from '../components/Accordion';
import Modal from '../components/Modal';
import DashboardShortcutsEditor from '../components/DashboardShortcutsEditor';
import {
  AlertTriangleIcon,
  LicenseIcon,
  BankIcon,
  CheckCircleIcon,
  ClockIcon,
  UsersIcon,
  ProductIcon,
  QuoteIcon,
  InvoiceIcon,
  RefreshIcon,
  ExpenseIcon,
  SettingsIcon,
} from '../components/icons';
import { money } from '../lib/money';

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

// How many shortcuts fit comfortably in the right rail's narrow column
// before it starts to feel cramped — the full permitted set still renders
// in the pill row below (every breakpoint) and the "Customize shortcuts"
// modal (see useDashboardShortcuts), this just caps the rail's own list.
const RAIL_SHORTCUT_LIMIT = 6;

// How many days out a license still counts as "expiring soon" — matches
// routes/licenses.js's own EXPIRY_WARNING_DAYS; not imported (this is a
// frontend display concern reading the backend's already-filtered
// `?status=expiring_soon` result, not re-deriving the threshold itself).
const NEEDS_ATTENTION_LIMIT = 4;

export default function Dashboard() {
  const { user, token, can } = useAuth();
  const [summary, setSummary] = useState(null);
  const [settings, setSettings] = useState(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [error, setError] = useState('');
  const [customizing, setCustomizing] = useState(false);
  const [overdueInvoices, setOverdueInvoices] = useState([]);
  const [expiringLicenses, setExpiringLicenses] = useState([]);

  const canViewFinancials = can('financials', 'view');
  const canViewInvoices = can('invoices', 'view');
  const canViewLicenses = can('licenses', 'view');
  const canSeeAttentionPanel = canViewFinancials && (canViewInvoices || canViewLicenses);

  useEffect(() => {
    if (canViewFinancials) {
      api.financials.summary(token).then(setSummary).catch((err) => setError(err.message));
    }
    // `.finally` flips settingsLoaded whether the fetch succeeds or fails
    // (e.g. a staff user without settings:view) — the render below waits on
    // this alongside `summary` so the hero/KPI figures never paint with the
    // '$' fallback for one frame before snapping to the real currency
    // symbol once this resolves a moment later (both fetches fire together
    // but resolve independently, and summary usually wins the race).
    api.settings
      .get(token)
      .then(({ settings }) => setSettings(settings))
      .catch(() => {})
      .finally(() => setSettingsLoaded(true));
  }, [token, canViewFinancials]);

  // "Needs attention" — the invoices already overdue and the licenses about
  // to lapse, the two things on this page that actually call for action
  // rather than just reporting a number. Each is its own small, permission-
  // gated fetch (separate from `financials:view`, which the rest of this
  // page's data depends on) rather than something financials/summary
  // returns, since a user could have one of these grants without the
  // other. Both are best-effort: a failure here shouldn't block the rest
  // of the dashboard, so errors are swallowed rather than surfaced.
  useEffect(() => {
    if (!canSeeAttentionPanel || !canViewInvoices) return;
    api.invoices
      .list(token, { status: 'sent' })
      .then(({ invoices }) => {
        const overdue = invoices.filter((inv) => inv.is_overdue).sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
        setOverdueInvoices(overdue.slice(0, NEEDS_ATTENTION_LIMIT));
      })
      .catch(() => {});
  }, [token, canSeeAttentionPanel, canViewInvoices]);

  useEffect(() => {
    if (!canSeeAttentionPanel || !canViewLicenses) return;
    api.licenses
      .list(token, { status: 'expiring_soon' })
      .then(({ licenses }) => {
        const sorted = [...licenses].sort((a, b) => (a.expiry_date < b.expiry_date ? -1 : 1));
        setExpiringLicenses(sorted.slice(0, NEEDS_ATTENTION_LIMIT));
      })
      .catch(() => {});
  }, [token, canSeeAttentionPanel, canViewLicenses]);

  const symbol = settings?.currency_symbol || '$';
  const permittedShortcuts = SHORTCUTS.filter((s) => can(s.module, 'view'));
  const { visible: visibleShortcuts, orderedAvailable, hiddenSet, toggleHidden, moveUp, moveDown, reset } =
    useDashboardShortcuts(permittedShortcuts);

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

  function shortcutsRow() {
    return (
      <div className="mt-6">
        {permittedShortcuts.length > 0 && (
          <button
            type="button"
            onClick={() => setCustomizing(true)}
            className="mb-2 text-xs font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          >
            Customize shortcuts
          </button>
        )}
        <div className="flex flex-wrap gap-2">
          {visibleShortcuts.map((s) => (
            <Link
              key={s.to}
              to={s.to}
              className="flex min-h-11 items-center rounded-full border border-slate-300 px-5 text-sm font-medium text-slate-700 shadow-sm transition-shadow hover:shadow-md dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {s.label}
            </Link>
          ))}
          {visibleShortcuts.length === 0 && (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {permittedShortcuts.length === 0
                ? 'Nothing to show yet — ask an admin to grant you access to what you need.'
                : 'All shortcuts are hidden.'}
            </p>
          )}
        </div>
      </div>
    );
  }

  function attentionAccordion() {
    return (
      <Accordion title={`Needs attention${attentionItems.length > 0 ? ` (${attentionItems.length})` : ''}`}>
        {attentionItems.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Nothing needs your attention right now.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {overdueInvoices.map((inv) => (
              <Link
                key={`inv-${inv.id}`}
                to={`/invoices/${inv.id}`}
                className="flex items-center justify-between gap-3 rounded-lg bg-red-50 px-3 py-2 text-sm hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-950/70"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <AlertTriangleIcon width={16} height={16} className="shrink-0 text-red-600 dark:text-red-400" />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900 dark:text-white">{inv.client_name}</p>
                    <p className="text-xs text-red-600 dark:text-red-400">{inv.number} · overdue since {inv.due_date}</p>
                  </div>
                </div>
                <span className="shrink-0 font-semibold text-red-600 dark:text-red-400">{money(symbol, inv.balance_due)}</span>
              </Link>
            ))}
            {expiringLicenses.map((lic) => (
              <Link
                key={`lic-${lic.id}`}
                to="/licenses"
                className="flex items-center justify-between gap-3 rounded-lg bg-amber-50 px-3 py-2 text-sm hover:bg-amber-100 dark:bg-amber-950/40 dark:hover:bg-amber-950/70"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <LicenseIcon width={16} height={16} className="shrink-0 text-amber-600 dark:text-amber-400" />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900 dark:text-white">
                      {lic.name} · {lic.client_name}
                    </p>
                    <p className="text-xs text-amber-600 dark:text-amber-400">Expires {lic.expiry_date}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Accordion>
    );
  }

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{greeting()}</p>
      <h1 className="font-display text-3xl font-extrabold text-ink dark:text-white">{firstName}</h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{settings?.business_name || user?.email}</p>

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {!canViewFinancials ? (
        <div className="mt-8">{shortcutsRow()}</div>
      ) : !summary || !settingsLoaded ? (
        <p className="mt-8 text-sm text-slate-500 dark:text-slate-400">Loading…</p>
      ) : (
        <div className="mt-8 flex flex-col gap-6 xl:flex-row xl:items-start">
          {/* Main column */}
          <div className="min-w-0 flex-1">
            {/* Four ring-gauge KPI cards — the "vibrant stats" half of the
                combined dashboard direction. Every ring reads as a share of
                totalInvoiced (see ringPct above), so the four are directly
                comparable rather than four unrelated percentages; Bank
                balance is the one "filled" (solid lagoon) card, reserving
                that treatment for the single number this app can most
                vouch for (see routes/financials.js's own bankBalance note),
                the other three sit on plain white/surface cards with a
                colored ring instead. */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <RingKpiCard
                filled
                icon={<BankIcon width={17} height={17} />}
                label="Bank balance"
                value={money(symbol, summary.bankBalance)}
                sub={`${summary.clientCount} active client${summary.clientCount === 1 ? '' : 's'}`}
                percent={ringPct(Math.max(0, summary.bankBalance))}
              />
              <RingKpiCard
                tone="positive"
                icon={<CheckCircleIcon width={17} height={17} />}
                label="Paid"
                value={money(symbol, summary.totalPaid)}
                sub={`of ${money(symbol, summary.totalInvoiced)} invoiced`}
                percent={ringPct(summary.totalPaid)}
              />
              <RingKpiCard
                tone="warning"
                icon={<ClockIcon width={17} height={17} />}
                label="Outstanding"
                value={money(symbol, summary.totalOutstanding)}
                sub="Awaiting payment"
                percent={ringPct(summary.totalOutstanding)}
              />
              <RingKpiCard
                tone="negative"
                icon={<AlertTriangleIcon width={17} height={17} />}
                label="Overdue"
                value={money(symbol, summary.overdueAmount)}
                sub={`${summary.overdueCount} invoice${summary.overdueCount === 1 ? '' : 's'}`}
                percent={ringPct(summary.overdueAmount)}
              />
            </div>

            <div className="mt-6">
              <Accordion title="Revenue, last 6 months">
                <RevenueTrendChart data={summary.monthlyTrend} currencySymbol={symbol} />
              </Accordion>
            </div>

            <div className="mt-6">
              <Accordion title="Invoices by status">
                <StatusDonutChart counts={summary.invoiceCounts} />
              </Accordion>
            </div>

            {/* Needs attention — full-detail Accordion below `xl:` (no rail
                at that width), the same data condensed into DashboardRail's
                own list at `xl:` and up. Never both at once. */}
            {canSeeAttentionPanel && <div className="mt-6 xl:hidden">{attentionAccordion()}</div>}

            <div className="mt-6">
              <Accordion title="Recent payments">
                {summary.recentPayments.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">No payments recorded yet.</p>
                ) : (
                  <div className="-mx-6 divide-y divide-slate-100 dark:divide-slate-800">
                    {summary.recentPayments.slice(0, 5).map((p) => (
                      <div key={p.id} className="flex flex-col gap-1 px-6 py-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                        <div>
                          <Link to={`/invoices/${p.invoice_id}`} className="font-medium text-lagoon-600 hover:text-lagoon-500">
                            {p.invoice_number}
                          </Link>
                          <span className="ml-2 text-slate-500 dark:text-slate-400">{p.client_name}</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="text-slate-500 dark:text-slate-400">{p.paid_at}</span>
                          <span className="font-medium text-slate-900 dark:text-white">{money(symbol, p.amount)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Accordion>
            </div>

            {/* Shortcut pills — every breakpoint below `xl:` (no rail
                there); collapsed at `xl:` and up since the rail's own
                "Shortcuts" list already covers the common case there. */}
            <div className="xl:hidden">{shortcutsRow()}</div>
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

      <Modal open={customizing} onClose={() => setCustomizing(false)} title="Customize shortcuts">
        <DashboardShortcutsEditor
          items={orderedAvailable}
          hiddenSet={hiddenSet}
          onToggle={toggleHidden}
          onMoveUp={moveUp}
          onMoveDown={moveDown}
          onReset={reset}
        />
      </Modal>
    </div>
  );
}
