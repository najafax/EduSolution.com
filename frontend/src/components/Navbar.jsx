import { useCallback, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import GlobalSearch from './GlobalSearch';
import Sidebar from './Sidebar';
import ThemeToggle from './ThemeToggle';
import NotificationCenter from './NotificationCenter';
import { useEdgeSwipeOpen } from '../lib/useEdgeSwipeOpen';
import { SearchIcon, XIcon, MenuIcon } from './icons';

// `module: null` means always visible to any logged-in user regardless of
// permissions (Dashboard). Everything else is filtered by that module's
// view permission so a restricted user never sees a link leading to a 403
// — enforcement itself still happens server-side; this is just UX.
// `superAdminOnly: true` (MOD report) is a stricter, separate check against
// the account's actual role rather than a module grant — mirrors the
// backend's requireSuperAdmin (routes/modReports.js), which no staff
// permission, and no plain 'admin' role either, can unlock; deliberately
// the one link in this list with no `module` and no way for any admin to
// grant it to anyone else, the same way routes/dataReset.js's Danger Zone
// (embedded in the Import page, not its own nav link) stays outside the
// per-module grant system entirely.
export const BUSINESS_LINKS = [
  { to: '/dashboard', label: 'Dashboard', module: null },
  { to: '/clients', label: 'Clients', module: 'clients' },
  { to: '/campaigns', label: 'Campaigns', module: 'campaigns' },
  { to: '/products', label: 'Products', module: 'products' },
  { to: '/quotes', label: 'Quotes', module: 'quotes' },
  { to: '/quote-requests', label: 'Quote requests', module: 'quotes' },
  { to: '/invoices', label: 'Invoices', module: 'invoices' },
  { to: '/recurring-invoices', label: 'Recurring', module: 'recurring_invoices' },
  { to: '/licenses', label: 'Licenses', module: 'licenses' },
  { to: '/expenses', label: 'Expenses', module: 'expenses' },
  { to: '/capital-contributions', label: 'Capital', module: 'expenses' },
  { to: '/owner-draws', label: 'Owner draws', module: 'expenses' },
  { to: '/financials', label: 'Financials', module: 'financials' },
  { to: '/reports', label: 'Reports', module: 'financials' },
  { to: '/activity', label: 'Activity', module: 'activity' },
  { to: '/users', label: 'Users', module: 'users' },
  { to: '/email-center', label: 'Email center', module: 'email_center' },
  { to: '/website-content', label: 'Website content', module: 'website' },
  { to: '/mod-reports', label: 'MOD report', module: null, superAdminOnly: true },
  { to: '/settings', label: 'Settings', module: 'settings' },
];

export default function Navbar() {
  const { user } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [phoneSearchOpen, setPhoneSearchOpen] = useState(false);

  // The public client-facing quote/invoice links (PublicQuote.jsx,
  // PublicInvoice.jsx) render no header of their own and rely entirely on
  // this shared Navbar — but they're meant for an external client with no
  // account, so the "Log in" button there is just noise (or worse, an
  // invitation to poke at staff-only auth) rather than a useful action.
  // PublicMODReport.jsx (/mod/:token) is the same kind of page for the same
  // reason — whoever's filling out a MOD checklist from a shared link has
  // no staff account either.
  const isPublicDocLink = location.pathname.startsWith('/q/') || location.pathname.startsWith('/i/') || location.pathname.startsWith('/mod/');

  // Swiping in from the left edge of the screen opens the nav drawer
  // instead of triggering the phone's own "swipe back" navigation gesture
  // — see useEdgeSwipeOpen's own note for why this can only ever be a
  // best-effort override, not a guaranteed one. Disabled once the drawer
  // is already open (nothing left to open, and the drawer's own backdrop
  // handles touches on it from here) and for anyone not logged in (no
  // drawer to open — the public quote/invoice/MOD-report links, Login,
  // etc. should still go "back" the normal way).
  const openMenu = useCallback(() => setMenuOpen(true), []);
  useEdgeSwipeOpen({ enabled: Boolean(user) && !menuOpen, onOpen: openMenu });

  const initials = (user?.name || user?.email || '?')
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <header
      className="border-b border-slate-200 bg-white/80 backdrop-blur sticky top-0 z-10 xl:hidden dark:border-slate-800 dark:bg-slate-950/80"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <nav className="flex w-full items-center justify-between gap-2 px-4 py-3 sm:px-6 sm:py-4">
        {user ? (
          <>
            {/* Top-left corner: hamburger, then wordmark. The hamburger
                opens Sidebar itself as a slide-in drawer (see below) rather
                than a separate flat link list, so this nav is the same
                component/links/icons as the persistent desktop sidebar, just
                toggled instead of always-on — visible at every width below
                `xl:` (phones included) since it's this app's one route into
                the full nav below that breakpoint; `BottomNav.jsx`'s own tab
                bar only carries the five primary shortcuts, not a mirror of
                this trigger. */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                aria-label={menuOpen ? 'Close menu' : 'Open menu'}
                aria-expanded={menuOpen}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-slate-700 dark:text-slate-300"
              >
                {menuOpen ? <XIcon width={22} height={22} /> : <MenuIcon width={22} height={22} />}
              </button>
              <Link to="/" className="flex shrink-0 items-center gap-1.5 text-base font-semibold text-slate-900 sm:text-lg dark:text-white">
                <img src="/logo-symbol.png" alt="" className="h-6 w-6 sm:h-7 sm:w-7" />
                Edu Solutions
              </Link>
            </div>

            {/* Top-right corner: search/notifications/theme, then the
                account avatar last so it sits in the very corner. */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPhoneSearchOpen((v) => !v)}
                aria-label={phoneSearchOpen ? 'Close search' : 'Search'}
                aria-expanded={phoneSearchOpen}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-slate-700 sm:hidden dark:text-slate-300"
              >
                {phoneSearchOpen ? <XIcon width={22} height={22} /> : <SearchIcon width={22} height={22} />}
              </button>
              <NotificationCenter />
              <ThemeToggle />
              <Link
                to="/account"
                aria-label="My account"
                className="ml-0.5 flex shrink-0 items-center justify-center rounded-full"
              >
                {user.avatarImage ? (
                  <img src={user.avatarImage} alt="" className="h-8 w-8 rounded-full object-cover" />
                ) : (
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-lagoon-600 text-xs font-bold text-white">
                    {initials}
                  </span>
                )}
              </Link>
            </div>
          </>
        ) : (
          <>
            {/* Hidden on the public quote/invoice/MOD-report links — a
                client following one of those has no reason to see (or
                click into) the app's own branding, same reasoning the
                "Log in" button below is already hidden there. */}
            {isPublicDocLink ? (
              <span />
            ) : (
              <Link to="/" className="flex shrink-0 items-center gap-1.5 text-base font-semibold text-slate-900 sm:text-lg dark:text-white">
                <img src="/logo-symbol.png" alt="" className="h-6 w-6 sm:h-7 sm:w-7" />
                Edu Solutions
              </Link>
            )}
            <div className="flex items-center gap-2 sm:gap-4">
              <ThemeToggle />
              {!isPublicDocLink && (
                <Link
                  to="/login"
                  className="flex min-h-11 items-center rounded-md bg-lagoon-600 px-3 text-sm font-medium text-white hover:bg-lagoon-500 sm:px-4"
                >
                  Log in
                </Link>
              )}
            </div>
          </>
        )}
      </nav>

      {/* Phone-only inline search row, opened by the search icon above.
          Tablet/desktop reach GlobalSearch via the drawer/desktop bar
          instead, so this is hidden from `sm` up. */}
      {user && phoneSearchOpen && (
        <div className="border-t border-slate-200 px-4 py-2 sm:hidden dark:border-slate-800">
          <GlobalSearch onNavigate={() => setPhoneSearchOpen(false)} autoFocus />
        </div>
      )}

      {/* Menu drawer, opened by the top-left hamburger above (every width
          below `xl:`, phones included): Sidebar itself in drawer mode (see
          Sidebar.jsx's `mobileOpen` prop) rather than a flat link-list
          dropdown — same links, same icons, same account/theme/logout row
          as the persistent desktop sidebar, just slid in over the page
          instead of always visible. Only mounted while actually open, same
          as every other popup in this app (Modal.jsx, BottomSheet.jsx) — no
          reason to keep its GlobalSearch instance and effects alive in the
          background. */}
      {user && menuOpen && <Sidebar mobileOpen onMobileClose={() => setMenuOpen(false)} />}
    </header>
  );
}
