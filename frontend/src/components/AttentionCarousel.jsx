import { Link } from 'react-router-dom';
import { CheckCircleIcon } from './icons';

// "Needs attention", first thing on the phone dashboard: one tinted card per
// overdue invoice / expiring licence (the same items DashboardRail lists at
// xl:), each with a clear way in. Horizontal scroll with snap, so several
// items cost one row of screen, not a long list. When there is nothing, a
// single calm card says so instead of an empty gap.
// `items` is Dashboard's attentionItems: { key, to, icon, tone, title, subtitle }.
const TONES = {
  red: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  amber: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
};

export default function AttentionCarousel({ items }) {
  return (
    <section aria-label="Needs attention">
      <div className="mb-2 flex items-baseline justify-between px-1">
        <h2 className="font-display text-base font-extrabold text-slate-900 dark:text-white">Needs attention</h2>
        {items.length > 0 && <span className="text-xs text-slate-500 dark:text-slate-400">{items.length} item{items.length === 1 ? '' : 's'}</span>}
      </div>
      {items.length === 0 ? (
        <div className="flex items-center gap-3 rounded-3xl bg-white p-4 shadow-sm dark:bg-slate-900">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
            <CheckCircleIcon width={20} height={20} />
          </span>
          <p className="text-sm text-slate-600 dark:text-slate-300">All caught up. Nothing is overdue or about to expire.</p>
        </div>
      ) : (
        <ul className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:-mx-6 sm:scroll-px-6 sm:px-6 [&::-webkit-scrollbar]:hidden">
          {items.map(({ key, to, icon: Icon, tone, title, subtitle }) => (
            <li key={key} className="w-[17rem] shrink-0 snap-start">
              <Link
                to={to}
                className={`flex h-full min-h-[7.5rem] flex-col justify-between gap-3 rounded-3xl p-4 ${TONES[tone] || TONES.amber}`}
              >
                <span className="flex items-start gap-2.5">
                  <Icon width={20} height={20} className="mt-0.5 shrink-0" />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-slate-900 dark:text-white">{title}</span>
                    <span className="block text-sm">{subtitle}</span>
                  </span>
                </span>
                <span className="inline-flex min-h-9 w-fit items-center rounded-xl bg-white px-3 text-sm font-semibold text-slate-900 dark:bg-slate-900 dark:text-white">
                  Open
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
