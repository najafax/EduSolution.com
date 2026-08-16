// Shared "nothing here yet" treatment for list pages — an icon, a short
// message, and (when the viewer can actually do something about it) a call
// to action — instead of a single bare line of gray text. `icon` is any
// small React node (see components/icons.jsx); omit `action` for read-only
// viewers so there's no button that would just 403 on click.
export default function EmptyState({ icon, title, message, action }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      {icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
          {icon}
        </div>
      )}
      <div>
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{title}</p>
        {message && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{message}</p>}
      </div>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-2 min-h-11 rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
