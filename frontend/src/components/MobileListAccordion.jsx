// Per-row expandable accordion used on mobile for list pages whose table
// has too many columns to read comfortably on a narrow screen without
// horizontal scrolling. Desktop keeps the plain <table> unmodified
// (rendered separately, hidden below the `sm` breakpoint); this renders
// instead below it, `sm:hidden` — a summary line (just the columns a user
// scans the list by, e.g. number + client) that expands on tap to show
// the row's remaining fields. Built on native <details>/<summary>, the
// same convention as components/Accordion.jsx (no JS breakpoint
// detection), but per-row instead of per-page-section.
//
// `name` groups every row in one rendered list into a single exclusive-
// open set via the native <details name> behavior (Chrome/Edge 120+,
// Safari 17.2+, Firefox 125+) — opening one row auto-closes whichever
// other row in the same group was open, no JS state needed. Callers pass
// one fixed string per rendered list (e.g. "invoices-list") so a page
// with more than one list (or sub-table) on screen doesn't accidentally
// group rows that belong to different lists together.
//
// Any interactive element placed inside `summary` (e.g. a Link to the
// row's detail page) needs its own `onClick={(e) => e.stopPropagation()}`
// — otherwise tapping it also toggles the accordion, same as the `action`
// prop on components/Accordion.jsx.
//
// Each row renders as its own floating rounded card (border + shadow),
// not a flat divided list — callers wrap a set of rows in `flex flex-col
// gap-2.5` rather than `divide-y`. `accent` is an optional Tailwind bg-*
// class (e.g. `bg-red-500` for an overdue invoice) rendered as a 4px left
// stripe, the same "status reads as color, not just text" treatment
// StatusBadge gives everywhere else — omit it for lists with no
// comparable status dimension (Clients, Products, Users, ...).
//
// The card's own border/rounding/shadow/accent-stripe live on a plain
// wrapping <div>, not on <details> itself — Chrome (120+) renders a
// <details>'s post-summary content inside an internal `::details-content`
// box that collapses to zero height while closed, which silently breaks
// `inset-y-0`-style stretching (and any percentage-height child) placed
// directly inside <details>. A plain div sidesteps that native quirk
// entirely while <details>/<summary> still handle the open/close behavior.
export default function MobileListAccordion({ summary, children, name, accent }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      {accent && <span className={`absolute inset-y-0 left-0 w-1 ${accent}`} aria-hidden="true" />}
      <details name={name} className="group">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 py-3 pl-5 pr-4 [&::-webkit-details-marker]:hidden">
          <div className="min-w-0 flex-1">{summary}</div>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="shrink-0 text-slate-400 transition-transform group-open:rotate-180"
          >
            <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </summary>
        <div className="space-y-1.5 border-t border-slate-100 py-3 pl-5 pr-4 text-sm dark:border-slate-800">{children}</div>
      </details>
    </div>
  );
}
