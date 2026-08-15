import { createContext, useCallback, useContext, useRef, useState } from 'react';

const ToastContext = createContext(null);

// A fixed bottom-right stack of transient notifications, replacing the
// inline "Saved."/error-text-under-the-form pattern most pages used
// before — those still work as a fallback where useful, this is for
// actions that happen away from a form (delete, send, duplicate, bulk
// actions) where there's no obvious place for inline text to land.
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef({});

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    if (timers.current[id]) {
      clearTimeout(timers.current[id]);
      delete timers.current[id];
    }
  }, []);

  // action, if given, renders as a button (e.g. "Undo") inside the toast —
  // its onClick fires and the toast dismisses either way. duration is ms
  // before auto-dismiss; pass null to require manual/action dismissal.
  const toast = useCallback(
    (message, { type = 'info', duration = 4000, action } = {}) => {
      const id = Math.random().toString(36).slice(2);
      setToasts((list) => [...list, { id, message, type, action }]);
      if (duration !== null) {
        timers.current[id] = setTimeout(() => dismiss(id), duration);
      }
      return id;
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-lg border px-4 py-3 shadow-lg ${TONE_CLASSES[t.type] || TONE_CLASSES.info}`}
          >
            <p className="flex-1 text-sm">{t.message}</p>
            {t.action && (
              <button
                type="button"
                onClick={() => {
                  t.action.onClick();
                  dismiss(t.id);
                }}
                className="shrink-0 text-sm font-semibold underline underline-offset-2 hover:no-underline"
              >
                {t.action.label}
              </button>
            )}
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
              className="shrink-0 text-lg leading-none opacity-60 hover:opacity-100"
            >
              &times;
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const TONE_CLASSES = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  error: 'border-red-200 bg-red-50 text-red-800',
  info: 'border-slate-200 bg-white text-slate-700',
};

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
