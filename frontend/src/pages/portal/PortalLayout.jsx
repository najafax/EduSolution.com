import { useRef, useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { usePortalAuth } from '../../context/PortalAuthContext';
import ThemeToggle from '../../components/ThemeToggle';
import Footer from '../../components/Footer';
import PortalNotificationCenter from '../../components/portal/PortalNotificationCenter';
import { HomeIcon, QuoteIcon, InvoiceIcon, LicenseIcon, LogoutIcon, UserIcon, HelpCircleIcon } from '../../components/icons';

const NAV_LINKS = [
  { to: '/portal/dashboard', label: 'Dashboard', icon: HomeIcon },
  { to: '/portal/quotes', label: 'Quotes', icon: QuoteIcon },
  { to: '/portal/invoices', label: 'Invoices', icon: InvoiceIcon },
  { to: '/portal/licenses', label: 'Licenses', icon: LicenseIcon },
];

// A small popover, same outside-click-to-close pattern as
// PortalNotificationCenter, showing the business's own phone/email (from
// business_settings, already fetched by PortalAuthContext for every portal
// page) so a client with a question doesn't have to go hunting for how to
// reach the business — no new backend route needed, this is data the
// portal already has in memory. Renders nothing (not even the button) if
// the business hasn't filled in either field, so an unconfigured business
// doesn't show a pointless empty popover.
function NeedHelp() {
  const { settings } = usePortalAuth();
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!settings?.phone && !settings?.email) return null;

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Need help?"
        className="flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
      >
        <HelpCircleIcon width={18} height={18} />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-64 rounded-md border border-slate-200 bg-white p-4 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <p className="font-semibold text-slate-900 dark:text-white">Need help?</p>
          <p className="mt-1 text-slate-500 dark:text-slate-400">
            {settings.business_name ? `Get in touch with ${settings.business_name}:` : 'Get in touch with us:'}
          </p>
          <div className="mt-2 flex flex-col gap-1">
            {settings.phone && (
              <a href={`tel:${settings.phone}`} className="text-lagoon-600 hover:text-lagoon-500 dark:text-lagoon-400">
                {settings.phone}
              </a>
            )}
            {settings.email && (
              <a href={`mailto:${settings.email}`} className="text-lagoon-600 hover:text-lagoon-500 dark:text-lagoon-400">
                {settings.email}
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

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
    navigate('/login');
  }

  function isActive(to) {
    return location.pathname === to || location.pathname.startsWith(`${to}/`);
  }

  return (
    <div className="flex min-h-screen flex-col bg-white dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-6">
            <Link to="/portal/dashboard" className="font-bold text-slate-900 dark:text-white">
              EDU SOLUTIONS
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
            <PortalNotificationCenter />
            <NeedHelp />
            <Link
              to="/portal/account"
              title="My account"
              aria-label="My account"
              className={`flex h-9 w-9 items-center justify-center rounded-md ${
                isActive('/portal/account')
                  ? 'bg-lagoon-50 text-lagoon-700 dark:bg-lagoon-950 dark:text-lagoon-400'
                  : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <UserIcon width={18} height={18} />
            </Link>
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
