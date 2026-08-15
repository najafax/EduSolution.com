import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import GlobalSearch from './GlobalSearch';

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
      className="border-b border-slate-200 bg-white/80 backdrop-blur sticky top-0 z-10"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6 sm:py-4">
        <Link to="/" className="shrink-0 text-base font-semibold text-slate-900 sm:text-lg">
          EduSolution<span className="text-indigo-600">.com</span>
        </Link>

        {user ? (
          <>
            {/* Desktop links */}
            <div className="hidden items-center gap-5 lg:flex">
              <GlobalSearch className="max-w-[180px] xl:max-w-[220px]" />
              <kbd
                className="hidden shrink-0 rounded border border-slate-300 px-1.5 py-0.5 text-xs text-slate-400 xl:block"
                title="Press Cmd/Ctrl+K to open the command palette"
              >
                ⌘K
              </kbd>
              {visibleLinks.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  className={`text-sm font-medium hover:text-slate-900 ${isActive(link.to) ? 'text-indigo-600' : 'text-slate-700'}`}
                >
                  {link.label}
                </Link>
              ))}
              <Link
                to="/account"
                className={`text-sm font-medium hover:text-slate-900 ${isActive('/account') ? 'text-indigo-600' : 'text-slate-700'}`}
              >
                My account
              </Link>
              <button
                onClick={handleLogout}
                className="min-h-11 shrink-0 whitespace-nowrap rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-700"
              >
                Log out
              </button>
            </div>

            {/* Mobile menu toggle */}
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Toggle menu"
              aria-expanded={menuOpen}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-slate-700 lg:hidden"
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
          </>
        ) : (
          <div className="flex items-center gap-2 sm:gap-4">
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
        <div className="border-t border-slate-200 px-4 py-2 lg:hidden">
          <div className="py-2">
            <GlobalSearch onNavigate={() => setMenuOpen(false)} />
          </div>
          {visibleLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              onClick={() => setMenuOpen(false)}
              className={`flex min-h-11 items-center text-sm font-medium ${isActive(link.to) ? 'text-indigo-600' : 'text-slate-700'}`}
            >
              {link.label}
            </Link>
          ))}
          <Link
            to="/account"
            onClick={() => setMenuOpen(false)}
            className={`flex min-h-11 items-center text-sm font-medium ${isActive('/account') ? 'text-indigo-600' : 'text-slate-700'}`}
          >
            My account
          </Link>
          <button
            onClick={handleLogout}
            className="flex min-h-11 w-full items-center text-sm font-medium text-red-600"
          >
            Log out
          </button>
        </div>
      )}
    </header>
  );
}
