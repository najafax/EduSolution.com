// Generic horizontal-bar breakdown — the shared shape behind every
// Analytics page's "current split" panel (Licenses' billing cycle,
// Invoices'/Quotes' status breakdown). Originally a License-Analytics-only
// local component (already written generically, `rows` never referenced
// licenses specifically); promoted here once Invoice/Quote Analytics needed
// the exact same shape rather than duplicating it a second and third time.
export default function BreakdownBars({ rows, emptyMessage }) {
  const total = rows.reduce((sum, r) => sum + r.value, 0);
  const max = Math.max(1, ...rows.map((r) => r.value));

  if (total === 0) {
    return <p className="flex h-24 items-center justify-center text-sm text-slate-400 dark:text-slate-500">{emptyMessage}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-3">
          <span className="w-16 shrink-0 text-xs font-medium text-slate-600 dark:text-slate-400">{r.label}</span>
          <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div className="h-full rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: r.color }} />
          </div>
          <span className="w-6 shrink-0 text-right text-xs font-semibold text-slate-900 dark:text-white">{r.value}</span>
        </div>
      ))}
    </div>
  );
}
