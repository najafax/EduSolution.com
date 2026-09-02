import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import ThemeToggle from '../../components/ThemeToggle';

// The shared header for the public marketing site (/, /services,
// /testimonials, /news, /about, /contact) — deliberately separate from the internal app's own
// Navbar/Sidebar/TopBar, which list business-management modules (Clients,
// Invoices, Licenses, ...) that mean nothing to an outside visitor. App.jsx
// skips that whole staff shell for these exact routes, the same way it
// already skips it for /portal/* — see App.jsx's own isMarketingRoute note.
// The shared, staff-context-free `Footer` component still renders below
// this on every one of these pages (App.jsx mounts it once, unconditionally
// outside the portal check), so only the header needed a marketing-specific
// version.
const NAV_LINKS = [
  { to: '/', label: 'Home' },
  { to: '/services', label: 'Services' },
  { to: '/testimonials', label: 'Testimonials' },
  { to: '/news', label: 'News' },
  { to: '/about', label: 'About' },
  { to: '/contact', label: 'Contact' },
];

export default function MarketingLayout({ children }) {
  const { token } = useAuth();

  return (
    <div className="flex min-h-screen flex-col bg-white dark:bg-slate-950">
      <header className="border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link to="/" className="flex items-center gap-2">
            <img src="/logo-symbol.png" alt="" className="h-7 w-7" />
            <span className="font-display text-lg font-bold text-slate-900 dark:text-white">Edu Solutions</span>
          </Link>
          <nav className="hidden items-center gap-7 sm:flex">
            {NAV_LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.to === '/'}
                className={({ isActive }) =>
                  `font-display text-sm font-semibold ${
                    isActive ? 'text-lagoon-600 dark:text-lagoon-400' : 'text-slate-700 hover:text-lagoon-600 dark:text-slate-300 dark:hover:text-lagoon-400'
                  }`
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link
              to={token ? '/dashboard' : '/login'}
              className="hidden min-h-9 items-center rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800 sm:flex"
            >
              {token ? 'Dashboard' : 'Login'}
            </Link>
          </div>
        </div>
        {/* Below sm, the nav row collapses to a scrollable strip rather than a
            hamburger drawer — four links never need one. */}
        <div className="flex gap-5 overflow-x-auto border-t border-slate-100 px-4 py-2.5 dark:border-slate-800 sm:hidden">
          {NAV_LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === '/'}
              className={({ isActive }) =>
                `shrink-0 font-display text-sm font-semibold ${
                  isActive ? 'text-lagoon-600 dark:text-lagoon-400' : 'text-slate-600 dark:text-slate-400'
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
          <Link to={token ? '/dashboard' : '/login'} className="shrink-0 font-display text-sm font-semibold text-slate-600 dark:text-slate-400">
            {token ? 'Dashboard' : 'Login'}
          </Link>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
