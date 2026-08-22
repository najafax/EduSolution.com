import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import GlobalSearch from './GlobalSearch';
import ThemeToggle from './ThemeToggle';
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
  '/financials': BankIcon,
  '/reports': ReportIcon,
  '/activity': HistoryIcon,
  '/users': UsersIcon,
  '/email-center': SendIcon,
  '/settings': SettingsIcon,
};

// The app's persistent desktop navigation (xl: and up) — replaces the old
// top Navbar's own desktop link row (see Navbar.jsx, which now only
// renders the phone/tablet header below that breakpoint). Search, the
// nav list, and account/theme/logout all live in one place here rather
// than a separate top bar repeated on every page, the same shape most
// dense B2B dashboards (Notion, Linear, Vercel) already use — it also
// means no per-page changes were needed to adopt this layout.
export default function Sidebar() {
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  if (!user) return null;

  const visibleLinks = BUSINESS_LINKS.filter(
    (link) => (!link.module || can(link.module, 'view')) && (!link.adminOnly || user?.role === 'admin'),
  );

  function isActive(to) {
    return location.pathname === to || location.pathname.startsWith(`${to}/`);
  }

  function handleLogout() {
    logout();
    navigate('/');
  }

  const initials = (user.name || user.email || '?')
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <aside
      className="hidden shrink-0 bg-lagoon-950 px-3 py-5 xl:sticky xl:top-0 xl:flex xl:h-screen xl:w-60 xl:flex-col"
      style={{ paddingTop: 'calc(1.25rem + env(safe-area-inset-top))' }}
    >
      <Link to="/" className="mb-5 shrink-0 px-2 text-base font-semibold text-white">
        EduSolution<span className="text-lagoon-300">.com</span>
      </Link>

      <div className="mb-3 shrink-0 px-1">
        <GlobalSearch className="w-full" />
      </div>

      <nav className="nav-links-scroll flex flex-1 flex-col gap-0.5 overflow-y-auto">
        {visibleLinks.map((link) => {
          const Icon = LINK_ICONS[link.to] || HomeIcon;
          const active = isActive(link.to);
          return (
            <Link
              key={link.to}
              to={link.to}
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

      <div className="mt-3 flex shrink-0 items-center justify-between gap-2 border-t border-white/10 px-1 pt-3">
        <Link to="/account" className="flex min-w-0 items-center gap-2 rounded-lg py-1 hover:bg-white/5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-lagoon-600 text-xs font-bold text-white">
            {initials}
          </span>
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
    </aside>
  );
}
