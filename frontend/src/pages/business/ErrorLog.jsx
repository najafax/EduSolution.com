import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import StatusFilterChips from '../../components/StatusFilterChips';

const TABS = [
  { value: 'open', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
];

const SOURCE_LABEL = { server: 'Server', job: 'Scheduled job', browser: 'Browser' };

function when(s) {
  return new Date(s.replace(' ', 'T') + 'Z').toLocaleString();
}

export default function ErrorLog() {
  const { token, isUnrestrictedAdmin } = useAuth();
  const [status, setStatus] = useState('open');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);

  const load = useCallback(() => {
    api.errorLog
      .list(token, status)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [token, status]);

  useEffect(() => {
    if (isUnrestrictedAdmin) load();
  }, [load, isUnrestrictedAdmin]);

  if (!isUnrestrictedAdmin) {
    return <p className="px-4 py-10 text-sm text-slate-600 dark:text-slate-400">You do not have permission to view this page.</p>;
  }

  async function resolve(id) {
    try {
      await api.errorLog.resolve(id, token);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function resolveAll() {
    try {
      await api.errorLog.resolveAll(token);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  const errors = data?.errors || [];

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8 xl:py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-slate-900 dark:text-white">Error log</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Crashes from the server, scheduled jobs and browsers. The same error is grouped into one row; new ones also alert you on Telegram.
          </p>
        </div>
        {status === 'open' && errors.length > 0 && (
          <button
            type="button"
            onClick={resolveAll}
            className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Mark all resolved
          </button>
        )}
      </div>

      <div className="mt-4">
        <StatusFilterChips options={TABS} value={status} onChange={setStatus} />
      </div>

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-4 rounded-3xl bg-white shadow-sm dark:border dark:border-slate-700 dark:bg-slate-900">
        {!data ? (
          <p className="p-6 text-sm text-slate-500 dark:text-slate-400">Loading…</p>
        ) : errors.length === 0 ? (
          <p className="p-6 text-sm text-slate-500 dark:text-slate-400">{status === 'open' ? 'No open errors. 🎉' : 'Nothing resolved yet.'}</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {errors.map((e) => (
              <li key={e.id} className="px-4 py-3 sm:px-6">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <button type="button" onClick={() => setOpenId(openId === e.id ? null : e.id)} className="min-w-0 flex-1 text-left">
                    <p className="break-words text-sm font-medium text-slate-900 dark:text-white">{e.message}</p>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {SOURCE_LABEL[e.source] || e.source} · {e.count}× · last {when(e.last_seen_at)}
                      {e.url ? ` · ${e.url}` : ''}
                      {e.user_name ? ` · ${e.user_name}` : ''}
                    </p>
                  </button>
                  {status === 'open' && (
                    <button
                      type="button"
                      onClick={() => resolve(e.id)}
                      className="min-h-9 shrink-0 rounded-lg border border-slate-300 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      Resolve
                    </button>
                  )}
                </div>
                {openId === e.id && (
                  <pre className="mt-3 max-h-72 overflow-auto rounded-xl bg-slate-50 p-3 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    {e.stack || '(no stack trace)'}
                    {e.user_agent ? `\n\n${e.user_agent}` : ''}
                    {`\n\nFirst seen ${when(e.first_seen_at)}`}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
