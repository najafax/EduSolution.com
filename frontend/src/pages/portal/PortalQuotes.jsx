import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { usePortalAuth } from '../../context/PortalAuthContext';
import { useToast } from '../../context/ToastContext';
import StatusBadge from '../../components/StatusBadge';
import EmptyState from '../../components/EmptyState';
import Modal from '../../components/Modal';
import LineItemsEditor from '../../components/LineItemsEditor';
import SearchInput from '../../components/SearchInput';
import { QuoteIcon, PlusIcon } from '../../components/icons';

// A request's summary line: item quantities/names when the client picked
// from the catalog, falling back to the free-text description for a
// request with no items (or predating the catalog picker).
function requestSummary(request) {
  if (request.items && request.items.length > 0) {
    return request.items.map((item) => `${item.quantity}× ${item.description}`).join(', ');
  }
  return request.description || '(no description)';
}

export default function PortalQuotes() {
  const { token, settings } = usePortalAuth();
  const { toast } = useToast();
  const [quotes, setQuotes] = useState(null);
  const [requests, setRequests] = useState(null);
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [items, setItems] = useState([]);
  const [notes, setNotes] = useState('');
  const [requestError, setRequestError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const symbol = settings?.currency_symbol || '$';

  function load() {
    api.portal.quotes
      .list(token)
      .then(({ quotes }) => setQuotes(quotes))
      .catch((err) => setError(err.message));
    api.portal.quoteRequests
      .list(token)
      .then(({ requests }) => setRequests(requests))
      .catch(() => {});
  }

  useEffect(load, [token]);
  useEffect(() => {
    api.portal.products
      .list(token)
      .then(({ products }) => setProducts(products))
      .catch(() => {});
  }, [token]);

  function openRequestForm() {
    setItems([]);
    setNotes('');
    setRequestError('');
    setShowRequestForm(true);
  }

  async function handleSubmitRequest(e) {
    e.preventDefault();
    setRequestError('');
    if (items.length === 0 && !notes.trim()) {
      setRequestError('Please add at least one item from the catalog, or describe what you need below.');
      return;
    }
    setSubmitting(true);
    try {
      // Only product_id + quantity are ever sent — LineItemsEditor's own
      // unit_price here is read-only display data (see priceEditable below),
      // never something the server trusts from a client.
      await api.portal.quoteRequests.create(
        { description: notes, items: items.map((item) => ({ product_id: item.product_id, quantity: item.quantity })) },
        token,
      );
      setShowRequestForm(false);
      toast('Your quote request has been sent.', { type: 'success' });
      load();
    } catch (err) {
      setRequestError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Quotes</h1>
        <button
          onClick={openRequestForm}
          className="flex min-h-11 items-center gap-1.5 rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500"
        >
          <PlusIcon width={16} height={16} />
          Request a quote
        </button>
      </div>

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {requests && requests.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Your requests</h2>
          <div className="mt-2 flex flex-col gap-2">
            {requests.map((request) => (
              <div
                key={request.id}
                className="rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 flex-1 text-slate-700 dark:text-slate-300">{requestSummary(request)}</p>
                  <StatusBadge status={request.status} />
                </div>
                {request.items?.length > 0 && request.description && (
                  <p className="mt-1 text-slate-500 dark:text-slate-400">{request.description}</p>
                )}
                {/* A request's status flips to 'approved' the instant staff
                    links a quote to it (routes/quoteRequests.js's own
                    POST /:id/link-quote) — and that quote is visible here
                    the same instant too (see routes/clientPortal.js's
                    CLIENT_VISIBLE_QUOTE), whether or not staff has since
                    also clicked "Send" on it. So 'approved' always means
                    "go look," never "still being prepared" — there's no
                    in-between state to render a placeholder for. */}
                {request.status === 'approved' && request.quote_id && (
                  <Link to={`/portal/quotes/${request.quote_id}`} className="mt-1 inline-block font-medium text-lagoon-600 hover:text-lagoon-500">
                    Your quote ({request.quote_number}) is ready — view it
                  </Link>
                )}
                {request.status === 'declined' && request.decision_note && (
                  <p className="mt-1 text-slate-500 dark:text-slate-400">{request.decision_note}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Sent to you</h2>
        {quotes && quotes.length > 0 && (
          <div className="w-full max-w-xs sm:w-56">
            <SearchInput value={search} onChange={setSearch} placeholder="Search quotes…" />
          </div>
        )}
      </div>

      {!quotes ? (
        <p className="mt-4 text-center text-sm text-slate-500 dark:text-slate-400">Loading…</p>
      ) : quotes.length === 0 ? (
        <div className="mt-2 rounded-lg border border-slate-200 dark:border-slate-700">
          <EmptyState icon={<QuoteIcon />} title="No quotes yet." message="Any quotes prepared for you will show up here." />
        </div>
      ) : quotes.filter((q) => q.number.toLowerCase().includes(search.trim().toLowerCase())).length === 0 ? (
        <p className="mt-4 text-center text-sm text-slate-500 dark:text-slate-400">No quotes match "{search}".</p>
      ) : (
        <>
          <div className="mt-2 hidden overflow-x-auto rounded-lg border border-slate-200 bg-white sm:block dark:border-slate-700 dark:bg-slate-900">
            <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
              <thead>
                <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                  <th className="px-4 py-3">Number</th>
                  <th className="px-4 py-3">Issued</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {quotes.filter((q) => q.number.toLowerCase().includes(search.trim().toLowerCase())).map((quote) => (
                  <tr key={quote.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                    <td className="whitespace-nowrap px-4 py-3">
                      <Link to={`/portal/quotes/${quote.id}`} className="font-medium text-lagoon-600 hover:text-lagoon-500">
                        {quote.number}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-400">{quote.issue_date}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <StatusBadge status={quote.status} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-slate-900 dark:text-white">
                      {symbol}
                      {quote.total.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-2 flex flex-col gap-2.5 sm:hidden">
            {quotes.filter((q) => q.number.toLowerCase().includes(search.trim().toLowerCase())).map((quote) => (
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
        </>
      )}

      <Modal open={showRequestForm} onClose={() => setShowRequestForm(false)} title="Request a quote" maxWidthClass="max-w-xl">
        <form onSubmit={handleSubmitRequest} className="flex flex-col gap-3">
          <div>
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Pick from our catalog</span>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Prices shown are our current list prices for reference — your final quote may differ once we review your request.
            </p>
            <div className="mt-1">
              <LineItemsEditor
                items={items}
                onChange={setItems}
                currencySymbol={symbol}
                products={products}
                catalogOnly
                priceEditable={false}
                subtotalLabel="Estimated subtotal"
              />
            </div>
          </div>

          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Anything else? (optional)</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Not seeing what you need in the catalog? Describe it here."
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            />
          </label>

          {requestError && <p className="text-sm text-red-600 dark:text-red-400">{requestError}</p>}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowRequestForm(false)}
              className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="min-h-11 rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500 disabled:opacity-60"
            >
              {submitting ? 'Sending…' : 'Send request'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
