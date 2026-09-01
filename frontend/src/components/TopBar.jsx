import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import GlobalSearch from './GlobalSearch';
import ThemeToggle from './ThemeToggle';
import NotificationCenter from './NotificationCenter';
import { LogoutIcon } from './icons';

// The desktop (`xl:` and up) counterpart to Navbar.jsx's mobile/tablet
// header — Sidebar.jsx carries the wordmark and nav links at this
// breakpoint (see its own top-of-file note), so this bar exists purely
// for the controls that used to live in the sidebar's own top/bottom rows
// — search, notifications, theme, and account/logout — before they moved
// up here at explicit request. `hidden xl:flex` is the exact mirror of
// Navbar's own `xl:hidden`, so exactly one of the two headers ever
// renders for a given viewport width. Unlike Sidebar's own dark
// `bg-lagoon-950` panel, this sits on the app's normal themed page
// background, so GlobalSearch/NotificationCenter/ThemeToggle all use
// their default styling with no `!important` overrides — those only
// exist on the Sidebar's own instances to fight that dark panel
// specifically.
export default function TopBar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  if (!user) return null;

  const initials = (user.name || user.email || '?')
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  function handleLogout() {
    logout();
    navigate('/');
  }

  return (
    <header
      className="sticky top-0 z-10 hidden border-b border-slate-200 bg-white/80 backdrop-blur xl:flex dark:border-slate-800 dark:bg-slate-950/80"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="flex w-full items-center justify-between gap-4 px-6 py-3">
        <GlobalSearch className="max-w-sm" />
        <div className="flex shrink-0 items-center gap-1">
          <NotificationCenter />
          <ThemeToggle />
          <Link
            to="/account"
            className="ml-1 flex min-w-0 shrink-0 items-center gap-2 rounded-full py-1 pl-1 pr-3 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {user.avatarImage ? (
              <img src={user.avatarImage} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
            ) : (
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-lagoon-600 text-xs font-bold text-white">
                {initials}
              </span>
            )}
            <span className="max-w-[10rem] truncate text-sm font-medium text-slate-700 dark:text-slate-200">
              {user.name}
            </span>
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            aria-label="Log out"
            title="Log out"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <LogoutIcon width={18} height={18} />
          </button>
        </div>
      </div>
    </header>
  );
}
