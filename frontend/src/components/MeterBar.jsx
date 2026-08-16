// Meter contract (see dataviz skill): fill carries the value, the unfilled
// track is a lighter step of the same ramp — never a neutral gray track
// under a colored fill — so the bar reads as one state, not two.
const FILL = { lagoon: 'bg-lagoon-600', emerald: 'bg-emerald-600', amber: 'bg-amber-500', red: 'bg-red-600' };
const TRACK = {
  lagoon: 'bg-lagoon-100 dark:bg-lagoon-950',
  emerald: 'bg-emerald-100 dark:bg-emerald-950',
  amber: 'bg-amber-100 dark:bg-amber-950',
  red: 'bg-red-100 dark:bg-red-950',
};

export default function MeterBar({ label, pct, sub, color = 'lagoon' }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-slate-700 dark:text-slate-300">{label}</span>
        <span className="font-semibold text-slate-900 dark:text-white">{clamped.toFixed(0)}%</span>
      </div>
      <div className={`mt-2 h-2.5 w-full overflow-hidden rounded-full ${TRACK[color] || TRACK.lagoon}`}>
        <div
          className={`h-full rounded-full transition-[width] ${FILL[color] || FILL.lagoon}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
      {sub && <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{sub}</p>}
    </div>
  );
}
