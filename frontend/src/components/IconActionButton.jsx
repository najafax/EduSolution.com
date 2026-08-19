// A compact icon-only button for row-level and detail-page actions
// (Edit/Delete/Renew/Duplicate/etc.) — visible border + a tone-tinted
// hover fill so it reads as a real button, not bare colored text, while
// staying small enough that a row with several actions doesn't turn into
// a wall of pill buttons. `title` doubles as the tooltip and the
// accessible label fallback; pass `label` only when it needs to differ
// from `title` (rare). Originally built for Licenses.jsx's row actions,
// then extracted here once the same shape was needed on every other list/
// detail page in the app.
const TONE = {
  lagoon: 'border-lagoon-200 text-lagoon-600 hover:bg-lagoon-50 dark:border-lagoon-800 dark:text-lagoon-400 dark:hover:bg-lagoon-950',
  emerald:
    'border-emerald-200 text-emerald-600 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950',
  amber: 'border-amber-200 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-950',
  orange:
    'border-orange-200 text-orange-600 hover:bg-orange-50 dark:border-orange-800 dark:text-orange-400 dark:hover:bg-orange-950',
  slate: 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800',
  red: 'border-red-200 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950',
};

export default function IconActionButton({ icon: Icon, tone = 'slate', title, label, onClick, disabled, spinning = false, type = 'button' }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={label || title}
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border disabled:pointer-events-none disabled:opacity-50 ${TONE[tone]}`}
    >
      <Icon width={16} height={16} className={spinning ? 'animate-spin' : ''} />
    </button>
  );
}
