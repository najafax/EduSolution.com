import { useEffect, useState } from 'react';

// Delays a value by `delayMs` after it stops changing — lets a controlled
// input update instantly (so typing never feels laggy) while whatever reads
// the debounced copy (a search-triggered fetch, most commonly) only reacts
// once the person pauses. Without this, every keystroke fired its own
// immediate fetch, which flipped a list page between its loading skeleton
// and the real results on every character and made the page visibly jump
// as the two swapped in and out.
export function useDebouncedValue(value, delayMs = 300) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);

  return debounced;
}
