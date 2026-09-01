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
      // A floating "liquid glass" dock rather than the old flush, flat,
      // near-opaque bar: detached from the screen edges (inset-x-3, a
      // margin-driven `bottom` instead of `inset-x-0 bottom-0`), heavily
      // blurred and translucent so the page scrolling underneath stays
      // faintly visible, rounded into a pill, and edged with a soft
      // lagoon-tinted glow (shadow-[...]) so it reads as floating above
      // the content rather than sitting flush against it — the material
      // this app's own nautical/lagoon branding calls for. `overflow-hidden`
      // clips the two decorative sheen layers below to the rounded corners.
      className="fixed inset-x-3 z-30 flex items-stretch justify-around gap-0.5 overflow-hidden rounded-[28px] border border-white/50 bg-white/70 p-1 shadow-[0_10px_30px_-8px_rgba(14,124,134,0.45)] backdrop-blur-2xl sm:hidden dark:border-white/10 dark:bg-slate-900/70 dark:shadow-[0_10px_30px_-10px_rgba(0,0,0,0.6)]"
      style={{ bottom: 'calc(0.875rem + env(safe-area-inset-bottom))' }}
    >
      {/* Glossy top-edge highlight — light catching a curved glass/water
          surface, the one detail that sells "liquid glass" rather than
          plain frosted glass. Purely decorative (aria-hidden,
          pointer-events-none) and static, no shimmer/animation, matching
          this app's own "avoid excessive motion" convention. */}
      <div
        className="pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-white/90 to-transparent dark:via-white/40"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-white/50 to-transparent dark:from-white/10"
        aria-hidden="true"
      />
      {tabs.map(({ to, label, Icon }) => {
        const active = isActive(to);
        return (
          <Link
            key={to}
            to={to}
            className={`relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-[22px] text-[10.5px] font-bold ${active ? 'text-lagoon-700 dark:text-lagoon-300' : 'text-slate-600 dark:text-slate-300'}`}
          >
            <span
              className={`flex h-6 w-9 items-center justify-center rounded-full transition-colors ${active ? 'bg-white/80 shadow-[0_1px_5px_rgba(14,124,134,0.4)] dark:bg-lagoon-400/20' : ''}`}
            >
              <Icon width={19} height={19} />
            </span>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
