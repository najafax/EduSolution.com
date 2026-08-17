import { useCallback, useRef, useState } from 'react';
import ConfirmDialog from '../components/ConfirmDialog';

// The one place every destructive-action confirmation in the app goes
// through — replaces both the browser's native window.confirm() (unstyled,
// ignores dark mode, inconsistent across browsers) and the old "delete
// instantly, offer a few seconds to undo" pattern some list pages used
// (see lib/useUndoableDelete.js), which showed no prompt at all before the
// action fired. `confirm()` is awaited exactly like window.confirm() —
// `if (!(await confirm({...}))) return;` — but resolves only once the
// person actually clicks Confirm or Cancel (or Escape/backdrop, which counts
// as Cancel), and renders the same themed ConfirmDialog everywhere so a
// mis-click on a Delete/Void/Reset button always has to be confirmed the
// same way before anything actually happens.
export function useConfirm() {
  const [options, setOptions] = useState(null);
  const resolveRef = useRef(null);

  const confirm = useCallback(
    ({ title = 'Are you sure?', message = '', confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = true } = {}) =>
      new Promise((resolve) => {
        resolveRef.current = resolve;
        setOptions({ title, message, confirmLabel, cancelLabel, danger });
      }),
    [],
  );

  function settle(result) {
    resolveRef.current?.(result);
    resolveRef.current = null;
    setOptions(null);
  }

  const confirmDialog = (
    <ConfirmDialog
      open={options !== null}
      title={options?.title}
      message={options?.message}
      confirmLabel={options?.confirmLabel}
      cancelLabel={options?.cancelLabel}
      danger={options?.danger}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );

  return { confirm, confirmDialog };
}
