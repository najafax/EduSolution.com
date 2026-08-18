import { useState } from 'react';
import { useTheme } from '../context/ThemeContext';

// Generic two-series grouped bar chart, one group per year — the shared
// shape behind every Analytics page's "activity by year" chart (Licenses,
// Invoices, Quotes). Originally a License-Analytics-only local component;
// promoted here once Invoice/Quote Analytics needed the exact same shape,
// generalized from hardcoded newLicenses/renewals fields to a `series` prop
// of exactly two { key, label, color } entries read off each `data` row.
const WIDTH = 600;
const HEIGHT = 260;
const PAD_LEFT = 36;
const PAD_RIGHT = 12;
const PAD_TOP = 16;
const PAD_BOTTOM = 32;
const CHART_WIDTH = WIDTH - PAD_LEFT - PAD_RIGHT;
const CHART_HEIGHT = HEIGHT - PAD_TOP - PAD_BOTTOM;
const GRID_STEPS = 4;
const GRID_COLORS = { light: '#e2e8f0', dark: '#334155' };
const AXIS_TEXT_COLORS = { light: '#94a3b8', dark: '#64748b' };
const LABEL_COLORS = { light: '#64748b', dark: '#94a3b8' };
const BASELINE_COLORS = { light: '#c3c2b7', dark: '#475569' };

function niceCeiling(value) {
  if (value <= 0) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

// `data` is newest-year-first (matching every Analytics page's own table
// below it) and reversed internally so the chart itself reads chronologically
// left-to-right, like RevenueTrendChart.jsx's month axis.
export default function YearlyBarChart({ data, series, emptyMessage, ariaLabel }) {
  const [hover, setHover] = useState(null);
  const { resolvedTheme } = useTheme();
  const gridColor = GRID_COLORS[resolvedTheme];
  const axisTextColor = AXIS_TEXT_COLORS[resolvedTheme];
  const labelColor = LABEL_COLORS[resolvedTheme];
  const baselineColor = BASELINE_COLORS[resolvedTheme];

  const chronological = [...data].reverse();
  const hasData = chronological.some((d) => series.some((s) => d[s.key] > 0));
  const maxValue = niceCeiling(Math.max(1, ...chronological.flatMap((d) => series.map((s) => d[s.key]))));
  const groupWidth = CHART_WIDTH / chronological.length;
  const barWidth = Math.min(28, groupWidth * 0.32);
  const barGap = 4;
  const baseline = PAD_TOP + CHART_HEIGHT;
  const yFor = (value) => PAD_TOP + CHART_HEIGHT - (value / maxValue) * CHART_HEIGHT;

  return (
    <div>
      <div className="mb-3 flex items-center gap-4 text-xs text-slate-600 dark:text-slate-400">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>

      {!hasData ? (
        <p className="flex h-48 items-center justify-center text-sm text-slate-400 dark:text-slate-500">{emptyMessage}</p>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full" role="img" aria-label={ariaLabel}>
            {Array.from({ length: GRID_STEPS + 1 }).map((_, i) => {
              const value = (maxValue / GRID_STEPS) * i;
              const y = yFor(value);
              return (
                <g key={i}>
                  <line x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={y} y2={y} stroke={gridColor} strokeWidth={1} />
                  <text x={PAD_LEFT - 8} y={y + 3} textAnchor="end" fontSize={9} fill={axisTextColor}>
                    {Math.round(value)}
                  </text>
                </g>
              );
            })}

            {chronological.map((d, i) => {
              const groupX = PAD_LEFT + i * groupWidth;
              const xs = [groupX + groupWidth / 2 - barWidth - barGap / 2, groupX + groupWidth / 2 + barGap / 2];

              return (
                <g key={d.year}>
                  {series.map((s, si) => {
                    const value = d[s.key];
                    const y = yFor(value);
                    return (
                      <rect
                        key={s.key}
                        x={xs[si]}
                        y={y}
                        width={barWidth}
                        height={Math.max(0, baseline - y)}
                        rx={3}
                        fill={s.color}
                        onMouseEnter={() => setHover({ label: s.label, value, x: xs[si] + barWidth / 2, y })}
                        onMouseLeave={() => setHover(null)}
                      />
                    );
                  })}
                  <text x={groupX + groupWidth / 2} y={HEIGHT - 10} textAnchor="middle" fontSize={10} fill={labelColor}>
                    {d.year}
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
              {hover.label}: {hover.value}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
