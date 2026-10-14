import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import GlobalSearch from '../components/GlobalSearch';
import ThemeToggle from '../components/ThemeToggle';
import { BUSINESS_LINKS, GROUP_ORDER } from '../components/Navbar';
import { LINK_ICONS } from '../components/Sidebar';
import { HomeIcon, LogoutIcon, ChevronRightIcon } from '../components/icons';

// The phone "More" destination (bottom bar, components/BottomNav.jsx):
// every page the old drawer listed, in the same groups and under the same
// view-permission filter Sidebar.jsx applies — one source of truth
// (BUSINESS_LINKS), so a link added there shows up here too. Tablet and
// desktop users can open it by URL but have the sidebar, so it's mainly a
// phone screen.
export default function More() {
  const { user, logout, can, isSuperAdmin } = useAuth();
  const navigate = useNavigate();

  const groups = GROUP_ORDER.filter((g) => g !== 'Overview')
    .map((group) => ({
      group,
      links: BUSINESS_LINKS.filter(
        (l) =>
          l.group === group &&
          (!l.module || can(l.module, 'view')) &&
          (!l.superAdminOnly || isSuperAdmin),
      ),
    }))
    .filter((g) => g.links.length > 0);

  const initials = (user?.name || user?.email || '?')
    .trim()
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="water-bg min-h-screen px-4 pb-28 pt-6">
      <h1 className="font-display text-3xl font-extrabold text-slate-900 dark:text-white">More</h1>

      <div className="mt-4">
        <GlobalSearch className="w-full max-w-none" />
      </div>

      <Link
        to="/account"
        className="mt-4 flex min-h-16 items-center gap-3 glass rounded-3xl p-3"
      >
        {user?.avatarImage ? (
          <img src={user.avatarImage} alt="" className="h-11 w-11 rounded-2xl object-cover" />
        ) : (
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-lagoon-50 text-sm font-bold text-lagoon-700 dark:bg-lagoon-950 dark:text-lagoon-300">
            {initials}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-slate-900 dark:text-white">{user?.name}</span>
          <span className="block truncate text-xs text-slate-500 dark:text-slate-400">My account</span>
        </span>
        <ChevronRightIcon width={16} height={16} className="shrink-0 text-slate-400" />
      </Link>

      {groups.map(({ group, links }) => (
        <section key={group} className="mt-6">
          <h2 className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {group}
          </h2>
          <div className="grid grid-cols-3 gap-2">
            {links.map((link) => {
              const Icon = LINK_ICONS[link.to] || HomeIcon;
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  className="flex min-h-[5.25rem] flex-col items-center justify-center gap-1.5 glass rounded-2xl px-1.5 py-3 text-center text-xs font-semibold text-slate-800 active:scale-[0.97] dark:text-slate-100"
                >
                  <span className="text-lagoon-700 dark:text-lagoon-300">
                    <Icon width={22} height={22} />
                  </span>
                  {link.label}
                </Link>
              );
            })}
          </div>
        </section>
      ))}

      <div className="mt-8 flex items-center justify-between glass rounded-3xl p-2 pl-4">
        <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Appearance</span>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <button
            type="button"
            onClick={() => {
              logout();
              navigate('/');
            }}
            className="flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
          >
            <LogoutIcon width={17} height={17} />
            Log out
          </button>
        </div>
      </div>
    </div>
  );
}
