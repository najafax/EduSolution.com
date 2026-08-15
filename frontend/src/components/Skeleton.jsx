// A shimmering placeholder block, standing in for content that's still
// loading. Used bare for small pieces (a KPI value, a line of text) or via
// TableSkeleton below for a whole list page's loading state.
export function Skeleton({ className = '' }) {
  return <div className={`animate-pulse rounded-md bg-slate-200 dark:bg-slate-700 ${className}`} />;
}

// Mimics the shape of the table every list page renders once data loads —
// same row height/padding as the real `<table>` — so the loading state
// doesn't visually jump when real rows swap in. `cols` accepts either a
// count (even-width columns) or an array of Tailwind width classes for
// columns that should look narrower/wider than each other.
export function TableSkeleton({ rows = 5, cols = 4 }) {
  const widths = Array.isArray(cols) ? cols : Array.from({ length: cols }, () => 'w-24');
  return (
    <div className="divide-y divide-slate-100 dark:divide-slate-700">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex items-center gap-6 px-4 py-4">
          {widths.map((w, colIndex) => (
            <Skeleton key={colIndex} className={`h-4 ${w}`} />
          ))}
        </div>
      ))}
    </div>
  );
}
