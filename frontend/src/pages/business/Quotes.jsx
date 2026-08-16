import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import StatusBadge from '../../components/StatusBadge';
import SearchInput from '../../components/SearchInput';
import FloatingActionButton from '../../components/FloatingActionButton';
import Pagination from '../../components/Pagination';
import Modal from '../../components/Modal';
import { TableSkeleton } from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import StatusFilterChips from '../../components/StatusFilterChips';
import MobileListAccordion from '../../components/MobileListAccordion';
import { InvoiceIcon } from '../../components/icons';
import QuoteForm from './QuoteForm';

const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'declined', label: 'Declined' },
  { value: 'expired', label: 'Expired' },
];

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
  const [status, setStatus] = useState('');
  const [showNewForm, setShowNewForm] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.quotes
      .list(token, { q: search, page, status })
      .then(({ quotes, ...rest }) => {
        setQuotes(quotes);
        setPageInfo(rest.totalPages ? rest : null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token, search, page, status]);
  useEffect(() => {
    setPage(1);
  }, [search, status]);

  async function handleExport() {
    setError('');
    try {
      await api.quotes.exportCsv(token);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Quotes</h1>
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
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

      <div className="mt-3">
        <StatusFilterChips options={STATUS_OPTIONS} value={status} onChange={setStatus} />
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <div className="mt-6 rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        {loading ? (
          <div className="overflow-x-auto">
            <TableSkeleton rows={5} cols={['w-28', 'w-32', 'w-24', 'w-20', 'w-20']} />
          </div>
        ) : quotes.length === 0 ? (
          <EmptyState
            icon={<InvoiceIcon />}
            title={search || status ? 'No quotes match these filters.' : 'No quotes yet.'}
            message={!search && !status && canManage ? 'Create a quote to send to a client for approval.' : undefined}
            action={!search && !status && canManage ? { label: 'New quote', onClick: () => setShowNewForm(true) } : undefined}
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto sm:block">
              <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                    <th className="px-4 py-3">Number</th>
                    <th className="px-4 py-3">Client</th>
                    <th className="px-4 py-3">Issued</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {quotes.map((quote) => (
                    <tr key={quote.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                      <td className="whitespace-nowrap px-4 py-3">
                        <Link to={`/quotes/${quote.id}`} className="font-medium text-indigo-600 hover:text-indigo-500">
                          {quote.number}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-400">{quote.client_name}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-400">{quote.issue_date}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <StatusBadge status={quote.status} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-slate-900 dark:text-white">{quote.total.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-slate-100 sm:hidden dark:divide-slate-800">
              {quotes.map((quote) => (
                <MobileListAccordion
                  key={quote.id}
                  name="quotes-list"
                  summary={
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <Link
                          to={`/quotes/${quote.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="font-medium text-indigo-600 hover:text-indigo-500"
                        >
                          {quote.number}
                        </Link>
                        <p className="truncate text-slate-500 dark:text-slate-400">{quote.client_name}</p>
                      </div>
                      <StatusBadge status={quote.status} />
                    </div>
                  }
                >
                  <div className="flex justify-between">
                    <dt className="text-slate-500 dark:text-slate-400">Issued</dt>
                    <dd className="text-slate-900 dark:text-white">{quote.issue_date}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500 dark:text-slate-400">Total</dt>
                    <dd className="text-slate-900 dark:text-white">{quote.total.toFixed(2)}</dd>
                  </div>
                </MobileListAccordion>
              ))}
            </div>
          </>
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
