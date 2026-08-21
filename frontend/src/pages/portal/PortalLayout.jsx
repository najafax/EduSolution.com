import { Link, useLocation, useNavigate } from 'react-router-dom';
import { usePortalAuth } from '../../context/PortalAuthContext';
import ThemeToggle from '../../components/ThemeToggle';
import Footer from '../../components/Footer';
import { HomeIcon, QuoteIcon, InvoiceIcon, LicenseIcon, LogoutIcon } from '../../components/icons';

const NAV_LINKS = [
  { to: '/portal/dashboard', label: 'Dashboard', icon: HomeIcon },
  { to: '/portal/quotes', label: 'Quotes', icon: QuoteIcon },
  { to: '/portal/invoices', label: 'Invoices', icon: InvoiceIcon },
  { to: '/portal/licenses', label: 'Licenses', icon: LicenseIcon },
];

// The portal's own header/nav shell — a deliberately separate, simpler
// counterpart to components/Navbar.jsx: a client account has no modules,
// permissions, or business-management links, just its own four read-only
// views, so reusing the staff Navbar (which reads AuthContext/`can()`)
// would be both wrong and impossible here. Every protected portal page
// (see pages/portal/PortalApp.jsx) wraps its content in this.
export default function PortalLayout({ children }) {
  const { account, logout } = usePortalAuth();
  const location = useLocation();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/portal/login');
  }

  function isActive(to) {
    return location.pathname === to || location.pathname.startsWith(`${to}/`);
  }

  return (
    <div className="flex min-h-screen flex-col bg-white dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-6">
            <Link to="/portal/dashboard" className="font-bold text-slate-900 dark:text-white">
              EduSolution<span className="text-lagoon-600">.com</span>
              <span className="ml-2 rounded-full bg-lagoon-50 px-2 py-0.5 text-xs font-medium text-lagoon-700 dark:bg-lagoon-950 dark:text-lagoon-400">
                Client portal
              </span>
            </Link>
            <nav className="hidden items-center gap-1 sm:flex">
              {NAV_LINKS.map(({ to, label, icon: Icon }) => (
                <Link
                  key={to}
                  to={to}
                  className={`flex min-h-11 items-center gap-1.5 rounded-md px-3 text-sm font-medium ${
                    isActive(to)
                      ? 'bg-lagoon-50 text-lagoon-700 dark:bg-lagoon-950 dark:text-lagoon-400'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
                  }`}
                >
                  <Icon width={16} height={16} />
                  {label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            {account && <span className="hidden text-sm text-slate-500 dark:text-slate-400 md:inline">{account.clientName}</span>}
            <ThemeToggle />
            <button
              onClick={handleLogout}
              className="flex min-h-11 items-center gap-1.5 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <LogoutIcon width={16} height={16} />
              Log out
            </button>
          </div>
        </div>
        {/* Phone-width nav — the desktop links above are sm:flex; below that
            they collapse into this second row instead of a hamburger drawer,
            since there are only four links total (no search, no overflow
            menu needed the way the staff Navbar's 15+ links require). */}
        <nav className="flex items-center gap-1 overflow-x-auto border-t border-slate-100 px-4 py-1.5 sm:hidden dark:border-slate-900">
          {NAV_LINKS.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className={`flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm font-medium ${
                isActive(to)
                  ? 'bg-lagoon-50 text-lagoon-700 dark:bg-lagoon-950 dark:text-lagoon-400'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              <Icon width={16} height={16} />
              {label}
            </Link>
          ))}
        </nav>
      </header>

      <div className="flex-1">{children}</div>

      <Footer />
    </div>
  );
}
