// A stat tile with a circular progress ring instead of (or alongside) a
// plain icon chip — the "vibrant stats" half of the combined dashboard
// direction (see the design canvas this was drawn from). `percent` is
// always a real, computed share of something the app already tracks
// (see pages/Dashboard.jsx's own callers: each of the four cards uses
// amount / totalInvoiced, so the ring always means "this much of what
// was invoiced," never a decorative or fabricated number).
//
// Ring math: a single-value `stroke-dasharray` (equal to the full
// circumference) renders as a solid circle regardless of
// `stroke-dashoffset` — the ring has to be a TWO-value dasharray
// (`<arc-length> <full-circumference>`) so the untraveled remainder is a
// real gap, not more "on" dash. Rotation is a single Tailwind class
// (`-rotate-90`) on the <svg> itself, not a competing SVG `transform`
// attribute — a CSS transform silently wins over an attribute transform
// on the same element, so mixing the two would drop one of them.
const SIZE = 64;
const STROKE = 7;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const TONE_RING = {
  neutral: { ring: '#0e7c86', track: 'rgba(14,124,134,0.15)' },
  positive: { ring: '#059669', track: 'rgba(5,150,105,0.15)' },
  warning: { ring: '#d97706', track: 'rgba(217,119,6,0.15)' },
  negative: { ring: '#dc2626', track: 'rgba(220,38,38,0.15)' },
};

const TONE_ICON = {
  neutral: 'bg-lagoon-50 text-lagoon-600 dark:bg-lagoon-950 dark:text-lagoon-400',
  positive: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400',
  warning: 'bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400',
  negative: 'bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400',
};

export default function RingKpiCard({ icon, label, value, sub, percent = 0, tone = 'neutral', filled = false, className = '' }) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  const dash = (clamped / 100) * CIRCUMFERENCE;
  const paletteTone = TONE_RING[tone] || TONE_RING.neutral;
  const ringColor = filled ? '#ffffff' : paletteTone.ring;
  const trackColor = filled ? 'rgba(255,255,255,0.28)' : paletteTone.track;

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border p-5 shadow-sm ${
        filled ? 'border-transparent bg-lagoon-600' : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'
      } ${className}`}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          {icon && (
            <span
              className={`mb-2.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
                filled ? 'bg-white/15 text-white' : TONE_ICON[tone] || TONE_ICON.neutral
              }`}
            >
              {icon}
            </span>
          )}
          <p className={`text-[11px] font-bold uppercase tracking-wide ${filled ? 'text-lagoon-100' : 'text-slate-500 dark:text-slate-400'}`}>
            {label}
          </p>
          <p className={`font-display mt-0.5 text-xl font-extrabold tabular-nums ${filled ? 'text-white' : 'text-ink dark:text-white'}`}>
            {value}
          </p>
          {sub && <p className={`mt-1 text-xs ${filled ? 'text-lagoon-100/80' : 'text-slate-500 dark:text-slate-400'}`}>{sub}</p>}
        </div>
        <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
          <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="-rotate-90">
            <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke={trackColor} strokeWidth={STROKE} />
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke={ringColor}
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={`${dash} ${CIRCUMFERENCE}`}
            />
          </svg>
          <span
            className={`absolute inset-0 flex items-center justify-center text-[11px] font-bold tabular-nums ${
              filled ? 'text-white' : 'text-slate-700 dark:text-slate-200'
            }`}
          >
            {Math.round(clamped)}%
          </span>
        </div>
      </div>
    </div>
  );
}
