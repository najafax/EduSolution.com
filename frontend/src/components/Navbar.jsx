import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const BUSINESS_LINKS = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/clients', label: 'Clients' },
  { to: '/quotes', label: 'Quotes' },
  { to: '/invoices', label: 'Invoices' },
  { to: '/financials', label: 'Financials' },
  { to: '/settings', label: 'Settings' },
];

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

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
              {BUSINESS_LINKS.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  className={`text-sm font-medium hover:text-slate-900 ${isActive(link.to) ? 'text-indigo-600' : 'text-slate-700'}`}
                >
                  {link.label}
                </Link>
              ))}
              <button
                onClick={handleLogout}
                className="min-h-11 rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-700"
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
              className="min-h-11 flex items-center px-2 text-sm font-medium text-slate-700 hover:text-slate-900 sm:px-0"
            >
              Log in
            </Link>
            <Link
              to="/signup"
              className="flex min-h-11 items-center rounded-md bg-indigo-600 px-3 text-sm font-medium text-white hover:bg-indigo-500 sm:px-4"
            >
              Sign up
            </Link>
          </div>
        )}
      </nav>

      {user && menuOpen && (
        <div className="border-t border-slate-200 px-4 py-2 lg:hidden">
          {BUSINESS_LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              onClick={() => setMenuOpen(false)}
              className={`flex min-h-11 items-center text-sm font-medium ${isActive(link.to) ? 'text-indigo-600' : 'text-slate-700'}`}
            >
              {link.label}
            </Link>
          ))}
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
