import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import GlobalSearch from './GlobalSearch';
import ThemeToggle from './ThemeToggle';

// `module: null` means always visible to any logged-in user regardless of
// permissions (Dashboard). Everything else is filtered by that module's
// view permission so a restricted user never sees a link leading to a 403
// — enforcement itself still happens server-side; this is just UX.
export const BUSINESS_LINKS = [
  { to: '/dashboard', label: 'Dashboard', module: null },
  { to: '/clients', label: 'Clients', module: 'clients' },
  { to: '/products', label: 'Products', module: 'products' },
  { to: '/quotes', label: 'Quotes', module: 'quotes' },
  { to: '/invoices', label: 'Invoices', module: 'invoices' },
  { to: '/recurring-invoices', label: 'Recurring', module: 'recurring_invoices' },
  { to: '/expenses', label: 'Expenses', module: 'expenses' },
  { to: '/financials', label: 'Financials', module: 'financials' },
  { to: '/reports', label: 'Reports', module: 'financials' },
  { to: '/activity', label: 'Activity', module: 'activity' },
  { to: '/users', label: 'Users', module: 'users' },
  { to: '/settings', label: 'Settings', module: 'settings' },
];

export default function Navbar() {
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const visibleLinks = BUSINESS_LINKS.filter((link) => !link.module || can(link.module, 'view'));

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
          EduSolution<span className="text-indigo-600">.com</span>
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
              <GlobalSearch className="max-w-[110px] shrink-0 2xl:max-w-[220px]" />
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
                    className={`shrink-0 text-sm font-medium hover:text-slate-900 dark:hover:text-white ${isActive(link.to) ? 'text-indigo-600' : 'text-slate-700 dark:text-slate-300'}`}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
              <Link
                to="/account"
                className={`shrink-0 text-sm font-medium hover:text-slate-900 dark:hover:text-white ${isActive('/account') ? 'text-indigo-600' : 'text-slate-700 dark:text-slate-300'}`}
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

            {/* Mobile menu toggle */}
            <div className="flex items-center gap-1 xl:hidden">
              <ThemeToggle />
              <button
                onClick={() => setMenuOpen((v) => !v)}
                aria-label="Toggle menu"
                aria-expanded={menuOpen}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-slate-700 dark:text-slate-300"
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
            <Link
              to="/login"
              className="flex min-h-11 items-center rounded-md bg-indigo-600 px-3 text-sm font-medium text-white hover:bg-indigo-500 sm:px-4"
            >
              Log in
            </Link>
          </div>
        )}
      </nav>

      {user && menuOpen && (
        <div className="border-t border-slate-200 px-4 py-2 xl:hidden dark:border-slate-800">
          <div className="py-2">
            <GlobalSearch onNavigate={() => setMenuOpen(false)} />
          </div>
          {visibleLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              onClick={() => setMenuOpen(false)}
              className={`flex min-h-11 items-center text-sm font-medium ${isActive(link.to) ? 'text-indigo-600' : 'text-slate-700 dark:text-slate-300'}`}
            >
              {link.label}
            </Link>
          ))}
          <Link
            to="/account"
            onClick={() => setMenuOpen(false)}
            className={`flex min-h-11 items-center text-sm font-medium ${isActive('/account') ? 'text-indigo-600' : 'text-slate-700 dark:text-slate-300'}`}
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
