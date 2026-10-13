// The dashboard's one headline figure: the running bank balance on a dark
// ink card, with a small sparkline of what was collected over the last six
// months underneath (summary.monthlyTrend's `paid` series, oldest first).
// Studio stage 2 replaces the filled ring card that used to carry this.
// The sparkline is context, not a precise chart: it is drawn to its own
// min/max, with the latest month emphasised, and has no axis.
const W = 300;
const H = 56;
const PAD = 6;

function sparkPath(values) {
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const step = values.length > 1 ? (W - PAD * 2) / (values.length - 1) : 0;
  return values.map((v, i) => {
    const x = PAD + i * step;
    const y = H - PAD - ((v - min) / span) * (H - PAD * 2);
    return [x, y];
  });
}

export default function BalanceHero({ icon, label, value, sub, trend = [], trendLabel }) {
  const values = trend.map((t) => t.paid || 0);
  const hasTrend = values.length > 1 && values.some((v) => v > 0);
  const pts = hasTrend ? sparkPath(values) : [];
  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];

  return (
    <section className="relative flex flex-col justify-between overflow-hidden rounded-[28px] bg-slate-900 p-6 text-slate-200 shadow-lg shadow-slate-900/15 dark:bg-lagoon-950">
      <div>
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
        {icon}
        {label}
      </div>
      <p className="mt-2 font-display text-[2.6rem] font-extrabold leading-none tracking-tight text-white tabular-nums">
        {value}
      </p>
      {sub && <p className="mt-2 text-sm text-slate-400">{sub}</p>}
      </div>
      {hasTrend && (
        <div className="mt-4">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={trendLabel}>
            <defs>
              <linearGradient id="balance-hero-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="#3fa9a6" stopOpacity="0.4" />
                <stop offset="1" stopColor="#3fa9a6" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={`${line} L${last[0]} ${H} L${pts[0][0]} ${H} Z`} fill="url(#balance-hero-fill)" />
            <path d={line} fill="none" stroke="#74c6c2" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            <circle cx={last[0]} cy={last[1]} r="3.5" fill="#fff" />
          </svg>
          <p className="mt-1 text-[11px] text-slate-500">{trendLabel}</p>
        </div>
      )}
    </section>
  );
}
