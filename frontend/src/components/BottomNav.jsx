import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import BottomSheet from './BottomSheet';
import { BUSINESS_LINKS } from './Navbar';
import { HomeIcon, InvoiceIcon, QuoteIcon, UsersIcon, LicenseIcon, MoreIcon, ChevronRightIcon, LogoutIcon } from './icons';

// The five most-used destinations get a permanent bottom tab (phone-only —
// see App.jsx, this replaces the hamburger menu below the `sm` breakpoint
// only; tablets/desktop keep Navbar.jsx's own nav). Everything else in
// BUSINESS_LINKS, plus "My account" and "Log out" (same items the old
// mobile drawer held), lives behind "More" so the bar never has to scroll
// or shrink icons to fit.
const PRIMARY_TABS = [
  { to: '/dashboard', label: 'Home', module: null, Icon: HomeIcon },
  { to: '/invoices', label: 'Invoices', module: 'invoices', Icon: InvoiceIcon },
  { to: '/quotes', label: 'Quotes', module: 'quotes', Icon: QuoteIcon },
  { to: '/clients', label: 'Clients', module: 'clients', Icon: UsersIcon },
  { to: '/licenses', label: 'Licenses', module: 'licenses', Icon: LicenseIcon },
];

export default function BottomNav() {
  const { user, can, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);

  const tabs = PRIMARY_TABS.filter((t) => !t.module || can(t.module, 'view'));
  const primaryHrefs = new Set(tabs.map((t) => t.to));
  const moreLinks = BUSINESS_LINKS.filter(
    (link) =>
      link.to !== '/dashboard' &&
      !primaryHrefs.has(link.to) &&
      (!link.module || can(link.module, 'view')) &&
      (!link.adminOnly || user?.role === 'admin'),
  );

  function isActive(to) {
    return location.pathname === to || location.pathname.startsWith(`${to}/`);
  }

  function handleLogout() {
    setMoreOpen(false);
    logout();
    navigate('/');
  }

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-30 flex items-stretch justify-around border-t border-slate-200 bg-white/95 backdrop-blur sm:hidden dark:border-slate-800 dark:bg-slate-950/95"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {tabs.map(({ to, label, Icon }) => {
          const active = isActive(to);
          return (
            <Link
              key={to}
              to={to}
              className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[10.5px] font-bold ${active ? 'text-lagoon-600 dark:text-lagoon-400' : 'text-slate-500 dark:text-slate-400'}`}
            >
              <span className={`flex h-6 w-9 items-center justify-center rounded-lg ${active ? 'bg-lagoon-50 dark:bg-lagoon-950' : ''}`}>
                <Icon width={19} height={19} />
              </span>
              {label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[10.5px] font-bold text-slate-500 dark:text-slate-400"
        >
          <span className="flex h-6 w-9 items-center justify-center rounded-lg">
            <MoreIcon width={19} height={19} />
          </span>
          More
        </button>
      </nav>

      <BottomSheet open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
        <div className="flex flex-col">
          {moreLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              onClick={() => setMoreOpen(false)}
              className="flex min-h-12 items-center justify-between rounded-xl px-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {link.label}
              <ChevronRightIcon width={16} height={16} className="text-slate-300 dark:text-slate-600" />
            </Link>
          ))}
          <Link
            to="/account"
            onClick={() => setMoreOpen(false)}
            className="flex min-h-12 items-center justify-between rounded-xl px-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            My account
            <ChevronRightIcon width={16} height={16} className="text-slate-300 dark:text-slate-600" />
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            className="mt-1 flex min-h-12 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
          >
            <LogoutIcon width={17} height={17} />
            Log out
          </button>
        </div>
      </BottomSheet>
    </>
  );
}
