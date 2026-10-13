// A compact list of period figures (Paid / Outstanding / Overdue on the
// dashboard), each with a thin bar showing its share of one common total —
// so the rows are comparable at a glance. One white card instead of three
// ring cards: it reads in a single scan and fits a phone without cramping
// money figures into narrow columns. `tone` picks the bar and value colour.
const TONES = {
  positive: { bar: 'bg-emerald-500', value: 'text-emerald-700 dark:text-emerald-400' },
  warning: { bar: 'bg-lagoon-500', value: 'text-slate-900 dark:text-white' },
  negative: { bar: 'bg-red-500', value: 'text-red-600 dark:text-red-400' },
};

export default function StatBars({ title, items }) {
  return (
    <section className="rounded-[28px] bg-white p-6 shadow-sm dark:bg-slate-900">
      {title && <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{title}</h2>}
      <ul className="mt-3 flex flex-col gap-4">
        {items.map(({ key, label, value, sub, percent, tone = 'warning' }) => {
          const t = TONES[tone] || TONES.warning;
          const pct = Math.min(100, Math.max(0, Number.isFinite(percent) ? percent : 0));
          return (
            <li key={key}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium text-slate-600 dark:text-slate-300">{label}</span>
                <span className={`font-display text-xl font-extrabold tabular-nums ${t.value}`}>{value}</span>
              </div>
              <div
                className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
                role="progressbar"
                aria-label={label}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(pct)}
              >
                <div className={`h-full rounded-full ${t.bar}`} style={{ width: `${pct}%` }} />
              </div>
              {sub && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{sub}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
