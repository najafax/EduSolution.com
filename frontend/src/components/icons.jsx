// Minimal hand-rolled outline icons (no icon-library dependency) — 20x20,
// 1.5px stroke, currentColor. Used inside KpiCard's tinted circle, so the
// icon inherits its tone color rather than carrying its own.
const base = { width: 20, height: 20, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 };

export function InvoiceIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M5 3h10v14l-2.5-1.5L10 17l-2.5-1.5L5 17V3Z" strokeLinejoin="round" />
      <path d="M7.5 7h5M7.5 10h5" strokeLinecap="round" />
    </svg>
  );
}

export function CheckCircleIcon(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="10" cy="10" r="7" />
      <path d="m7 10 2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ClockIcon(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4l2.5 2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AlertTriangleIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M10 3.5 17.5 16h-15L10 3.5Z" strokeLinejoin="round" />
      <path d="M10 8.5v3.25" strokeLinecap="round" />
      <circle cx="10" cy="14" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ExpenseIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M4 6h12l-1 9.5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 5 15.5L4 6Z" strokeLinejoin="round" />
      <path d="M7 6a3 3 0 0 1 6 0" strokeLinecap="round" />
    </svg>
  );
}

export function TrendUpIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M3.5 13.5 8 9l3 3 5.5-5.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 6.5h3.5V10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TrendDownIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M3.5 6.5 8 11l3-3 5.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 13.5h3.5V10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function UsersIcon(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="7.5" cy="7" r="2.5" />
      <path d="M2.5 16c0-2.5 2-4 5-4s5 1.5 5 4" strokeLinecap="round" />
      <path d="M12.5 5a2.5 2.5 0 0 1 0 5" strokeLinecap="round" />
      <path d="M14.5 12.3c1.8.4 3 1.6 3 3.7" strokeLinecap="round" />
    </svg>
  );
}
