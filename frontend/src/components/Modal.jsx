import { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';

// Shared popup styling for "New X" (and reused "Edit X") entry forms —
// same backdrop + centered white card treatment as
// `IdleTimeoutMonitor`'s "Still there?" warning, just wide/scrollable
// enough to hold a form instead of a couple lines of text. Closes on
// Escape or a click on the dimmed backdrop, in addition to whatever the
// caller wires up inside (a Cancel button, a successful save, etc).
// Vertically centered at every breakpoint, not just `sm:` and up — every
// modal in the app (forms, the Licenses "History" log, etc.) should sit in
// the middle of the screen on mobile the same way it does on desktop. When
// content is taller than the viewport, `overflow-y-auto` on the backdrop
// still lets it scroll — centering doesn't clip the top, it just starts
// scrolled so the card's middle lines up with the viewport's middle. Keep
// this centered-by-default behavior for any new modal treatment added
// later rather than reverting to top-aligned on small screens.
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

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/50 px-4 py-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose?.();
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <motion.div
            className={`w-full ${maxWidthClass} rounded-lg bg-white p-5 shadow-xl dark:bg-slate-900`}
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">{title}</h2>
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
            <div className="mt-3">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
