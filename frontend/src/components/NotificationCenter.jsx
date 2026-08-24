import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { AlertTriangleIcon, LicenseIcon, InboxIcon, BellIcon } from './icons';

// How many items each category shows before "+more" — a display concern
// local to this component, not imported from Dashboard.jsx's own identical
// NEEDS_ATTENTION_LIMIT (same acceptable-duplication call this app already
// makes for EXPIRY_WARNING_DAYS between routes/licenses.js and
// lib/scheduler.js).
const LIMIT_PER_TYPE = 5;

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
  const { token, can } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [overdueInvoices, setOverdueInvoices] = useState([]);
  const [expiringLicenses, setExpiringLicenses] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const boxRef = useRef(null);

  const canViewInvoices = can('invoices', 'view');
  const canViewLicenses = can('licenses', 'view');
  const canViewQuotes = can('quotes', 'view');

  function load() {
    if (canViewInvoices) {
      api.invoices
        .list(token, { status: 'sent' })
        .then(({ invoices }) =>
          setOverdueInvoices(invoices.filter((inv) => inv.is_overdue).sort((a, b) => (a.due_date < b.due_date ? -1 : 1))),
        )
        .catch(() => {});
    }
    if (canViewLicenses) {
      api.licenses
        .list(token, { status: 'expiring_soon' })
        .then(({ licenses }) => setExpiringLicenses([...licenses].sort((a, b) => (a.expiry_date < b.expiry_date ? -1 : 1))))
        .catch(() => {});
    }
    if (canViewQuotes) {
      api.quoteRequests
        .list(token, { status: 'pending' })
        .then(({ requests }) => setPendingRequests(requests))
        .catch(() => {});
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [token, canViewInvoices, canViewLicenses, canViewQuotes]);
  // Re-fetch every time the panel is opened, so a tab left open a while
  // doesn't keep showing counts from whenever it last loaded.
  useEffect(() => {
    if (open) load();
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
          className={`absolute z-20 mt-2 max-h-96 w-80 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900 ${
            align === 'left' ? 'left-0' : 'right-0'
          }`}
        >
          <p className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900 dark:border-slate-800 dark:text-white">
            Notifications
          </p>
          {total === 0 ? (
            <p className="p-4 text-sm text-slate-500 dark:text-slate-400">You're all caught up.</p>
          ) : (
            <div className="py-1">
              {overdueInvoices.length > 0 && (
                <div>
                  <p className="px-4 pt-2 text-xs font-semibold uppercase text-slate-400 dark:text-slate-500">Overdue invoices</p>
                  {overdueInvoices.slice(0, LIMIT_PER_TYPE).map((inv) => (
                    <button
                      key={`inv-${inv.id}`}
                      type="button"
                      onClick={() => go(`/invoices/${inv.id}`)}
                      className="flex w-full items-start gap-2 px-4 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <AlertTriangleIcon width={16} height={16} className="mt-0.5 shrink-0 text-red-600 dark:text-red-400" />
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-slate-900 dark:text-white">{inv.client_name}</span>
                        <span className="block text-xs text-red-600 dark:text-red-400">
                          {inv.number} · overdue since {inv.due_date}
                        </span>
                      </span>
                    </button>
                  ))}
                  {overdueInvoices.length > LIMIT_PER_TYPE && (
                    <button
                      type="button"
                      onClick={() => go('/invoices')}
                      className="block w-full px-4 py-1.5 text-left text-xs font-medium text-lagoon-600 hover:underline dark:text-lagoon-400"
                    >
                      +{overdueInvoices.length - LIMIT_PER_TYPE} more
                    </button>
                  )}
                </div>
              )}
              {expiringLicenses.length > 0 && (
                <div>
                  <p className="px-4 pt-2 text-xs font-semibold uppercase text-slate-400 dark:text-slate-500">Expiring licenses</p>
                  {expiringLicenses.slice(0, LIMIT_PER_TYPE).map((lic) => (
                    <button
                      key={`lic-${lic.id}`}
                      type="button"
                      onClick={() => go('/licenses')}
                      className="flex w-full items-start gap-2 px-4 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <LicenseIcon width={16} height={16} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-slate-900 dark:text-white">
                          {lic.name} · {lic.client_name}
                        </span>
                        <span className="block text-xs text-amber-600 dark:text-amber-400">Expires {lic.expiry_date}</span>
                      </span>
                    </button>
                  ))}
                  {expiringLicenses.length > LIMIT_PER_TYPE && (
                    <button
                      type="button"
                      onClick={() => go('/licenses')}
                      className="block w-full px-4 py-1.5 text-left text-xs font-medium text-lagoon-600 hover:underline dark:text-lagoon-400"
                    >
                      +{expiringLicenses.length - LIMIT_PER_TYPE} more
                    </button>
                  )}
                </div>
              )}
              {pendingRequests.length > 0 && (
                <div className="pb-2">
                  <p className="px-4 pt-2 text-xs font-semibold uppercase text-slate-400 dark:text-slate-500">Pending quote requests</p>
                  {pendingRequests.slice(0, LIMIT_PER_TYPE).map((r) => (
                    <button
                      key={`qr-${r.id}`}
                      type="button"
                      onClick={() => go('/quote-requests')}
                      className="flex w-full items-start gap-2 px-4 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <InboxIcon width={16} height={16} className="mt-0.5 shrink-0 text-lagoon-600 dark:text-lagoon-400" />
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-slate-900 dark:text-white">{r.client_name}</span>
                        <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                          {r.description || `${r.items.length} item${r.items.length === 1 ? '' : 's'} requested`}
                        </span>
                      </span>
                    </button>
                  ))}
                  {pendingRequests.length > LIMIT_PER_TYPE && (
                    <button
                      type="button"
                      onClick={() => go('/quote-requests')}
                      className="block w-full px-4 py-1.5 text-left text-xs font-medium text-lagoon-600 hover:underline dark:text-lagoon-400"
                    >
                      +{pendingRequests.length - LIMIT_PER_TYPE} more
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
