import { Link } from 'react-router-dom';
import { roleLabel } from '../lib/roles';

// The right-hand rail from the combined dashboard direction — a profile
// card, a short list of shortcuts, and a compact "needs attention" feed
// with colored icon chips. Deliberately Dashboard-only (not a persistent
// app-wide layout element the way components/Sidebar.jsx is) — this is
// the page's own supplementary widget rail, not new global navigation.
const TONE_CHIP = {
  red: 'bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400',
  amber: 'bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400',
  emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400',
};

export default function DashboardRail({ user, shortcuts, attentionItems }) {
  const initials = (user?.name || user?.email || '?')
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="flex flex-col gap-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      {/* Profile card */}
      <Link to="/account" className="flex items-center gap-3 rounded-xl p-1 hover:bg-slate-50 dark:hover:bg-slate-800">
        {user?.avatarImage ? (
          <img src={user.avatarImage} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" />
        ) : (
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-lagoon-600 text-sm font-bold text-white">
            {initials}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink dark:text-white">{user?.name}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{roleLabel(user?.role)}</p>
        </div>
      </Link>

      {shortcuts.length > 0 && (
        <>
          <div className="h-px bg-slate-100 dark:bg-slate-800" />
          <div>
            <p className="mb-2.5 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Shortcuts</p>
            <div className="flex flex-col gap-1">
              {shortcuts.map((s) => (
                <Link
                  key={s.to}
                  to={s.to}
                  className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  {s.icon && <s.icon width={16} height={16} className="shrink-0 text-lagoon-600 dark:text-lagoon-400" />}
                  {s.label}
                </Link>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="h-px bg-slate-100 dark:bg-slate-800" />
      <div>
        <p className="mb-2.5 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Needs attention{attentionItems.length > 0 ? ` (${attentionItems.length})` : ''}
        </p>
        {attentionItems.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">You're all caught up.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {attentionItems.map((item) => (
              <Link
                key={item.key}
                to={item.to}
                className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${TONE_CHIP[item.tone] || TONE_CHIP.amber}`}>
                  <item.icon width={15} height={15} />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{item.title}</p>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">{item.subtitle}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
