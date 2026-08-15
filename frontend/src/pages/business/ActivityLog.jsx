import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';

export default function ActivityLog() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.activity
      .list(token, page)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token, page]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Activity log</h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
        A running record of who created, updated, sent, or deleted things across clients, quotes, invoices,
        expenses, and recurring invoices.
      </p>

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        {loading ? (
          <p className="p-6 text-sm text-slate-500 dark:text-slate-400">Loading…</p>
        ) : !data || data.entries.length === 0 ? (
          <p className="p-6 text-sm text-slate-500 dark:text-slate-400">No activity yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.entries.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm sm:px-6">
                <span className="text-slate-700 dark:text-slate-300">
                  <span className="font-medium text-slate-900 dark:text-white">{entry.user_name}</span>{' '}
                  {entry.action} {entry.entity_type}
                  {entry.entity_label ? <span className="text-slate-500 dark:text-slate-400"> — {entry.entity_label}</span> : null}
                </span>
                <span className="whitespace-nowrap text-xs text-slate-400 dark:text-slate-500">
                  {new Date(entry.created_at.replace(' ', 'T') + 'Z').toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {data && data.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Previous
          </button>
          <span className="text-sm text-slate-500 dark:text-slate-400">
            Page {data.page} of {data.totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
            disabled={page >= data.totalPages}
            className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
