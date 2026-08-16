import { useCallback, useEffect } from 'react';

const DEFAULT_MESSAGE = 'You have unsaved changes. Leave without saving?';

// Warns before losing unsaved form edits. The app uses a plain <BrowserRouter>
// (not a data router), so react-router's useBlocker/usePrompt — which require
// a data router — aren't available here; this covers the same ground with
// two lower-level mechanisms instead: a `beforeunload` listener for tab
// close/refresh/typed-URL navigation, and a capturing document click
// listener that intercepts same-origin <a>/Link clicks (e.g. Navbar links)
// while the form is dirty. It does not intercept the browser back/forward
// buttons — popstate can't be safely cancelled without a history hack, and
// that's an accepted gap here. Returns `confirmDiscard()` for callers (e.g.
// a form's own Cancel button) that navigate programmatically rather than via
// an <a> tag.
export function useUnsavedChangesGuard(isDirty, message = DEFAULT_MESSAGE) {
  useEffect(() => {
    if (!isDirty) return;
    function handleBeforeUnload(e) {
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    if (!isDirty) return;
    function handleClick(e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = e.target.closest('a');
      if (!anchor || !anchor.href) return;
      let url;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, [isDirty, message]);

  const confirmDiscard = useCallback(() => (isDirty ? window.confirm(message) : true), [isDirty, message]);

  return { confirmDiscard };
}
