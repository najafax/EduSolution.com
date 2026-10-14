import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '../context/NotificationsContext';
import { AlertTriangleIcon, LicenseIcon, InboxIcon, BellIcon, ChevronRightIcon } from './icons';

// How many items each category shows before "+more" — a display concern
// local to this component, not imported from Dashboard.jsx's own identical
// NEEDS_ATTENTION_LIMIT (same acceptable-duplication call this app already
// makes for EXPIRY_WARNING_DAYS between routes/licenses.js and
// lib/scheduler.js).
const LIMIT_PER_TYPE = 4;

const TONES = {
  red: 'bg-red-500/15 text-red-700 dark:bg-red-400/15 dark:text-red-300',
  amber: 'bg-amber-500/20 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300',
  lagoon: 'bg-lagoon-500/15 text-lagoon-700 dark:bg-lagoon-400/15 dark:text-lagoon-300',
};

function shortDate(iso) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Whole days from a to b (both YYYY-MM-DD).
function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}


// A live, permission-gated view of what needs attention right now —
// overdue invoices and licenses expiring soon (the same two categories
// Dashboard.jsx's own "Needs attention" panel already computes, reusing
// its exact fetch/filter/sort logic here rather than a new backend route),
// plus pending quote requests, which that panel doesn't cover. Surfaced
// globally from the top nav (Sidebar.jsx for desktop, Navbar.jsx for
// mobile/tablet) rather than only reachable from Dashboard. Deliberately
// no persistence or read/unread tracking — like the panel it mirrors, this
// is a live computed view refetched on open, not a stored notifications
// table with its own state; same "don't build it until needed" call this
// app already makes elsewhere (routes/licenses.js's own renewal history,
// routes/reports.js's un-paginated currency-exchange list).
// `align="left"` anchors the dropdown's left edge to the bell instead of
// its right edge — needed inside Sidebar.jsx, where the bell sits near the
// top-right of a narrow (240px) column: a right-anchored w-80 dropdown
// there would overflow past the sidebar's own left edge and the browser
// window's left edge entirely, rather than opening into the roomy main
// content area beside it. Navbar.jsx's header spans the full viewport
// width, so the default right anchor (the dropdown opening leftward,
// under a bell positioned toward the header's right side) never runs out
// of room there.
export default function NotificationCenter({ className = '', align = 'right' }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  // Fetched once, shared across every mounted <NotificationCenter> instance
  // (Navbar.jsx's and TopBar.jsx's headers are both always in the tree —
  // CSS breakpoints decide which is *visible*, not React — so without this
  // shared context each instance used to run its own independent fetch;
  // see NotificationsContext.jsx's own top-of-file note).
  const { overdueInvoices, expiringLicenses, pendingRequests, refresh, canViewInvoices, canViewLicenses, canViewQuotes } =
    useNotifications();

  // Re-fetch every time the panel is opened, so a tab left open a while
  // doesn't keep showing counts from whenever it last loaded.
  useEffect(() => {
    if (open) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!canViewInvoices && !canViewLicenses && !canViewQuotes) return null;

  const total = overdueInvoices.length + expiringLicenses.length + pendingRequests.length;

  function go(path) {
    setOpen(false);
    navigate(path);
  }

  const sections = [
    {
      key: 'inv',
      title: 'Overdue invoices',
      tone: 'red',
      Icon: AlertTriangleIcon,
      all: '/invoices',
      rows: overdueInvoices.map((inv) => ({
        id: inv.id,
        title: inv.client_name,
        sub: `${inv.number} · due ${shortDate(inv.due_date)}`,
        badge: `${daysBetween(inv.due_date, todayIso())}d late`,
        to: `/invoices/${inv.id}`,
      })),
    },
    {
      key: 'lic',
      title: 'Expiring licenses',
      tone: 'amber',
      Icon: LicenseIcon,
      all: '/licenses',
      rows: expiringLicenses.map((lic) => {
        const left = daysBetween(todayIso(), lic.expiry_date);
        return {
          id: lic.id,
          title: lic.name,
          sub: `${lic.client_name} · ${shortDate(lic.expiry_date)}`,
          badge: left < 0 ? 'Expired' : left === 0 ? 'Today' : `${left}d left`,
          to: '/licenses',
        };
      }),
    },
    {
      key: 'qr',
      title: 'Quote requests',
      tone: 'lagoon',
      Icon: InboxIcon,
      all: '/quote-requests',
      rows: pendingRequests.map((r) => ({
        id: r.id,
        title: r.client_name,
        sub: r.description || `${r.items.length} item${r.items.length === 1 ? '' : 's'} requested`,
        badge: 'New',
        to: '/quote-requests',
      })),
    },
  ].filter((sec) => sec.rows.length > 0);

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications${total > 0 ? ` (${total})` : ''}`}
        aria-expanded={open}
        title="Notifications"
        className={`relative flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200 ${className}`}
      >
        <BellIcon width={18} height={18} />
        {total > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
            {total > 9 ? '9+' : total}
          </span>
        )}
      </button>

      {open && (
        <div
          className={`water-tint glass glass-strong fixed inset-x-3 top-16 z-40 max-h-[75vh] overflow-y-auto rounded-3xl sm:absolute sm:inset-x-auto sm:top-auto sm:mt-2 sm:w-96 ${
            align === 'left' ? 'sm:left-0' : 'sm:right-0'
          }`}
        >
          <div className="flex items-center justify-between px-5 pb-2 pt-4">
            <div>
              <p className="font-display text-lg font-extrabold text-slate-900 dark:text-white">Notifications</p>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                {total === 0 ? 'Nothing needs attention' : `${total} thing${total === 1 ? '' : 's'} need attention`}
              </p>
            </div>
            {total > 0 && (
              <span className="flex h-8 min-w-8 items-center justify-center rounded-full bg-red-500 px-2 text-sm font-bold text-white shadow-lg shadow-red-500/30">
                {total}
              </span>
            )}
          </div>

          {total === 0 ? (
            <div className="flex flex-col items-center px-6 pb-8 pt-4 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/50 text-lagoon-600 shadow-inner dark:bg-white/10 dark:text-lagoon-300">
                <BellIcon width={26} height={26} />
              </span>
              <p className="mt-3 font-semibold text-slate-900 dark:text-white">You're all caught up</p>
              <p className="text-xs text-slate-600 dark:text-slate-400">New overdue items will show up here.</p>
            </div>
          ) : (
            <div className="space-y-4 px-3 pb-3">
              {sections.map(({ key, title, tone, Icon, all, rows }) => (
                <section key={key}>
                  <div className="flex items-center justify-between px-2 pb-1.5">
                    <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                      {title} · {rows.length}
                    </h3>
                    <button
                      type="button"
                      onClick={() => go(all)}
                      className="text-xs font-semibold text-lagoon-700 hover:underline dark:text-lagoon-300"
                    >
                      View all
                    </button>
                  </div>
                  <ul className="space-y-1.5">
                    {rows.slice(0, LIMIT_PER_TYPE).map((row) => (
                      <li key={`${key}-${row.id}`}>
                        <button
                          type="button"
                          onClick={() => go(row.to)}
                          className="flex w-full items-center gap-3 rounded-2xl border border-white/50 bg-white/40 p-2.5 text-left backdrop-blur transition active:scale-[0.98] hover:bg-white/60 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
                        >
                          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${TONES[tone]}`}>
                            <Icon width={18} height={18} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-slate-900 dark:text-white">{row.title}</span>
                            <span className="block truncate text-xs text-slate-600 dark:text-slate-400">{row.sub}</span>
                          </span>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${TONES[tone]}`}>{row.badge}</span>
                          <ChevronRightIcon width={14} height={14} className="shrink-0 text-slate-400" />
                        </button>
                      </li>
                    ))}
                  </ul>
                  {rows.length > LIMIT_PER_TYPE && (
                    <button
                      type="button"
                      onClick={() => go(all)}
                      className="mt-1.5 w-full rounded-xl py-1.5 text-xs font-semibold text-lagoon-700 hover:bg-white/40 dark:text-lagoon-300 dark:hover:bg-white/10"
                    >
                      +{rows.length - LIMIT_PER_TYPE} more
                    </button>
                  )}
                </section>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
