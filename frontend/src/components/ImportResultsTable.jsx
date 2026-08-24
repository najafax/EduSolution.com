// Shared by the CSV-import preview/commit flow on both the standalone
// Import page (pages/business/Import.jsx) and any page-embedded import
// flow (e.g. Products.jsx's own "Import CSV" button) — one row per CSV
// row, OK/Error status pill, and the backend's own preview/message text.
// Extracted once Products.jsx needed the identical table a second place,
// so the two flows can't drift out of sync on how results are shown.
export default function ImportResultsTable({ results }) {
  return (
    <div className="mt-4 max-h-96 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-700">
      <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
        <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800">
          <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
            <th className="px-4 py-2">Row</th>
            <th className="px-4 py-2">Status</th>
            <th className="px-4 py-2">Item</th>
            <th className="px-4 py-2">Message</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {results.map((r) => (
            <tr key={r.row}>
              <td className="whitespace-nowrap px-4 py-2 text-slate-500 dark:text-slate-400">{r.row}</td>
              <td className="whitespace-nowrap px-4 py-2">
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                    r.status === 'ok'
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
                      : 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400'
                  }`}
                >
                  {r.status === 'ok' ? 'OK' : 'Error'}
                </span>
              </td>
              <td className="whitespace-nowrap px-4 py-2 text-slate-700 dark:text-slate-300">{r.preview}</td>
              <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{r.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
