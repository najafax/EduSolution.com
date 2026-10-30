import { useCallback, useEffect, useState } from 'react';
import Modal from '../../components/Modal';

// Small building blocks shared by every Finance tab, so the five tabs look
// and behave the same without each one carrying its own copy.

export const INPUT =
  'mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white';
export const LABEL = 'text-sm font-medium text-slate-700 dark:text-slate-300';

export const n2 = (n) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const full = (symbol, n) => `${n < 0 ? '−' : ''}${symbol}${n2(Math.abs(n))}`;
export const usd = (n) => `${n < 0 ? '−' : ''}$${n2(Math.abs(n))}`;

export function Card({ title, action, children, className = '' }) {
  return (
    <section className={`min-w-0 rounded-3xl bg-white p-4 shadow-sm sm:p-5 dark:border dark:border-slate-700 dark:bg-slate-900 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

const PILL = {
  pos: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  neg: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400',
  warn: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  neu: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};
export function Pill({ tone = 'neu', children }) {
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${PILL[tone]}`}>{children}</span>;
}

export function Btn({ children, tone = 'plain', className = '', ...rest }) {
  const look =
    tone === 'primary'
      ? 'bg-slate-900 text-white dark:bg-lagoon-600'
      : tone === 'danger'
        ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400'
        : 'bg-slate-100 text-slate-800 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700';
  return (
    <button type="button" {...rest} className={`min-h-10 rounded-xl px-3.5 py-2 text-sm font-semibold disabled:opacity-50 ${look} ${className}`}>
      {children}
    </button>
  );
}

// A list row: title/sub on the left, amount + status on the right.
// `children` is the expanded detail (rendered under the row when `open`).
export function Row({ title, sub, amount, tag, tone, onClick, open, children, lead }) {
  return (
    <div className="border-b border-slate-100 last:border-0 dark:border-slate-800">
      <button type="button" onClick={onClick} aria-expanded={Boolean(open)} className="flex w-full min-w-0 items-center gap-3 py-3 text-left">
        {lead}
        <span className="min-w-0 flex-1">
          <span className={`block truncate font-semibold ${open ? 'text-lagoon-700 dark:text-lagoon-400' : 'text-slate-900 dark:text-white'}`}>{title}</span>
          {sub && <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{sub}</span>}
        </span>
        <span className="shrink-0 text-right">
          <span className="block font-semibold tabular-nums text-slate-900 dark:text-white">{amount}</span>
          {tag && <Pill tone={tone}>{tag}</Pill>}
        </span>
      </button>
      {open && children}
    </div>
  );
}

export function Detail({ pairs, children }) {
  return (
    <div className="mb-3 grid gap-1.5 rounded-2xl bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
      {pairs.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3">
          <span className="text-slate-500 dark:text-slate-400">{k}</span>
          <span className="text-right font-medium tabular-nums text-slate-900 dark:text-white">{v}</span>
        </div>
      ))}
      {children && <div className="flex flex-wrap gap-2 pt-1">{children}</div>}
    </div>
  );
}

export function Empty({ children }) {
  return <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">{children}</p>;
}

export function Chips({ options, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          className={`min-h-9 rounded-full px-3 text-sm font-medium ${
            value === v ? 'bg-lagoon-50 font-semibold text-lagoon-700 dark:bg-lagoon-950 dark:text-lagoon-400' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className={LABEL}>{label}</span>
      {children}
    </label>
  );
}

// A modal wrapping a <form>, with the standard error line and Save/Cancel.
export function FormModal({ open, onClose, title, onSubmit, busy, error, submitLabel = 'Save', children }) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="grid gap-3 sm:grid-cols-2"
      >
        {children}
        {error && <p className="text-sm text-red-600 sm:col-span-2 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn tone="primary" type="submit" disabled={busy}>
            {busy ? 'Saving…' : submitLabel}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}

// Fetches on mount and whenever `deps` change; `reload()` refetches without
// blanking what is already on screen.
export function useLoader(fn, deps) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(() => fn().then((d) => (setData(d), setError(''))).catch((e) => setError(e.message)), deps);
  useEffect(() => {
    run();
  }, [run]);
  return { data, error, reload: run };
}

// The business currency symbol (e.g. "MVR "), falling back to "MVR " for
// staff without access to Settings.
export function useSymbol(token) {
  const [symbol, setSymbol] = useState('MVR ');
  useEffect(() => {
    import('../../lib/api').then(({ api }) =>
      api.settings
        .getSummary(token)
        .then((s) => s?.currency_symbol && setSymbol(s.currency_symbol))
        .catch(() => {}),
    );
  }, [token]);
  return symbol;
}
