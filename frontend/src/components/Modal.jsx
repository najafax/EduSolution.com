import { useEffect } from 'react';

// Shared popup styling for "New X" (and reused "Edit X") entry forms —
// same backdrop + centered white card treatment as
// `IdleTimeoutMonitor`'s "Still there?" warning, just wide/scrollable
// enough to hold a form instead of a couple lines of text. Closes on
// Escape or a click on the dimmed backdrop, in addition to whatever the
// caller wires up inside (a Cancel button, a successful save, etc).
export default function Modal({ open, onClose, title, children, maxWidthClass = 'max-w-lg' }) {
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e) {
      if (e.key === 'Escape') onClose?.();
    }
    document.addEventListener('keydown', handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 py-8 sm:items-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className={`w-full ${maxWidthClass} rounded-lg bg-white p-6 shadow-xl dark:bg-slate-900`}>
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
