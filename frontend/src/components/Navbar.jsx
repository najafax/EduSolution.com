import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import GlobalSearch from './GlobalSearch';
import ThemeToggle from './ThemeToggle';
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
  { to: '/products', label: 'Products', module: 'products' },
  { to: '/quotes', label: 'Quotes', module: 'quotes' },
  { to: '/quote-requests', label: 'Quote requests', module: 'quotes' },
  { to: '/invoices', label: 'Invoices', module: 'invoices' },
  { to: '/recurring-invoices', label: 'Recurring', module: 'recurring_invoices' },
  { to: '/licenses', label: 'Licenses', module: 'licenses' },
  { to: '/expenses', label: 'Expenses', module: 'expenses' },
  { to: '/capital-contributions', label: 'Capital', module: 'expenses' },
  { to: '/financials', label: 'Financials', module: 'financials' },
  { to: '/reports', label: 'Reports', module: 'financials' },
  { to: '/activity', label: 'Activity', module: 'activity' },
  { to: '/users', label: 'Users', module: 'users' },
  { to: '/email-center', label: 'Email center', module: null, adminOnly: true },
  { to: '/settings', label: 'Settings', module: 'settings' },
];

export default function Navbar() {
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [phoneSearchOpen, setPhoneSearchOpen] = useState(false);

  const visibleLinks = BUSINESS_LINKS.filter(
    (link) => (!link.module || can(link.module, 'view')) && (!link.adminOnly || user?.role === 'admin'),
  );

  // The public client-facing quote/invoice links (PublicQuote.jsx,
  // PublicInvoice.jsx) render no header of their own and rely entirely on
  // this shared Navbar — but they're meant for an external client with no
  // account, so the "Log in" button there is just noise (or worse, an
  // invitation to poke at staff-only auth) rather than a useful action.
  const isPublicDocLink = location.pathname.startsWith('/q/') || location.pathname.startsWith('/i/');

  function handleLogout() {
    setMenuOpen(false);
    logout();
    navigate('/');
  }

  function isActive(to) {
    return location.pathname === to || location.pathname.startsWith(`${to}/`);
  }

  return (
    <header
      className="border-b border-slate-200 bg-white/80 backdrop-blur sticky top-0 z-10 dark:border-slate-800 dark:bg-slate-950/80"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <nav className="flex w-full items-center justify-between gap-4 px-4 py-3 sm:px-6 xl:px-8 sm:py-4">
        <Link to="/" className="shrink-0 text-base font-semibold text-slate-900 sm:text-lg dark:text-white">
          EduSolution<span className="text-lagoon-600">.com</span>
        </Link>

        {user ? (
          <>
            {/* Desktop links. min-w-0 lets this group shrink to fit whatever
                room the nav row actually has instead of forcing the page
                wider; the link list itself is the one segment that scrolls
                internally (overflow-x-auto) if it still doesn't fit, so
                search/account/theme/logout stay put and the page never
                grows a horizontal scrollbar. */}
            <div className="hidden min-w-0 flex-1 items-center justify-end gap-3 xl:flex">
              <GlobalSearch className="max-w-[200px] shrink-0 2xl:max-w-[280px]" />
              <kbd
                className="hidden shrink-0 rounded border border-slate-300 px-1.5 py-0.5 text-xs text-slate-400 2xl:block dark:border-slate-600"
                title="Press Cmd/Ctrl+K to open the command palette"
              >
                ⌘K
              </kbd>
              <div className="nav-links-scroll flex min-w-0 items-center gap-2.5 overflow-x-auto py-1">
                {visibleLinks.map((link) => (
                  <Link
                    key={link.to}
                    to={link.to}
                    className={`shrink-0 text-sm font-medium hover:text-slate-900 dark:hover:text-white ${isActive(link.to) ? 'text-lagoon-600' : 'text-slate-700 dark:text-slate-300'}`}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
              <Link
                to="/account"
                className={`shrink-0 text-sm font-medium hover:text-slate-900 dark:hover:text-white ${isActive('/account') ? 'text-lagoon-600' : 'text-slate-700 dark:text-slate-300'}`}
              >
                My account
              </Link>
              <ThemeToggle />
              <button
                onClick={handleLogout}
                className="min-h-11 shrink-0 whitespace-nowrap rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
              >
                Log out
              </button>
            </div>

            {/* Mobile menu toggle. Below `sm` (phones), BottomNav.jsx's tab
                bar + "More" sheet replaces this hamburger entirely — so the
                hamburger itself only renders from `sm` up (tablets), while
                the phone-only search toggle takes its place below `sm`
                (GlobalSearch otherwise only appears inside this drawer or
                the tablet-and-up desktop bar, so phones need their own way
                in). */}
            <div className="flex items-center gap-1 xl:hidden">
              <button
                onClick={() => setPhoneSearchOpen((v) => !v)}
                aria-label={phoneSearchOpen ? 'Close search' : 'Search'}
                aria-expanded={phoneSearchOpen}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-slate-700 sm:hidden dark:text-slate-300"
              >
                {phoneSearchOpen ? <XIcon width={22} height={22} /> : <SearchIcon width={22} height={22} />}
              </button>
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

      {user && menuOpen && (
        <div className="hidden border-t border-slate-200 px-4 py-2 sm:block xl:hidden dark:border-slate-800">
          <div className="py-2">
            <GlobalSearch onNavigate={() => setMenuOpen(false)} />
          </div>
          {visibleLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              onClick={() => setMenuOpen(false)}
              className={`flex min-h-11 items-center text-sm font-medium ${isActive(link.to) ? 'text-lagoon-600' : 'text-slate-700 dark:text-slate-300'}`}
            >
              {link.label}
            </Link>
          ))}
          <Link
            to="/account"
            onClick={() => setMenuOpen(false)}
            className={`flex min-h-11 items-center text-sm font-medium ${isActive('/account') ? 'text-lagoon-600' : 'text-slate-700 dark:text-slate-300'}`}
          >
            My account
          </Link>
          <button
            onClick={handleLogout}
            className="flex min-h-11 w-full items-center text-sm font-medium text-red-600 dark:text-red-400"
          >
            Log out
          </button>
        </div>
      )}
    </header>
  );
}
