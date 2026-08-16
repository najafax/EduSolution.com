// One-click status filter chips above a list, wired to the same ?status=
// server-side filter each list route already supports (see
// routes/quotes.js / routes/invoices.js). `options` is
// [{ value, label }, ...] — pass value: '' for the "All" chip.
export default function StatusFilterChips({ options, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value || 'all'}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`min-h-9 rounded-full border px-3 text-sm font-medium capitalize ${
              active
                ? 'border-indigo-600 bg-indigo-600 text-white'
                : 'border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
