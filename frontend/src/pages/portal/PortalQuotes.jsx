import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { usePortalAuth } from '../../context/PortalAuthContext';
import StatusBadge from '../../components/StatusBadge';
import EmptyState from '../../components/EmptyState';
import { QuoteIcon } from '../../components/icons';

export default function PortalQuotes() {
  const { token, settings } = usePortalAuth();
  const [quotes, setQuotes] = useState(null);
  const [error, setError] = useState('');
  const symbol = settings?.currency_symbol || '$';

  useEffect(() => {
    api.portal.quotes
      .list(token)
      .then(({ quotes }) => setQuotes(quotes))
      .catch((err) => setError(err.message));
  }, [token]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Quotes</h1>

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {!quotes ? (
        <p className="mt-10 text-center text-sm text-slate-500 dark:text-slate-400">Loading…</p>
      ) : quotes.length === 0 ? (
        <div className="mt-6 rounded-lg border border-slate-200 dark:border-slate-700">
          <EmptyState icon={<QuoteIcon />} title="No quotes yet." message="Any quotes prepared for you will show up here." />
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-2.5">
          {quotes.map((quote) => (
            <Link
              key={quote.id}
              to={`/portal/quotes/${quote.id}`}
              className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-lagoon-300 hover:shadow-md dark:border-slate-700 dark:bg-slate-900"
            >
              <div className="min-w-0">
                <p className="font-medium text-slate-900 dark:text-white">{quote.number}</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">Issued {quote.issue_date}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="font-semibold text-slate-900 dark:text-white">
                  {symbol}
                  {quote.total.toFixed(2)}
                </span>
                <StatusBadge status={quote.status} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
