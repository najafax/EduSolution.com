// A small sticky-ish bar that appears above a list's table once one or
// more rows are checkbox-selected — "N selected" plus whatever actions the
// caller passes (usually just Delete). Shared so every list page's bulk
// selection looks and behaves the same way.
export default function BulkActionBar({ count, onClear, children }) {
  if (count === 0) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 dark:border-indigo-800 dark:bg-indigo-950">
      <span className="text-sm font-medium text-indigo-900 dark:text-indigo-200">
        {count} selected
      </span>
      <div className="flex flex-wrap gap-2">{children}</div>
      <button
        type="button"
        onClick={onClear}
        className="ml-auto text-sm font-medium text-indigo-700 hover:text-indigo-900 dark:text-indigo-300 dark:hover:text-indigo-100"
      >
        Clear
      </button>
    </div>
  );
}
