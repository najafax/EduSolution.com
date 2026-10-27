// How trustworthy a sale's cost figure is (see backend/src/lib/saleProfit.js).
const BASIS = {
  actual: { label: 'Actual', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300', hint: 'Fully covered by paid supplier invoices' },
  invoiced: { label: 'Invoiced', cls: 'bg-lagoon-100 text-lagoon-800 dark:bg-lagoon-950 dark:text-lagoon-300', hint: 'Covered by supplier invoices, some not paid yet' },
  partly: { label: 'Partly estimated', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300', hint: 'Some supplier invoices linked, the rest estimated' },
  estimated: { label: 'Estimated', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300', hint: 'No supplier invoice linked yet; cost is from product cost prices' },
  none: { label: 'No cost data', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300', hint: 'No supplier cost known for this sale' },
};

export default function BasisPill({ basis }) {
  const b = BASIS[basis] || BASIS.none;
  return (
    <span title={b.hint} className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${b.cls}`}>
      {b.label}
    </span>
  );
}
