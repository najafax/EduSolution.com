// The "Customize" panel content for Dashboard's shortcut tiles — a plain
// list (not drag-and-drop, to avoid pulling in a DnD library for eight
// possible rows) with a visibility checkbox and up/down reorder buttons per
// row. Rendered inside a <Modal> by Dashboard.jsx.
export default function DashboardShortcutsEditor({ items, hiddenSet, onToggle, onMoveUp, onMoveDown, onReset }) {
  return (
    <div className="flex flex-col gap-1">
      {items.map((item, i) => (
        <div
          key={item.to}
          className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          <input
            type="checkbox"
            checked={!hiddenSet.has(item.to)}
            onChange={() => onToggle(item.to)}
            aria-label={`Show ${item.label} shortcut`}
            className="h-4 w-4 rounded border-slate-300"
          />
          <span className="flex-1 text-sm font-medium text-slate-900 dark:text-white">{item.label}</span>
          <button
            type="button"
            onClick={() => onMoveUp(item.to)}
            disabled={i === 0}
            aria-label={`Move ${item.label} up`}
            className="flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:text-slate-400 dark:hover:bg-slate-700"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m5 15 7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => onMoveDown(item.to)}
            disabled={i === items.length - 1}
            aria-label={`Move ${item.label} down`}
            className="flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:text-slate-400 dark:hover:bg-slate-700"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m19 9-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={onReset}
        className="mt-3 self-start text-sm font-medium text-lagoon-600 hover:text-lagoon-500"
      >
        Reset to default
      </button>
    </div>
  );
}
