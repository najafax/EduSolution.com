import { useEffect, useState } from 'react';

// True while a fixed bar should be tucked away: the page is being scrolled
// down, away from the top. It comes back on any upward scroll, near the top
// or bottom of the page, after the scroll settles, and whenever a form field
// loses focus. It stays hidden while a field has focus (the on-screen
// keyboard already takes the space). `resetKey` (e.g. the pathname) shows it
// again on navigation.
const THRESHOLD = 10; // px of travel in one direction before it reacts
const TOP_ZONE = 80;
const BOTTOM_ZONE = 48;
const IDLE_MS = 1500;
const isField = (el) => el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);

export function useHideOnScroll({ enabled = true, resetKey } = {}) {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    setHidden(false);
    if (!enabled) return undefined;

    let lastY = window.scrollY;
    let travel = 0;
    let idleTimer;
    let ticking = false;

    const nearEdge = (y) =>
      y <= TOP_ZONE || window.innerHeight + y >= document.documentElement.scrollHeight - BOTTOM_ZONE;

    const update = () => {
      ticking = false;
      // Clamp iOS rubber-banding (negative / past-the-end values).
      const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const y = Math.min(Math.max(window.scrollY, 0), max);
      const delta = y - lastY;
      lastY = y;
      if (delta === 0) return;
      // Reset accumulated travel when direction flips.
      travel = Math.sign(delta) === Math.sign(travel) ? travel + delta : delta;
      if (nearEdge(y)) setHidden(false);
      else if (travel > THRESHOLD) setHidden(true);
      else if (travel < -THRESHOLD) setHidden(false);
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (!isField(document.activeElement)) setHidden(false);
      }, IDLE_MS);
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    };
    const onFocusIn = (e) => isField(e.target) && setHidden(true);
    const onFocusOut = (e) => isField(e.target) && setHidden(false);

    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      clearTimeout(idleTimer);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, [enabled, resetKey]);

  return hidden;
}
