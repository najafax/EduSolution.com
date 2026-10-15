// List-page header + search + filters + actions. Below xl it lays out exactly
// like the old stacked header (title/actions row, then search, then chips).
// From xl up it becomes ONE frosted row: title | search | filters | actions.
// `subtitle` is shown under the title on small screens and as a tooltip on
// desktop (it would not fit a single row).
export default function PageToolbar({ title, subtitle, search, extra, filters, actions, children }) {
  return (
    <div className="page-toolbar flex flex-wrap items-center gap-3 xl:flex-nowrap xl:gap-4">
      <div className="order-1 min-w-0 flex-1 xl:flex-none" title={subtitle}>
        <h1 className="font-display text-2xl font-extrabold text-slate-900 dark:text-white xl:whitespace-nowrap xl:text-xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 xl:hidden">{subtitle}</p>}
      </div>
      {actions && <div className="order-2 flex flex-wrap items-center gap-2 xl:order-4 xl:ml-auto xl:flex-nowrap">{actions}</div>}
      {search && <div className="order-3 w-full sm:max-w-sm xl:w-72 xl:flex-none">{search}</div>}
      {extra && <div className="order-3 xl:flex-none">{extra}</div>}
      {filters && <div className="order-4 w-full xl:order-3 xl:w-auto xl:min-w-0 xl:flex-1 xl:overflow-x-auto xl:[scrollbar-width:none]">{filters}</div>}
      {children}
    </div>
  );
}
