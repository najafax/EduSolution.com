import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import GlobalSearch from './GlobalSearch';
import ThemeToggle from './ThemeToggle';
import NotificationCenter from './NotificationCenter';
import { BUSINESS_LINKS } from './Navbar';
import {
  HomeIcon,
  UsersIcon,
  MegaphoneIcon,
  ProductIcon,
  QuoteIcon,
  InboxIcon,
  InvoiceIcon,
  RefreshIcon,
  LicenseIcon,
  ExpenseIcon,
  BankIcon,
  ReportIcon,
  HistoryIcon,
  SendIcon,
  SettingsIcon,
  LogoutIcon,
  ClipboardCheckIcon,
} from './icons';

// One icon per BUSINESS_LINKS entry (see Navbar.jsx) — a few modules
// reuse an icon that already carries a close-enough meaning elsewhere in
// the app (Capital/Users both reuse UsersIcon, matching Financials.jsx's
// own precedent of using UsersIcon for the Capital Contributions KPI
// card) rather than inventing a new glyph for every single link.
const LINK_ICONS = {
  '/dashboard': HomeIcon,
  '/clients': UsersIcon,
  '/campaigns': MegaphoneIcon,
  '/products': ProductIcon,
  '/quotes': QuoteIcon,
  '/quote-requests': InboxIcon,
  '/invoices': InvoiceIcon,
  '/recurring-invoices': RefreshIcon,
  '/licenses': LicenseIcon,
  '/expenses': ExpenseIcon,
  '/capital-contributions': UsersIcon,
  '/owner-draws': BankIcon,
  '/financials': BankIcon,
  '/reports': ReportIcon,
  '/activity': HistoryIcon,
  '/users': UsersIcon,
  '/email-center': SendIcon,
  '/mod-reports': ClipboardCheckIcon,
  '/settings': SettingsIcon,
};

// The app's persistent desktop navigation (xl: and up) — replaces the old
// top Navbar's own desktop link row (see Navbar.jsx, which now only
// renders the phone/tablet header below that breakpoint). At this
// breakpoint the sidebar is nav-links-only (wordmark + link list) —
// search, notifications, theme, and account/logout moved to
// `components/TopBar.jsx` (a new xl:-only header sitting alongside the
// routed content, see that file) at explicit request, so they're only
// rendered here in the tablet/phone drawer below, not in the persistent
// `mobileOpen`-false instance.
//
// Below `xl:`, this same component doubles as the tablet/phone nav drawer
// — Navbar.jsx's own hamburger, top-left in the header at every width below
// `xl:` (phones included), toggles `mobileOpen`, which switches this from
// its default `hidden` state to a `fixed` slide-in panel (plus a backdrop)
// rather than the flat link-list dropdown this app used before. The `xl:`
// classes below are untouched either way, so the persistent desktop
// sidebar keeps working exactly as it did — only the below-`xl:` styling
// branches on `mobileOpen`. Search/notifications/account row (see above)
// stay in the drawer specifically because `TopBar.jsx`, their new home,
// is itself `xl:`-only — a tablet/phone user has no other route to them,
// so the drawer keeps carrying the full experience `mobileOpen` already
// implies (the exact same content it always rendered), only the
// `mobileOpen: false` persistent case lost anything here.
export default function Sidebar({ mobileOpen = false, onMobileClose }) {
  const { user, logout, can, isSuperAdmin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Same Escape-to-close + body-scroll-lock contract as Modal.jsx —
  // mobileOpen is only ever true for the drawer instance (Navbar.jsx mounts
  // this component fresh each time its hamburger opens it), so there's no
  // risk of this stepping on the persistent desktop sidebar, which never
  // sets mobileOpen at all.
  useEffect(() => {
    if (!mobileOpen) return;
    function handleKeyDown(e) {
      if (e.key === 'Escape') onMobileClose?.();
    }
    document.addEventListener('keydown', handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileOpen, onMobileClose]);

  if (!user) return null;

  const visibleLinks = BUSINESS_LINKS.filter(
    (link) => (!link.module || can(link.module, 'view')) && (!link.superAdminOnly || isSuperAdmin),
  );

  function isActive(to) {
    return location.pathname === to || location.pathname.startsWith(`${to}/`);
  }

  function handleLogout() {
    onMobileClose?.();
    logout();
    navigate('/');
  }

  function handleLinkClick() {
    onMobileClose?.();
  }

  const initials = (user.name || user.email || '?')
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const content = (
    <>
      {/* Backdrop, mobile/tablet drawer mode only — clicking it closes the
          drawer the same way Modal.jsx's own backdrop click does. Never
          rendered at `xl:` since the drawer itself is inert there. */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/50 xl:hidden"
          onClick={onMobileClose}
          aria-hidden="true"
        />
      )}
      <aside
        className={`${mobileOpen ? 'fixed inset-y-0 left-0 z-40 flex w-72 flex-col' : 'hidden'} shrink-0 bg-lagoon-950 px-3 py-5 shadow-2xl xl:sticky xl:top-0 xl:z-auto xl:flex xl:h-screen xl:w-60 xl:flex-col xl:shadow-none`}
        style={{ paddingTop: 'calc(1.25rem + env(safe-area-inset-top))' }}
      >
        <div className="mb-5 flex shrink-0 items-center justify-between px-2">
          <Link to="/" onClick={handleLinkClick} className="text-base font-semibold text-white">
            edusolutionsmaldives<span className="text-lagoon-300">.com</span>
          </Link>
          <div className="flex shrink-0 items-center gap-0.5">
            {/* Notification bell, drawer mode only — see this file's own
                top-of-file note: the persistent desktop instance no longer
                carries this at all, it lives in TopBar.jsx now. Same
                forced-light-icon override reasoning as ThemeToggle's own
                Sidebar usage below — its default slate styling is tuned for
                the app's themed page background, not this permanently-dark
                panel. */}
            {mobileOpen && (
              <NotificationCenter align="left" className="!text-lagoon-200 hover:!bg-white/10 hover:!text-white" />
            )}
            {/* Close button, drawer mode only — the backdrop click and Escape
                (see the effect above) also close it, but a visible control
                matters here since there's no other affordance in-panel. */}
            <button
              type="button"
              onClick={onMobileClose}
              aria-label="Close menu"
              className="flex h-9 w-9 items-center justify-center rounded-md text-lagoon-200 hover:bg-white/10 hover:text-white xl:hidden"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        {/* Search, drawer mode only — see this file's own top-of-file note:
            the persistent desktop instance no longer carries this at all,
            it lives in TopBar.jsx now. GlobalSearch's own dark: styling is
            tuned for the app's themed page background, not this
            permanently-dark bg-lagoon-950 panel — stacked with the app's
            own dark theme it read as barely-visible dark-on-dark. These
            overrides force a light input regardless of app theme, since
            `!important` is needed to beat GlobalSearch's own hardcoded
            classes (its `className` prop only reaches the outer wrapper,
            not the nested <input>). */}
        {mobileOpen && (
          <div className="mb-3 shrink-0 px-1 [&_input]:!border-lagoon-200 [&_input]:!bg-white [&_input]:!text-slate-900 [&_input]:!shadow-sm [&_input::placeholder]:!text-slate-400">
            <GlobalSearch className="w-full" onNavigate={handleLinkClick} />
          </div>
        )}

        <nav className="nav-links-scroll flex flex-1 flex-col gap-0.5 overflow-y-auto">
          {visibleLinks.map((link) => {
            const Icon = LINK_ICONS[link.to] || HomeIcon;
            const active = isActive(link.to);
            return (
              <Link
                key={link.to}
                to={link.to}
                onClick={handleLinkClick}
                className={`flex min-h-9 shrink-0 items-center gap-2.5 rounded-lg px-3 text-[13.5px] font-medium ${
                  active ? 'bg-lagoon-600 text-white' : 'text-lagoon-100/80 hover:bg-white/5 hover:text-white'
                }`}
              >
                <Icon width={17} height={17} className="shrink-0" />
                {link.label}
              </Link>
            );
          })}
        </nav>

        {/* Account row, drawer mode only — see this file's own top-of-file
            note: the persistent desktop instance no longer carries the
            avatar/theme/logout cluster at all, it lives in TopBar.jsx now. */}
        {mobileOpen && (
          <div className="mt-3 flex shrink-0 items-center justify-between gap-2 border-t border-white/10 px-1 pt-3">
            <Link
              to="/account"
              onClick={handleLinkClick}
              className="flex min-w-0 items-center gap-2 rounded-lg py-1 hover:bg-white/5"
            >
              {user.avatarImage ? (
                <img src={user.avatarImage} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
              ) : (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-lagoon-600 text-xs font-bold text-white">
                  {initials}
                </span>
              )}
              <span className="min-w-0 truncate text-xs font-medium text-white">{user.name}</span>
            </Link>
            <div className="flex shrink-0 items-center gap-0.5">
              <ThemeToggle className="!min-h-9 !min-w-9 !text-lagoon-200 hover:!bg-white/10 hover:!text-white" />
              <button
                type="button"
                onClick={handleLogout}
                aria-label="Log out"
                title="Log out"
                className="flex h-9 w-9 items-center justify-center rounded-md text-lagoon-200 hover:bg-white/10 hover:text-white"
              >
                <LogoutIcon width={17} height={17} />
              </button>
            </div>
          </div>
        )}
      </aside>
    </>
  );

  // Navbar.jsx's <header> has `backdrop-blur` (backdrop-filter), which per
  // spec establishes a new containing block for `position: fixed`
  // descendants — same as `filter` — so a fixed-position drawer nested
  // inside it would position itself relative to the header's own (much
  // shorter) box instead of the viewport. Portaling straight to
  // document.body sidesteps that entirely. Only needed in drawer mode: the
  // persistent desktop sidebar (mobileOpen false, rendered by App.jsx as a
  // header-independent sibling) has no such ancestor and renders inline as
  // before, so its position in the DOM — and anything relying on it,
  // like the `.nav-links-scroll` CSS — is unaffected.
  return mobileOpen ? createPortal(content, document.body) : content;
}
