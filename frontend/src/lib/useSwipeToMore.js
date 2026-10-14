import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const MIN_DISTANCE_PX = 90;
const MAX_VERTICAL_PX = 60;

// True when the touch began somewhere a horizontal drag already means
// something else: a form control, a pop-up, or a horizontally scrolling
// area (the dashboard's attention carousel, wide tables, chip rows).
function startsInDragArea(target) {
  if (!(target instanceof Element)) return false;
  if (target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], .modal-panel, .sheet-panel')) {
    return true;
  }
  for (let el = target; el && el !== document.body; el = el.parentElement) {
    const { overflowX } = getComputedStyle(el);
    if ((overflowX === 'auto' || overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1) return true;
  }
  return false;
}

// Phones only: swipe left-to-right anywhere on the page to open the More
// page (same page as the bottom bar's More tab); on More, swipe
// right-to-left to close it again, mirroring the tab's own toggle.
export function useSwipeToMore({ enabled }) {
  const { pathname, key } = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!enabled) return;
    let start = null;

    function onStart(e) {
      if (window.innerWidth >= 640 || e.touches.length !== 1) {
        start = null;
        return;
      }
      const t = e.touches[0];
      start = startsInDragArea(e.target) ? null : { x: t.clientX, y: t.clientY };
    }

    function onEnd(e) {
      if (!start) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      start = null;
      if (Math.abs(dy) > MAX_VERTICAL_PX || Math.abs(dx) < MIN_DISTANCE_PX || Math.abs(dx) < Math.abs(dy) * 2) return;
      if (dx > 0 && pathname !== '/more') navigate('/more');
      else if (dx < 0 && pathname === '/more') {
        if (key !== 'default') navigate(-1);
        else navigate('/dashboard');
      }
    }

    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchend', onEnd);
    };
  }, [enabled, pathname, key, navigate]);
}
