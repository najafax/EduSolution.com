import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'edusolution_dashboard_shortcuts';

function loadPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      order: Array.isArray(parsed.order) ? parsed.order : [],
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden : [],
    };
  } catch {
    return null;
  }
}

// Lets a user reorder and hide their own Dashboard shortcut tiles —
// persisted per-browser in localStorage rather than server-side, since this
// is a personal display preference, not shared business data. `available`
// is the shortcut list already filtered down to what this user's
// permissions allow (see SHORTCUTS.filter(can(...)) in Dashboard.jsx);
// items are always addressed by their `to` path. Returns both `visible`
// (customized order, hidden ones dropped — what the dashboard itself
// renders) and `orderedAvailable` (customized order, nothing dropped —
// what the customize panel lists, so a hidden shortcut can still be
// re-shown).
export function useDashboardShortcuts(available) {
  const [prefs, setPrefs] = useState(() => loadPrefs() || { order: available.map((s) => s.to), hidden: [] });
  const availableKey = available.map((s) => s.to).join(',');

  useEffect(() => {
    // A shortcut that just became available (e.g. a permission was granted)
    // and isn't in the stored order yet gets appended, so it isn't silently
    // dropped from view the first time this runs after the grant.
    setPrefs((p) => {
      const known = new Set(p.order);
      const missing = available.map((s) => s.to).filter((to) => !known.has(to));
      if (missing.length === 0) return p;
      return { ...p, order: [...p.order, ...missing] };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableKey]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  }, [prefs]);

  const byTo = Object.fromEntries(available.map((s) => [s.to, s]));
  const orderedAvailable = prefs.order.map((to) => byTo[to]).filter(Boolean);
  const hiddenSet = new Set(prefs.hidden);
  const visible = orderedAvailable.filter((s) => !hiddenSet.has(s.to));

  const toggleHidden = useCallback((to) => {
    setPrefs((p) => ({
      ...p,
      hidden: p.hidden.includes(to) ? p.hidden.filter((t) => t !== to) : [...p.hidden, to],
    }));
  }, []);

  const move = useCallback((to, direction) => {
    setPrefs((p) => {
      const idx = p.order.indexOf(to);
      const swapWith = idx + direction;
      if (idx === -1 || swapWith < 0 || swapWith >= p.order.length) return p;
      const next = [...p.order];
      [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
      return { ...p, order: next };
    });
  }, []);

  const reset = useCallback(() => {
    setPrefs({ order: available.map((s) => s.to), hidden: [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableKey]);

  return {
    visible,
    orderedAvailable,
    hiddenSet,
    toggleHidden,
    moveUp: (to) => move(to, -1),
    moveDown: (to) => move(to, 1),
    reset,
  };
}
