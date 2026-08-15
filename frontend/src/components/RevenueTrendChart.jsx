import { useState } from 'react';
import { useTheme } from '../context/ThemeContext';

// Two series on one shared $ axis (never dual-axis) — Invoiced vs Paid,
// same brand colors used for status elsewhere in the app (indigo = brand,
// emerald = money received), so the chart reads consistently with the rest
// of the UI rather than introducing a new arbitrary palette.
const INVOICED_COLOR = '#4f46e5';
const PAID_COLOR = '#059669';

const WIDTH = 600;
const HEIGHT = 260;
const PAD_LEFT = 50;
const PAD_RIGHT = 12;
const PAD_TOP = 16;
const PAD_BOTTOM = 32;
const CHART_WIDTH = WIDTH - PAD_LEFT - PAD_RIGHT;
const CHART_HEIGHT = HEIGHT - PAD_TOP - PAD_BOTTOM;
const GRID_STEPS = 4;

function niceCeiling(value) {
  if (value <= 0) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

function formatCompact(value) {
  if (value >= 1000) return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`;
  return value.toFixed(0);
}

function formatMonth(monthStr) {
  const [year, month] = monthStr.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'short' });
}

// The SVG's own gridlines/axis text are drawn with `fill`/`stroke`
// attributes, which Tailwind's `dark:` variant can't reach — resolved
// against the app's theme instead, same light/dark palette as the rest of
// the chart's surroundings.
const GRID_COLORS = { light: '#e2e8f0', dark: '#334155' };
const AXIS_TEXT_COLORS = { light: '#94a3b8', dark: '#64748b' };
const MONTH_LABEL_COLORS = { light: '#64748b', dark: '#94a3b8' };
const BASELINE_COLORS = { light: '#c3c2b7', dark: '#475569' };

export default function RevenueTrendChart({ data, currencySymbol = '$' }) {
  const [hover, setHover] = useState(null);
  const { resolvedTheme } = useTheme();
  const gridColor = GRID_COLORS[resolvedTheme];
  const axisTextColor = AXIS_TEXT_COLORS[resolvedTheme];
  const monthLabelColor = MONTH_LABEL_COLORS[resolvedTheme];
  const baselineColor = BASELINE_COLORS[resolvedTheme];

  const hasData = data.some((d) => d.invoiced > 0 || d.paid > 0);
  const maxValue = niceCeiling(Math.max(1, ...data.flatMap((d) => [d.invoiced, d.paid])));
  const groupWidth = CHART_WIDTH / data.length;
  const barWidth = Math.min(28, groupWidth * 0.32);
  const barGap = 4;
  const baseline = PAD_TOP + CHART_HEIGHT;

  const yFor = (value) => PAD_TOP + CHART_HEIGHT - (value / maxValue) * CHART_HEIGHT;

  return (
    <div>
      <div className="mb-3 flex items-center gap-4 text-xs text-slate-600 dark:text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: INVOICED_COLOR }} />
          Invoiced
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: PAID_COLOR }} />
          Paid
        </span>
      </div>

      {!hasData ? (
        <p className="flex h-48 items-center justify-center text-sm text-slate-400 dark:text-slate-500">No invoices in the last 6 months yet.</p>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full" role="img" aria-label="Invoiced vs paid, last 6 months">
            {Array.from({ length: GRID_STEPS + 1 }).map((_, i) => {
              const value = (maxValue / GRID_STEPS) * i;
              const y = yFor(value);
              return (
                <g key={i}>
                  <line x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={y} y2={y} stroke={gridColor} strokeWidth={1} />
                  <text x={PAD_LEFT - 8} y={y + 3} textAnchor="end" fontSize={9} fill={axisTextColor}>
                    {currencySymbol}
                    {formatCompact(value)}
                  </text>
                </g>
              );
            })}

            {data.map((d, i) => {
              const groupX = PAD_LEFT + i * groupWidth;
              const invoicedX = groupX + groupWidth / 2 - barWidth - barGap / 2;
              const paidX = groupX + groupWidth / 2 + barGap / 2;
              const invoicedY = yFor(d.invoiced);
              const paidY = yFor(d.paid);

              return (
                <g key={d.month}>
                  <rect
                    x={invoicedX}
                    y={invoicedY}
                    width={barWidth}
                    height={Math.max(0, baseline - invoicedY)}
                    rx={3}
                    fill={INVOICED_COLOR}
                    onMouseEnter={() =>
                      setHover({ label: 'Invoiced', value: d.invoiced, x: invoicedX + barWidth / 2, y: invoicedY })
                    }
                    onMouseLeave={() => setHover(null)}
                  />
                  <rect
                    x={paidX}
                    y={paidY}
                    width={barWidth}
                    height={Math.max(0, baseline - paidY)}
                    rx={3}
                    fill={PAID_COLOR}
                    onMouseEnter={() => setHover({ label: 'Paid', value: d.paid, x: paidX + barWidth / 2, y: paidY })}
                    onMouseLeave={() => setHover(null)}
                  />
                  <text x={groupX + groupWidth / 2} y={HEIGHT - 10} textAnchor="middle" fontSize={10} fill={monthLabelColor}>
                    {formatMonth(d.month)}
                  </text>
                </g>
              );
            })}

            <line x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={baseline} y2={baseline} stroke={baselineColor} strokeWidth={1} />
          </svg>

          {hover && (
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white shadow-lg"
              style={{ left: `${(hover.x / WIDTH) * 100}%`, top: `${(hover.y / HEIGHT) * 100}%` }}
            >
              {hover.label}: {currencySymbol}
              {hover.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
