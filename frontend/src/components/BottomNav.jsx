import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { HomeIcon, InvoiceIcon, QuoteIcon, UsersIcon, LicenseIcon, SettingsIcon } from './icons';

// The six most-used destinations get a permanent bottom tab (phone-only —
// see App.jsx, this replaces the hamburger menu below the `sm` breakpoint
// only; tablets/desktop keep Navbar.jsx's own nav). Full navigation (every
// other link, search, the account row, theme toggle, logout) lives behind
// Navbar.jsx's own hamburger, in the top-left corner of the header at every
// width below `xl:` — this bar carries only these shortcuts, not a mirror
// of that trigger, so there's exactly one way to reach the rest of the nav.
// Settings joined the original five (Home/Invoices/Quotes/Clients/Licenses)
// on its own explicit request — it's reached often enough on a phone (the
// business's own branding/bank details/session policy) to be worth a
// permanent tab rather than living only in the hamburger drawer.
const PRIMARY_TABS = [
  { to: '/dashboard', label: 'Home', module: null, Icon: HomeIcon },
  { to: '/invoices', label: 'Invoices', module: 'invoices', Icon: InvoiceIcon },
  { to: '/quotes', label: 'Quotes', module: 'quotes', Icon: QuoteIcon },
  { to: '/clients', label: 'Clients', module: 'clients', Icon: UsersIcon },
  { to: '/licenses', label: 'Licenses', module: 'licenses', Icon: LicenseIcon },
  { to: '/settings', label: 'Settings', module: 'settings', Icon: SettingsIcon },
];

export default function BottomNav() {
  const { can } = useAuth();
  const location = useLocation();

  const tabs = PRIMARY_TABS.filter((t) => !t.module || can(t.module, 'view'));

  function isActive(to) {
    return location.pathname === to || location.pathname.startsWith(`${to}/`);
  }

  return (
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
    </nav>
  );
}
