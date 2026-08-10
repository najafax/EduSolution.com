import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import StatusBadge from '../../components/StatusBadge';
import SearchInput from '../../components/SearchInput';
import FloatingActionButton from '../../components/FloatingActionButton';

export default function Quotes() {
  const { token, can } = useAuth();
  const canManage = can('quotes', 'manage');
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.quotes
      .list(token)
      .then(({ quotes }) => setQuotes(quotes))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  const filteredQuotes = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return quotes;
    return quotes.filter((quote) =>
      [quote.number, quote.client_name, quote.status].some((field) => field?.toLowerCase().includes(q)),
    );
  }, [quotes, search]);

  async function handleExport() {
    setError('');
    try {
      await api.quotes.exportCsv(token);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">Quotes</h1>
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Export CSV
          </button>
          {canManage && (
            <Link
              to="/quotes/new"
              className="flex min-h-11 items-center rounded-md bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-500"
            >
              New quote
            </Link>
          )}
        </div>
      </div>

      <div className="mt-4 max-w-sm">
        <SearchInput value={search} onChange={setSearch} placeholder="Search quotes…" />
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <p className="p-6 text-sm text-slate-500">Loading…</p>
        ) : quotes.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">No quotes yet.</p>
        ) : filteredQuotes.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">No quotes match "{search}".</p>
        ) : (
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead>
              <tr className="text-left text-xs font-medium uppercase text-slate-500">
                <th className="px-4 py-3">Number</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Issued</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredQuotes.map((quote) => (
                <tr key={quote.id} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-3">
                    <Link to={`/quotes/${quote.id}`} className="font-medium text-indigo-600 hover:text-indigo-500">
                      {quote.number}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{quote.client_name}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{quote.issue_date}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <StatusBadge status={quote.status} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-slate-900">{quote.total.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {canManage && <FloatingActionButton to="/quotes/new" label="New quote" />}
    </div>
  );
}
