import { useEffect } from 'react';

// A themed replacement for window.confirm() — same contract as the main
// EduSolution app's own ConfirmDialog (rendered via lib/useConfirm.jsx's
// confirm()), but plain CSS transitions instead of that app's `motion`
// dependency, which isn't worth pulling in for one dialog in this smaller
// app.
export default function ConfirmDialog({ open, title, message, confirmLabel, cancelLabel, danger = true, busy = false, onConfirm, onCancel }) {
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e) {
      if (e.key === 'Escape') onCancel?.();
    }
    document.addEventListener('keydown', handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel?.();
      }}
    >
      <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl dark:bg-slate-900">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h2>
        {message && <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{message}</p>}
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`min-h-11 flex-1 rounded-md px-4 text-sm font-medium text-white disabled:opacity-60 ${
              danger ? 'bg-red-600 hover:bg-red-500' : 'bg-lagoon-600 hover:bg-lagoon-500'
            }`}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="min-h-11 flex-1 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
