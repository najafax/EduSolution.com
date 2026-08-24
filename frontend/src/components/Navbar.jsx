import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import GlobalSearch from './GlobalSearch';
import Sidebar from './Sidebar';
import ThemeToggle from './ThemeToggle';
import NotificationCenter from './NotificationCenter';
import { SearchIcon, XIcon } from './icons';

// `module: null` means always visible to any logged-in user regardless of
// permissions (Dashboard). Everything else is filtered by that module's
// view permission so a restricted user never sees a link leading to a 403
// — enforcement itself still happens server-side; this is just UX.
// `adminOnly: true` (Email Center) is a stricter, separate check against
// the account's actual role rather than a module grant — mirrors the
// backend's requireAdmin (routes/emailCenter.js), which no staff permission
// can unlock.
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
  { to: '/email-center', label: 'Email center', module: null, adminOnly: true },
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
  const isPublicDocLink = location.pathname.startsWith('/q/') || location.pathname.startsWith('/i/');

  return (
    <header
      className="border-b border-slate-200 bg-white/80 backdrop-blur sticky top-0 z-10 xl:hidden dark:border-slate-800 dark:bg-slate-950/80"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <nav className="flex w-full items-center justify-between gap-4 px-4 py-3 sm:px-6 sm:py-4">
        <Link to="/" className="shrink-0 text-base font-semibold text-slate-900 sm:text-lg dark:text-white">
          EduSolution<span className="text-lagoon-600">.com</span>
        </Link>

        {user ? (
          <>
            {/* Mobile menu toggle. Below `sm` (phones), BottomNav.jsx's tab
                bar + "More" sheet replaces this hamburger entirely — so the
                hamburger itself only renders from `sm` up (tablets), while
                the phone-only search toggle takes its place below `sm`
                (GlobalSearch otherwise only appears inside this drawer, since
                Sidebar.jsx now owns the desktop/xl+ search box). Opening it
                renders Sidebar itself as a slide-in drawer (see below) rather
                than a separate flat link list, so the tablet nav is the same
                component/links/icons as the persistent desktop sidebar, just
                toggled instead of always-on. */}
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
              <button
                onClick={() => setMenuOpen((v) => !v)}
                aria-label="Toggle menu"
                aria-expanded={menuOpen}
                className="hidden min-h-11 min-w-11 items-center justify-center rounded-md text-slate-700 sm:flex dark:text-slate-300"
              >
                {menuOpen ? (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
                  </svg>
                )}
              </button>
            </div>
          </>
        ) : (
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

      {/* Tablet menu, opened by the hamburger above: Sidebar itself in
          drawer mode (see Sidebar.jsx's `mobileOpen` prop) rather than the
          flat link-list dropdown this used to render — same links, same
          icons, same account/theme/logout row as the persistent desktop
          sidebar, just slid in over the page instead of always visible.
          Only mounted while actually open, same as every other popup in
          this app (Modal.jsx, BottomSheet.jsx) — no reason to keep its
          GlobalSearch instance and effects alive in the background. */}
      {user && menuOpen && <Sidebar mobileOpen onMobileClose={() => setMenuOpen(false)} />}
    </header>
  );
}
