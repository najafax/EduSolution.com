import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';

const EMPTY_RESULTS = { clients: [], quotes: [], invoices: [], expenses: [] };

export default function GlobalSearch({ onNavigate, className = 'max-w-xs' }) {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(EMPTY_RESULTS);
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(EMPTY_RESULTS);
      return;
    }
    const handle = setTimeout(() => {
      api.search
        .query(token, q)
        .then(setResults)
        .catch(() => setResults(EMPTY_RESULTS));
    }, 250);
    return () => clearTimeout(handle);
  }, [query, token]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function go(path) {
    setOpen(false);
    setQuery('');
    navigate(path);
    onNavigate?.();
  }

  const hasResults =
    results.clients.length + results.quotes.length + results.invoices.length + results.expenses.length > 0;

  return (
    <div ref={boxRef} className={`relative w-full ${className}`}>
      <input
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search everything…"
        className="min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-indigo-500 focus:outline-none"
      />

      {open && query.trim() && (
        <div className="absolute left-0 right-0 z-20 mt-1 max-h-96 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
          {!hasResults ? (
            <p className="p-4 text-sm text-slate-500">No results for "{query}".</p>
          ) : (
            <>
              {results.clients.length > 0 && (
                <div>
                  <p className="px-4 pt-3 text-xs font-semibold uppercase text-slate-400">Clients</p>
                  {results.clients.map((c) => (
                    <button
                      key={`client-${c.id}`}
                      onClick={() => go('/clients')}
                      className="block w-full px-4 py-2 text-left text-sm hover:bg-slate-50"
                    >
                      <span className="font-medium text-slate-900">{c.name}</span>
                    </button>
                  ))}
                </div>
              )}
              {results.quotes.length > 0 && (
                <div>
                  <p className="px-4 pt-3 text-xs font-semibold uppercase text-slate-400">Quotes</p>
                  {results.quotes.map((qt) => (
                    <button
                      key={`quote-${qt.id}`}
                      onClick={() => go(`/quotes/${qt.id}`)}
                      className="block w-full px-4 py-2 text-left text-sm hover:bg-slate-50"
                    >
                      <span className="font-medium text-slate-900">{qt.number}</span>
                      <span className="text-slate-500"> — {qt.client_name}</span>
                    </button>
                  ))}
                </div>
              )}
              {results.invoices.length > 0 && (
                <div>
                  <p className="px-4 pt-3 text-xs font-semibold uppercase text-slate-400">Invoices</p>
                  {results.invoices.map((inv) => (
                    <button
                      key={`invoice-${inv.id}`}
                      onClick={() => go(`/invoices/${inv.id}`)}
                      className="block w-full px-4 py-2 text-left text-sm hover:bg-slate-50"
                    >
                      <span className="font-medium text-slate-900">{inv.number}</span>
                      <span className="text-slate-500"> — {inv.client_name}</span>
                    </button>
                  ))}
                </div>
              )}
              {results.expenses.length > 0 && (
                <div className="pb-2">
                  <p className="px-4 pt-3 text-xs font-semibold uppercase text-slate-400">Expenses</p>
                  {results.expenses.map((ex) => (
                    <button
                      key={`expense-${ex.id}`}
                      onClick={() => go('/expenses')}
                      className="block w-full px-4 py-2 text-left text-sm hover:bg-slate-50"
                    >
                      <span className="font-medium text-slate-900">{ex.description}</span>
                      <span className="text-slate-500"> — {ex.category}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
