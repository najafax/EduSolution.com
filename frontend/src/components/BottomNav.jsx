import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Sidebar from './Sidebar';
import { HomeIcon, InvoiceIcon, QuoteIcon, UsersIcon, LicenseIcon, MenuIcon } from './icons';

// The five most-used destinations get a permanent bottom tab (phone-only —
// see App.jsx, this replaces the hamburger menu below the `sm` breakpoint
// only; tablets/desktop keep Navbar.jsx's own nav). The sixth tab opens
// Sidebar.jsx itself as a slide-in drawer — the exact same drawer
// Navbar.jsx's own tablet hamburger opens (same links/icons/search/account
// row as the persistent desktop sidebar) — rather than the flatter
// BottomSheet link-list this tab used to open; that gave phones the app's
// full navigation instead of a "More"-only subset.
const PRIMARY_TABS = [
  { to: '/dashboard', label: 'Home', module: null, Icon: HomeIcon },
  { to: '/invoices', label: 'Invoices', module: 'invoices', Icon: InvoiceIcon },
  { to: '/quotes', label: 'Quotes', module: 'quotes', Icon: QuoteIcon },
  { to: '/clients', label: 'Clients', module: 'clients', Icon: UsersIcon },
  { to: '/licenses', label: 'Licenses', module: 'licenses', Icon: LicenseIcon },
];

export default function BottomNav() {
  const { can } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const tabs = PRIMARY_TABS.filter((t) => !t.module || can(t.module, 'view'));

  function isActive(to) {
    return location.pathname === to || location.pathname.startsWith(`${to}/`);
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
          onClick={() => setMenuOpen(true)}
          aria-label="Open menu"
          aria-expanded={menuOpen}
          className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[10.5px] font-bold text-slate-500 dark:text-slate-400"
        >
          <span className="flex h-6 w-9 items-center justify-center rounded-lg">
            <MenuIcon width={19} height={19} />
          </span>
          Menu
        </button>
      </nav>

      {/* Only mounted while actually open, same as every other popup in this
          app (Modal.jsx, the old BottomSheet) — no reason to keep Sidebar's
          own GlobalSearch instance and effects alive in the background. */}
      {menuOpen && <Sidebar mobileOpen onMobileClose={() => setMenuOpen(false)} />}
    </>
  );
}
