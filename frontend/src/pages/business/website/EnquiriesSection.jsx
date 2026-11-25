import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { useToast } from '../../../context/ToastContext';
import StatusBadge from '../../../components/StatusBadge';
import StatusFilterChips from '../../../components/StatusFilterChips';
import EmptyState from '../../../components/EmptyState';
import { timeAgo } from '../../../lib/date';
import { MailIcon } from '../../../components/icons';

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'closed', label: 'Closed' },
];
const INTEREST = { edupage: 'EduPage', business_suite: 'Business Suite', both: 'Both', unsure: 'Not sure yet' };
const BTN =
  'min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800';

// Walkthrough requests from the public website's enquiry form
// (routes/public.js POST /enquiries). Staff mark them contacted/closed or
// turn one into a client record.
export function EnquiriesSection({ token, canManage, canCreateClient }) {
  const { toast } = useToast();
  const [status, setStatus] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);

  function load() {
    api.website.enquiries
      .list(token, { status })
      .then(({ enquiries }) => setItems(enquiries))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [token, status]);

  async function act(e, fn, done) {
    setBusy(e.id);
    try {
      await fn();
      toast(done, { type: 'success' });
      load();
    } catch (err) {
      toast(err.message, { type: 'error' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-6">
      <StatusFilterChips options={FILTERS} value={status} onChange={setStatus} />
      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {loading ? (
        <div className="mt-4 h-24 animate-pulse rounded-3xl bg-white dark:bg-slate-900" />
      ) : items.length === 0 ? (
        <div className="mt-4 rounded-3xl bg-white shadow-sm dark:border dark:border-slate-700 dark:bg-slate-900">
          <EmptyState
            icon={<MailIcon />}
            title="No enquiries yet."
            message="Requests sent from the Contact page on your website appear here."
          />
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {items.map((e) => (
            <li key={e.id} className="rounded-3xl bg-white p-4 shadow-sm dark:border dark:border-slate-700 dark:bg-slate-900 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-display text-base font-bold text-slate-900 dark:text-white">
                    {e.organisation || e.name}
                  </p>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    {e.organisation ? `${e.name} · ` : ''}
                    {INTEREST[e.interest] || 'Not sure yet'} · {timeAgo(e.created_at.replace(' ', 'T') + 'Z')}
                  </p>
                </div>
                <StatusBadge status={e.status} />
              </div>
              <p className="mt-2 break-words text-sm text-slate-700 dark:text-slate-300">
                <a href={`mailto:${e.email}`} className="text-lagoon-600 hover:underline dark:text-lagoon-400">
                  {e.email}
                </a>
                {e.phone && (
                  <>
                    {' · '}
                    <a href={`tel:${e.phone}`} className="text-lagoon-600 hover:underline dark:text-lagoon-400">
                      {e.phone}
                    </a>
                  </>
                )}
              </p>
              {e.message && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700 dark:text-slate-300">{e.message}</p>}
              {e.client_id && (
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                  Client: <Link to="/clients" className="text-lagoon-600 hover:underline dark:text-lagoon-400">{e.client_name || 'created'}</Link>
                </p>
              )}
              {e.handled_by_name && e.status !== 'new' && (
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Handled by {e.handled_by_name}</p>
              )}
              {canManage && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {e.status === 'new' && (
                    <button
                      className={BTN}
                      disabled={busy === e.id}
                      onClick={() => act(e, () => api.website.enquiries.setStatus(e.id, 'contacted', token), 'Marked as contacted.')}
                    >
                      Mark contacted
                    </button>
                  )}
                  {canCreateClient && !e.client_id && (
                    <button
                      className={BTN}
                      disabled={busy === e.id}
                      onClick={() => act(e, () => api.website.enquiries.createClient(e.id, token), 'Client created.')}
                    >
                      Create client
                    </button>
                  )}
                  {e.status !== 'closed' ? (
                    <button
                      className={BTN}
                      disabled={busy === e.id}
                      onClick={() => act(e, () => api.website.enquiries.setStatus(e.id, 'closed', token), 'Closed.')}
                    >
                      Close
                    </button>
                  ) : (
                    <button
                      className={BTN}
                      disabled={busy === e.id}
                      onClick={() => act(e, () => api.website.enquiries.setStatus(e.id, 'new', token), 'Reopened.')}
                    >
                      Reopen
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
