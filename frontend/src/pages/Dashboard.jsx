import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { useDashboardShortcuts } from '../lib/useDashboardShortcuts';
import RevenueTrendChart from '../components/RevenueTrendChart';
import StatusBreakdownChart from '../components/StatusBreakdownChart';
import Accordion from '../components/Accordion';
import Modal from '../components/Modal';
import DashboardShortcutsEditor from '../components/DashboardShortcutsEditor';
import { AlertTriangleIcon, LicenseIcon } from '../components/icons';
import { money } from '../lib/money';

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

const SHORTCUTS = [
  { to: '/clients', label: 'Clients', module: 'clients' },
  { to: '/products', label: 'Products', module: 'products' },
  { to: '/quotes', label: 'Quotes', module: 'quotes' },
  { to: '/invoices', label: 'Invoices', module: 'invoices' },
  { to: '/recurring-invoices', label: 'Recurring', module: 'recurring_invoices' },
  { to: '/licenses', label: 'Licenses', module: 'licenses' },
  { to: '/expenses', label: 'Expenses', module: 'expenses' },
  { to: '/financials', label: 'Financials', module: 'financials' },
  { to: '/settings', label: 'Settings', module: 'settings' },
];

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

  const isPositiveBalance = summary && summary.bankBalance >= 0;
  const firstName = user?.name?.split(' ')[0];
  const attentionCount = overdueInvoices.length + expiringLicenses.length;

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
        <>
          {/* Hero — the one number that matters most at a glance, plus a
              plain-language summary built only from figures this app can
              actually vouch for (see routes/financials.js's own bankBalance
              note on why it's a running proxy, not a live bank connection) —
              no invented month-over-month delta, since summary/GET doesn't
              return a prior-period figure to compare against. A clean white/
              surface card with a slim top accent bar, not a full tinted
              lagoon-50 fill — reserves color for the one thing that matters
              (the figure itself, and the accent line), which reads quieter
              and more considered than a colored panel. */}
          <div className="relative mt-8 flex flex-col gap-6 overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-md sm:p-9 md:flex-row md:items-center md:justify-between dark:border-slate-700 dark:bg-slate-900">
            <div aria-hidden className="absolute inset-x-0 top-0 h-1 bg-lagoon-600" />
            <div>
              <p className="text-sm font-semibold text-lagoon-600 dark:text-lagoon-400">Bank balance</p>
              <p className={`font-display mt-1.5 text-4xl font-extrabold tabular-nums sm:text-5xl ${isPositiveBalance ? 'text-ink dark:text-white' : 'text-red-600 dark:text-red-400'}`}>
                {money(symbol, summary.bankBalance)}
              </p>
              <p className="mt-3 max-w-md text-sm text-slate-500 dark:text-slate-400">
                {summary.clientCount} active client{summary.clientCount === 1 ? '' : 's'}, {money(symbol, summary.totalPaid)} collected,
                and {money(symbol, summary.netProfit)} in net profit so far.
              </p>
            </div>
            <div className="flex gap-9">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Net profit</p>
                <p className={`font-display mt-1.5 text-2xl font-extrabold tabular-nums ${summary.netProfit >= 0 ? 'text-ink dark:text-white' : 'text-red-600 dark:text-red-400'}`}>
                  {money(symbol, summary.netProfit)}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Outstanding</p>
                <p className="font-display mt-1.5 text-2xl font-extrabold tabular-nums text-ink dark:text-white">{money(symbol, summary.totalOutstanding)}</p>
              </div>
            </div>
          </div>

          {/* Secondary strip — de-emphasized on purpose: these back up the
              hero number above rather than competing with it. */}
          <div className="mt-3 flex flex-wrap items-center gap-x-8 gap-y-3 rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Clients</p>
              <p className="font-display mt-0.5 text-lg font-extrabold tabular-nums text-ink dark:text-white">{summary.clientCount}</p>
            </div>
            <div className="hidden h-8 w-px bg-slate-200 sm:block dark:bg-slate-700" />
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Invoiced</p>
              <p className="font-display mt-0.5 text-lg font-extrabold tabular-nums text-ink dark:text-white">{money(symbol, summary.totalInvoiced)}</p>
            </div>
            <div className="hidden h-8 w-px bg-slate-200 sm:block dark:bg-slate-700" />
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Paid</p>
              <p className="font-display mt-0.5 text-lg font-extrabold tabular-nums text-ink dark:text-white">{money(symbol, summary.totalPaid)}</p>
            </div>
            <div className="hidden h-8 w-px bg-slate-200 sm:block dark:bg-slate-700" />
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Overdue</p>
              <p className={`font-display mt-0.5 text-lg font-extrabold tabular-nums ${summary.overdueCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-ink dark:text-white'}`}>
                {money(symbol, summary.overdueAmount)}
              </p>
            </div>
            {summary.totalCapitalContributions > 0 && (
              <>
                <div className="hidden h-8 w-px bg-slate-200 sm:block dark:bg-slate-700" />
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Capital in</p>
                  <p className="font-display mt-0.5 text-lg font-extrabold tabular-nums text-ink dark:text-white">{money(symbol, summary.totalCapitalContributions)}</p>
                </div>
              </>
            )}
          </div>

          <div className="mt-6">
            <Accordion title="Revenue, last 6 months">
              <RevenueTrendChart data={summary.monthlyTrend} currencySymbol={symbol} />
            </Accordion>
          </div>

          {/* Stacked full-width, not a side-by-side grid — every panel on
              this page reads as the same width so the layout stays
              consistent top to bottom, rather than this one row narrowing
              to two half-width cards while everything above/below it stays
              full width. */}
          <div className="mt-6 flex flex-col gap-6">
            <Accordion title="Invoices by status">
              <StatusBreakdownChart counts={summary.invoiceCounts} />
            </Accordion>

            {canSeeAttentionPanel && (
              <Accordion title={`Needs attention${attentionCount > 0 ? ` (${attentionCount})` : ''}`}>
                {overdueInvoices.length === 0 && expiringLicenses.length === 0 ? (
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
            )}
          </div>

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

          {shortcutsRow()}
        </>
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
