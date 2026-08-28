// The donut counterpart to StatusBreakdownChart's horizontal bars — same
// STATUS_META colors/keys (draft/sent/paid/void), same "status is state,
// not series identity" reasoning, just a different geometry. Used once, on
// Dashboard.jsx, as part of the combined "vibrant stats + widget rail"
// direction; every other caller (Financials.jsx, InvoiceAnalytics.jsx)
// keeps the original bar chart, so this is deliberately its own component
// rather than a mode flag on StatusBreakdownChart.
//
// Each segment's position comes from a cascading NEGATIVE stroke-dashoffset
// (segment N's offset = -(sum of every prior segment's arc length)) rather
// than a per-segment `transform="rotate(...)"` attribute — a CSS class
// transform (the shared -90deg rotation that points every segment's zero
// point at 12 o'clock) silently overrides an SVG transform ATTRIBUTE on the
// same element, so a rotate() attribute here would just be dropped and every
// segment would render starting from the same point instead of forming a
// ring.
const STATUS_META = [
  { key: 'paid', label: 'Paid', color: '#059669' },
  { key: 'sent', label: 'Sent', color: '#0e7c86' },
  { key: 'draft', label: 'Draft', color: '#94a3b8' },
  { key: 'void', label: 'Void', color: '#dc2626' },
];

const SIZE = 160;
const STROKE = 20;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function StatusDonutChart({ counts }) {
  const rows = STATUS_META.map((meta) => ({ ...meta, value: counts[meta.key] || 0 }));
  const total = rows.reduce((sum, r) => sum + r.value, 0);

  if (total === 0) {
    return <p className="flex h-40 items-center justify-center text-sm text-slate-400 dark:text-slate-500">No invoices yet.</p>;
  }

  let cumulative = 0;
  const segments = rows
    .filter((r) => r.value > 0)
    .map((r) => {
      const arcLength = (r.value / total) * CIRCUMFERENCE;
      const offset = -cumulative;
      cumulative += arcLength;
      return { ...r, arcLength, offset };
    });

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:justify-center">
      <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="-rotate-90">
          <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="currentColor" strokeWidth={STROKE} className="text-slate-100 dark:text-slate-800" />
          {segments.map((s) => (
            <circle
              key={s.key}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke={s.color}
              strokeWidth={STROKE}
              strokeDasharray={`${s.arcLength} ${CIRCUMFERENCE}`}
              strokeDashoffset={s.offset}
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-2xl font-extrabold tabular-nums text-ink dark:text-white">{total}</span>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Invoices</span>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-2 text-sm">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
            <span className="w-12 shrink-0 text-slate-600 dark:text-slate-400">{r.label}</span>
            <span className="font-semibold tabular-nums text-slate-900 dark:text-white">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
