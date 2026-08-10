import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import StatusBadge from '../../components/StatusBadge';
import SearchInput from '../../components/SearchInput';
import FloatingActionButton from '../../components/FloatingActionButton';
import Pagination from '../../components/Pagination';
import Modal from '../../components/Modal';
import QuoteForm from './QuoteForm';

export default function Quotes() {
  const { token, can } = useAuth();
  const navigate = useNavigate();
  const canManage = can('quotes', 'manage');
  const [quotes, setQuotes] = useState([]);
  const [pageInfo, setPageInfo] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [showNewForm, setShowNewForm] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.quotes
      .list(token, { q: search, page })
      .then(({ quotes, ...rest }) => {
        setQuotes(quotes);
        setPageInfo(rest.totalPages ? rest : null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token, search, page]);
  useEffect(() => {
    setPage(1);
  }, [search]);

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
            <button
              onClick={() => setShowNewForm(true)}
              className="flex min-h-11 items-center rounded-md bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-500"
            >
              New quote
            </button>
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
          <p className="p-6 text-sm text-slate-500">
            {search ? `No quotes match "${search}".` : 'No quotes yet.'}
          </p>
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
              {quotes.map((quote) => (
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

      {pageInfo && <Pagination page={pageInfo.page} totalPages={pageInfo.totalPages} onChange={setPage} />}

      <Modal open={showNewForm} onClose={() => setShowNewForm(false)} title="New quote" maxWidthClass="max-w-3xl">
        <QuoteForm
          embedded
          idOverride={null}
          onSuccess={(quote) => {
            setShowNewForm(false);
            navigate(`/quotes/${quote.id}`);
          }}
          onCancel={() => setShowNewForm(false)}
        />
      </Modal>

      {canManage && !showNewForm && <FloatingActionButton onClick={() => setShowNewForm(true)} label="New quote" />}
    </div>
  );
}
