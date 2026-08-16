// Status is state, not identity — colors are the app's reserved status
// palette (same mapping used in StatusBadge and the PDF renderer), never a
// generic categorical hue set.
const STATUS_META = [
  { key: 'draft', label: 'Draft', color: '#94a3b8' },
  { key: 'sent', label: 'Sent', color: '#4f46e5' },
  { key: 'paid', label: 'Paid', color: '#059669' },
  { key: 'void', label: 'Void', color: '#dc2626' },
];

export default function StatusBreakdownChart({ counts }) {
  const rows = STATUS_META.map((meta) => ({ ...meta, value: counts[meta.key] || 0 }));
  const total = rows.reduce((sum, r) => sum + r.value, 0);
  const max = Math.max(1, ...rows.map((r) => r.value));

  if (total === 0) {
    return <p className="flex h-40 items-center justify-center text-sm text-slate-400 dark:text-slate-500">No invoices yet.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-3">
          <span className="w-12 shrink-0 text-xs font-medium text-slate-600 dark:text-slate-400">{r.label}</span>
          <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div className="h-full rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: r.color }} />
          </div>
          <span className="w-6 shrink-0 text-right text-xs font-semibold text-slate-900 dark:text-white">{r.value}</span>
        </div>
      ))}
    </div>
  );
}
