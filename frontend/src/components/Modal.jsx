import { useEffect } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';

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
    // MotionConfig lives here (not at the app root) so this file's own
    // static `motion/react` import is the only thing that pulls the
    // library in — Modal.jsx is only ever reached via a lazily-loaded
    // page chunk, never from App.jsx itself, so the library stays out of
    // the eager initial bundle entirely (see App.jsx's own note on its
    // page-transition, which deliberately uses plain CSS instead of
    // `motion` for exactly this reason). `reducedMotion="user"` collapses
    // this modal's open/close animation to instant when the OS-level
    // "reduce motion" preference is on.
    <MotionConfig reducedMotion="user">
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/20 backdrop-blur-sm sm:items-center sm:overflow-y-auto sm:px-4 sm:py-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose?.();
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <motion.div
            className={`modal-panel flex max-h-[92dvh] w-full flex-col rounded-t-[28px] bg-white shadow-xl sm:max-h-none sm:rounded-3xl dark:bg-slate-900 ${maxWidthClass}`}
            initial={{ opacity: 0, scale: 0.98, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 24 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="flex shrink-0 items-center justify-between gap-4 px-5 pb-1 pt-5">
              <h2 className="font-display text-lg font-extrabold text-slate-900 dark:text-white">{title}</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="modal-body min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-2" style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    </MotionConfig>
  );
}
