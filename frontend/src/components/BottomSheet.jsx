import { useEffect } from 'react';

// Mobile "More" menu (components/BottomNav.jsx) and any other small
// mobile-only action list — slides up from the bottom instead of
// Modal.jsx's centered card, since that's the native mobile-app convention
// for a menu triggered from a bottom tab bar. Same open/backdrop/Escape/
// body-scroll-lock contract as Modal.jsx, just anchored and shaped
// differently (rounded top corners only, a drag-handle bar for affordance).
export default function BottomSheet({ open, onClose, title, children }) {
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
      className="fixed inset-0 z-40 flex items-end bg-slate-900/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className="sheet-panel max-h-[80vh] w-full overflow-y-auto rounded-t-3xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl dark:bg-slate-900">
        <div className="flex justify-center pt-2.5">
          <span className="h-1.5 w-10 rounded-full bg-slate-200 dark:bg-slate-700" />
        </div>
        {title && (
          <h2 className="px-5 pt-3 font-display text-base font-bold text-slate-900 dark:text-white">{title}</h2>
        )}
        <div className="px-2 pb-3 pt-2">{children}</div>
      </div>
    </div>
  );
}
