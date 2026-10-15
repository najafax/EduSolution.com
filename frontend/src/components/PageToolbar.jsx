import { useState } from 'react';
import BottomSheet from './BottomSheet';
import { XIcon } from './icons';

// List-page header + search + filters + actions.
//
// Phones (below xl): one compact title row (title left, icon-only action
// buttons right), then a slim search box. Filters stay as ONE swipeable chip
// row (`mobileFilters="scroll"`, default) or, for pages with many/complex
// filters, move behind a filter button that opens a bottom sheet
// (`mobileFilters="sheet"`), with active filters echoed as removable chips
// (`activeChips`: [{ key, label, onClear }]) and a count on the button.
//
// Desktop (xl and up): ONE frosted row — title | search | filters | actions.
export default function PageToolbar({
  title,
  search,
  extra,
  filters,
  actions,
  children,
  mobileFilters = 'scroll',
  activeChips = [],
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheet = mobileFilters === 'sheet' && Boolean(filters || extra);
  const hideOnPhone = sheet ? 'hidden xl:block' : '';

  return (
    <div className="page-toolbar flex flex-wrap items-center gap-3 xl:flex-nowrap xl:gap-4">
      <div className="order-1 min-w-0 flex-1 xl:flex-none">
        <h1 className="truncate font-display text-2xl font-extrabold text-slate-900 dark:text-white xl:whitespace-nowrap xl:text-xl">{title}</h1>
      </div>
      {actions && (
        <div className="page-toolbar-actions order-2 flex shrink-0 items-center gap-2 xl:order-4 xl:ml-auto">{actions}</div>
      )}
      {search && (
        <div className="order-3 flex w-full items-center gap-2.5 sm:max-w-sm xl:w-72 xl:flex-none">
          <div className="min-w-0 flex-1">{search}</div>
          {sheet && (
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              aria-label="Filters"
              className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-slate-300 bg-white/70 text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 xl:hidden"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
                <circle cx="16" cy="7" r="2" />
                <circle cx="8" cy="17" r="2" />
              </svg>
              {activeChips.length > 0 && (
                <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-lagoon-600 px-1 text-[11px] font-bold text-white">
                  {activeChips.length}
                </span>
              )}
            </button>
          )}
        </div>
      )}
      {extra && <div className={`order-3 xl:flex-none ${hideOnPhone}`}>{extra}</div>}
      {filters && (
        <div
          className={`order-4 w-full xl:order-3 xl:w-auto xl:min-w-0 xl:flex-1 xl:overflow-x-auto xl:[scrollbar-width:none] ${
            sheet
              ? 'hidden xl:block'
              : '-mx-4 w-[calc(100%+2rem)] overflow-x-auto px-4 [scrollbar-width:none] max-xl:[&>div]:flex-nowrap xl:mx-0 xl:w-auto xl:px-0'
          }`}
        >
          {filters}
        </div>
      )}
      {sheet && activeChips.length > 0 && (
        <div className="order-5 flex w-full flex-wrap gap-2 xl:hidden">
          {activeChips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={c.onClear}
              className="flex h-8 items-center gap-1.5 rounded-full bg-slate-900 pl-3 pr-2 text-sm font-medium text-white dark:bg-lagoon-600"
            >
              {c.label}
              <XIcon width={14} height={14} />
            </button>
          ))}
        </div>
      )}
      {children}
      {sheet && (
        <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Filters">
          <div className="flex flex-col gap-4 p-4 pb-6">
            {filters}
            {extra}
            <button
              type="button"
              onClick={() => setSheetOpen(false)}
              className="flex h-12 items-center justify-center rounded-2xl bg-slate-900 text-base font-semibold text-white dark:bg-lagoon-600"
            >
              Show results
            </button>
          </div>
        </BottomSheet>
      )}
    </div>
  );
}
