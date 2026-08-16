// Collapsible on mobile, always expanded on sm+ (desktop keeps today's
// static layout). Built on native <details>/<summary> — no JS breakpoint
// detection: the `sm:[&_.acc-body]:!block` override forces the body
// visible at the sm breakpoint regardless of the `open` attribute, and the
// summary becomes non-interactive there so it stops looking clickable.
export default function Accordion({ title, action, defaultOpen = true, children }) {
  return (
    <details open={defaultOpen} className="group rounded-lg border border-slate-200 bg-white shadow-sm sm:[&_.acc-body]:!block dark:border-slate-700 dark:bg-slate-900">
      <summary className="flex min-h-11 list-none items-center justify-between gap-3 px-6 py-4 [&::-webkit-details-marker]:hidden sm:pointer-events-none sm:cursor-default">
        <span className="text-sm font-semibold text-slate-900 dark:text-white">{title}</span>
        <div className="flex items-center gap-3">
          {action && (
            // Real action (e.g. "Record payment"), not the collapse toggle — stop the
            // click from bubbling to <summary> so tapping it doesn't also toggle the
            // section, and re-enable pointer events at sm+ since the summary itself
            // is non-interactive there.
            <span onClick={(e) => e.stopPropagation()} className="sm:pointer-events-auto">
              {action}
            </span>
          )}
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="shrink-0 text-slate-400 transition-transform group-open:rotate-180 sm:hidden"
          >
            <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </summary>
      <div className="acc-body border-t border-slate-200 px-6 py-4 dark:border-slate-700">{children}</div>
    </details>
  );
}
