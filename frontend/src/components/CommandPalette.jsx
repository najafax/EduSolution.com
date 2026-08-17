import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { BUSINESS_LINKS } from './Navbar';

const EMPTY_RESULTS = { clients: [], quotes: [], invoices: [], expenses: [] };

// Cmd/Ctrl+K anywhere in the app opens this. Reuses the same GET /api/search
// endpoint GlobalSearch already calls, plus static "go to" entries for every
// nav link the current user can see — one fast, keyboard-only way to jump
// to a page or a specific record without touching the mouse.
export default function CommandPalette() {
  const { token, can } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(EMPTY_RESULTS);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    function onKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setResults(EMPTY_RESULTS);
      setActiveIndex(0);
      document.body.style.overflow = 'hidden';
      const id = setTimeout(() => inputRef.current?.focus(), 0);
      return () => {
        clearTimeout(id);
        document.body.style.overflow = '';
      };
    }
  }, [open]);

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

  const navMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const links = [
      ...BUSINESS_LINKS.filter((link) => !link.module || can(link.module, 'view')),
      { to: '/account', label: 'My account', module: null },
    ];
    return links.filter((link) => !q || link.label.toLowerCase().includes(q));
  }, [query, can]);

  const items = useMemo(() => {
    const list = navMatches.map((link) => ({
      key: `nav-${link.to}`,
      label: link.label,
      sublabel: 'Go to page',
      onSelect: () => go(link.to),
    }));
    for (const c of results.clients) {
      list.push({ key: `client-${c.id}`, label: c.name, sublabel: 'Client', onSelect: () => go('/clients') });
    }
    for (const q of results.quotes) {
      list.push({ key: `quote-${q.id}`, label: q.number, sublabel: `Quote — ${q.client_name}`, onSelect: () => go(`/quotes/${q.id}`) });
    }
    for (const inv of results.invoices) {
      list.push({ key: `invoice-${inv.id}`, label: inv.number, sublabel: `Invoice — ${inv.client_name}`, onSelect: () => go(`/invoices/${inv.id}`) });
    }
    for (const ex of results.expenses) {
      list.push({ key: `expense-${ex.id}`, label: ex.description, sublabel: `Expense — ${ex.category}`, onSelect: () => go('/expenses') });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navMatches, results]);

  useEffect(() => {
    setActiveIndex(0);
  }, [items.length]);

  function go(path) {
    setOpen(false);
    navigate(path);
  }

  function handleInputKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      items[activeIndex]?.onSelect();
    }
  }

  if (!token || !open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-slate-900/40 px-4 pt-[12vh]" onClick={() => setOpen(false)}>
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 dark:border-slate-700">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-slate-400">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Search or jump to a page…"
            className="min-h-12 w-full border-0 bg-transparent text-base focus:outline-none dark:text-white"
          />
          <kbd className="hidden shrink-0 rounded border border-slate-300 px-1.5 py-0.5 text-xs text-slate-400 sm:block dark:border-slate-600">
            Esc
          </kbd>
        </div>

        <div className="max-h-96 overflow-y-auto py-2">
          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-500">No results for "{query}".</p>
          ) : (
            items.map((item, i) => (
              <button
                key={item.key}
                type="button"
                onMouseEnter={() => setActiveIndex(i)}
                onClick={item.onSelect}
                className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm ${
                  i === activeIndex ? 'bg-lagoon-50 dark:bg-lagoon-950/50' : ''
                }`}
              >
                <span className="font-medium text-slate-900 dark:text-white">{item.label}</span>
                <span className="text-xs text-slate-400">{item.sublabel}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
