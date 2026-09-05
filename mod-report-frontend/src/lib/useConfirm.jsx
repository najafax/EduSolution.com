import { useCallback, useRef, useState } from 'react';
import ConfirmDialog from '../components/ConfirmDialog';

// `if (!(await confirm({...}))) return;` — resolves once the person clicks
// Confirm or Cancel (or Escape/backdrop, which counts as Cancel).
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
