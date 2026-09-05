// Minimal hand-rolled outline icons (no icon-library dependency) — 20x20,
// 1.5px stroke, currentColor. Trimmed to only the icons pages/MODReport.jsx
// and pages/PublicMODReport.jsx actually use, copied from the main
// EduSolution app's own components/icons.jsx.
const base = { width: 20, height: 20, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 };

export function CheckCircleIcon(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="10" cy="10" r="7" />
      <path d="m7 10 2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function XIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="m5 5 10 10M15 5 5 15" strokeLinecap="round" />
    </svg>
  );
}

export function RefreshIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M4.5 10a5.5 5.5 0 0 1 9.5-3.8l1 1" strokeLinecap="round" />
      <path d="M13.5 4.5v3h-3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15.5 10a5.5 5.5 0 0 1-9.5 3.8l-1-1" strokeLinecap="round" />
      <path d="M6.5 15.5v-3h3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PencilIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="m13.5 3.5 3 3L7 16H4v-3L13.5 3.5Z" strokeLinejoin="round" />
      <path d="m11.5 5.5 3 3" strokeLinecap="round" />
    </svg>
  );
}

export function TrashIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M4 6h12M8 6V4.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.5 6 6 16a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l.5-10" strokeLinejoin="round" />
      <path d="M8.5 9v5M11.5 9v5" strokeLinecap="round" />
    </svg>
  );
}

export function DownloadIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M10 3v9.5M6.5 9 10 12.5 13.5 9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 14.5V16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PlusIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M10 4v12M4 10h12" strokeLinecap="round" />
    </svg>
  );
}

export function LinkIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M8.5 11.5a3 3 0 0 0 4.24 0l2-2a3 3 0 1 0-4.24-4.24l-1 1" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11.5 8.5a3 3 0 0 0-4.24 0l-2 2a3 3 0 1 0 4.24 4.24l1-1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
