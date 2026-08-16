// Stat-tile contract (see dataviz skill): label, value, optional sub as
// context/delta. `tone` picks the icon-chip + value color from the app's
// existing reserved palette — never a generic per-card hue — so a KPI's
// color always means the same thing everywhere it appears (emerald = good/
// money-in, red = negative/overdue, lagoon = neutral/brand, amber = caution).
const TONES = {
  neutral: { icon: 'bg-lagoon-50 text-lagoon-600 dark:bg-lagoon-950 dark:text-lagoon-400', value: 'text-slate-900 dark:text-white' },
  positive: { icon: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400', value: 'text-slate-900 dark:text-white' },
  negative: { icon: 'bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400', value: 'text-red-600 dark:text-red-400' },
  warning: { icon: 'bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400', value: 'text-amber-700 dark:text-amber-400' },
};

export default function KpiCard({ icon, label, value, sub, tone = 'neutral' }) {
  const t = TONES[tone] || TONES.neutral;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${t.icon}`}>{icon}</span>
      <p className="mt-3 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`mt-0.5 font-display text-xl font-extrabold tabular-nums ${t.value}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{sub}</p>}
    </div>
  );
}
