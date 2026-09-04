import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import ThemeToggle from '../../components/ThemeToggle';
import { MenuIcon, XIcon } from '../../components/icons';
import { useEdgeSwipeOpen } from '../../lib/useEdgeSwipeOpen';

// The shared header for the public marketing site (/, /services,
// /tutorials, /testimonials, /news, /about, /contact) — deliberately separate from the internal app's own
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
  { to: '/tutorials', label: 'Tutorials' },
  { to: '/testimonials', label: 'Testimonials' },
  { to: '/news', label: 'News' },
  { to: '/about', label: 'About' },
  { to: '/contact', label: 'Contact' },
];

// This drawer is the mobile-nav counterpart of the internal app's own
// Sidebar.jsx in its `mobileOpen` mode — same contract (Escape-to-close,
// body-scroll-lock while open, portal straight to document.body since
// MarketingLayout's own <header> below carries `backdrop-blur`, which per
// spec gives `position: fixed` descendants a new containing block, so a
// drawer nested inside it would size itself against the header's own
// ~56px box instead of the viewport — see Sidebar.jsx's own note on this
// exact bug) — just with this site's own seven nav links instead of
// BUSINESS_LINKS, and no account/search cluster, since a marketing-site
// visitor isn't signed in as staff. Only ever rendered below `sm:` in
// practice (the hamburger that opens it, and the edge-swipe gesture below,
// are both gated to that same breakpoint), but the backdrop/panel carry
// their own `sm:hidden` too so a mid-open browser resize past `sm:` can't
// strand a mobile-only drawer open over the desktop nav.
function MobileMenu({ open, onClose, token }) {
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-30 bg-slate-900/50 sm:hidden" onClick={onClose} aria-hidden="true" />
      <aside
        className="fixed inset-y-0 left-0 z-40 flex w-72 flex-col bg-white px-3 py-5 shadow-2xl dark:bg-slate-950 sm:hidden"
        style={{ paddingTop: 'calc(1.25rem + env(safe-area-inset-top))' }}
      >
        <div className="mb-5 flex shrink-0 items-center justify-between px-2">
          <Link to="/" onClick={onClose} className="flex items-center gap-1.5 text-base font-semibold text-slate-900 dark:text-white">
            <img src="/logo-symbol.png" alt="" className="h-6 w-6" />
            Edu Solutions
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <XIcon width={20} height={20} />
          </button>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
          {NAV_LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === '/'}
              onClick={onClose}
              className={({ isActive }) =>
                `flex min-h-11 shrink-0 items-center rounded-lg px-3 font-display text-sm font-semibold ${
                  isActive
                    ? 'bg-lagoon-50 text-lagoon-600 dark:bg-lagoon-950 dark:text-lagoon-400'
                    : 'text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-900'
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-3 shrink-0 border-t border-slate-100 pt-3 dark:border-slate-800">
          <Link
            to={token ? '/dashboard' : '/login'}
            onClick={onClose}
            className="flex min-h-11 items-center justify-center rounded-md bg-lagoon-600 px-4 text-sm font-semibold text-white hover:bg-lagoon-500"
          >
            {token ? 'Dashboard' : 'Login'}
          </Link>
        </div>
      </aside>
    </>,
    document.body,
  );
}

export default function MarketingLayout({ children }) {
  const { token } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  // Swipe in from the left edge opens the same drawer the hamburger does —
  // the same gesture the internal app wires up in Navbar.jsx, just scoped
  // to this site's own `sm:` breakpoint (640px) instead of the staff app's
  // `xl:` one, since that's where this header's own nav switches from the
  // drawer to a plain horizontal link row.
  useEdgeSwipeOpen({ enabled: !menuOpen, onOpen: () => setMenuOpen(true), breakpointPx: 640 });

  return (
    <div className="flex min-h-screen flex-col bg-white dark:bg-slate-950">
      <header className="border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
          {/* Top-left: hamburger (below sm: only — the full link row takes
              over at sm: and up), then the wordmark, mirroring the internal
              app's own Navbar.jsx layout. */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label="Open menu"
              aria-expanded={menuOpen}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-slate-700 dark:text-slate-300 sm:hidden"
            >
              <MenuIcon width={22} height={22} />
            </button>
            <Link to="/" className="flex items-center gap-1.5 sm:gap-2">
              <img src="/logo-symbol.png" alt="" className="h-6 w-6 sm:h-7 sm:w-7" />
              <span className="font-display text-base font-bold text-slate-900 sm:text-lg dark:text-white">Edu Solutions</span>
            </Link>
          </div>
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
          {/* Login/Dashboard is always visible now, at every width — it used
              to be `hidden sm:flex` (reachable on mobile only by scrolling
              to the end of a horizontal link strip below), which is exactly
              the "have to scroll to find the button" gap this fixes. */}
          <div className="flex items-center gap-2 sm:gap-3">
            <ThemeToggle />
            <Link
              to={token ? '/dashboard' : '/login'}
              className="flex min-h-9 items-center rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {token ? 'Dashboard' : 'Login'}
            </Link>
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <MobileMenu open={menuOpen} onClose={() => setMenuOpen(false)} token={token} />
    </div>
  );
}
