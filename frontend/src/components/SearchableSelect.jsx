import { useEffect, useMemo, useRef, useState } from 'react';

// A type-to-filter combobox for choosing one option from a list — used
// wherever a plain <select> would otherwise dump every client/etc. into an
// unscrollable-feeling dropdown. Options are `{ value, label, sublabel? }`;
// sublabel is matched by search but rendered smaller/muted, for callers that
// want a secondary line under the main label.
export default function SearchableSelect({ options, value, onChange, placeholder = 'Search…', disabled = false }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef(null);

  const selected = options.find((o) => String(o.value) === String(value));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => `${o.label} ${o.sublabel || ''}`.toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    setHighlighted(0);
  }, [query, open]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function selectOption(option) {
    onChange(String(option.value));
    setOpen(false);
    setQuery('');
  }

  function handleKeyDown(e) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[highlighted]) selectOption(filtered[highlighted]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        disabled={disabled}
        value={open ? query : selected?.label || ''}
        placeholder={selected ? '' : placeholder}
        onFocus={() => {
          setOpen(true);
          setQuery('');
        }}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-indigo-500 focus:outline-none disabled:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:disabled:bg-slate-800"
      />
      {open && (
        <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">No matches.</li>
          ) : (
            filtered.map((option, index) => (
              <li key={option.value}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectOption(option);
                  }}
                  onMouseEnter={() => setHighlighted(index)}
                  className={`flex w-full flex-col items-start px-3 py-2 text-left text-sm ${
                    index === highlighted ? 'bg-indigo-50 dark:bg-indigo-950/50' : ''
                  }`}
                >
                  <span className="text-slate-900 dark:text-white">{option.label}</span>
                  {option.sublabel && <span className="text-xs text-slate-500 dark:text-slate-400">{option.sublabel}</span>}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
