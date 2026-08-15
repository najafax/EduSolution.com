import { useRef, useState } from 'react';
import { useToast } from '../context/ToastContext';

// Delete-with-a-few-seconds-to-undo, for both single-row and bulk delete
// actions on list pages. The actual API call is delayed rather than fired
// immediately: ids go into `pendingIds` (which callers filter their
// rendered list by, so deleted-but-not-yet-committed rows disappear right
// away) and a timer fires the real DELETE request after the toast's
// window closes. Clicking "Undo" in that window just clears the timer and
// un-hides the row(s) — no API call is ever made. This replaces the old
// `confirm()` dialog: undo is a gentler safety net than a blocking prompt.
export function useUndoableDelete(removeOne) {
  const { toast } = useToast();
  const [pendingIds, setPendingIds] = useState(() => new Set());
  const timers = useRef({});
  const UNDO_WINDOW_MS = 5000;

  function deleteWithUndo(ids, label) {
    setPendingIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });

    const timer = setTimeout(async () => {
      for (const id of ids) {
        try {
          await removeOne(id);
        } catch {
          // Already gone, or blocked by a server-side guard (e.g. an
          // invoice with recorded payments) — either way there's nothing
          // useful to surface this long after the user acted, so it's
          // silently left in `pendingIds` (hidden) rather than reappearing
          // unexpectedly. The next full list refresh reconciles it.
        }
        delete timers.current[id];
      }
    }, UNDO_WINDOW_MS);
    ids.forEach((id) => {
      timers.current[id] = timer;
    });

    toast(label, {
      type: 'info',
      duration: UNDO_WINDOW_MS,
      action: {
        label: 'Undo',
        onClick: () => {
          ids.forEach((id) => {
            if (timers.current[id]) {
              clearTimeout(timers.current[id]);
              delete timers.current[id];
            }
          });
          setPendingIds((prev) => {
            const next = new Set(prev);
            ids.forEach((id) => next.delete(id));
            return next;
          });
        },
      },
    });
  }

  return { pendingIds, deleteWithUndo };
}
