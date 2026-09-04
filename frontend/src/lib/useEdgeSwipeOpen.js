import { useEffect, useRef } from 'react';

// A touch starting within this many px of the left edge is treated as an
// edge swipe — narrow enough that an ordinary tap/scroll anywhere else on
// the page is never mistaken for one.
const EDGE_ZONE_PX = 24;
// How far right the touch has to travel, net, before it counts as "open
// the drawer" rather than a stray brush of the edge.
const OPEN_THRESHOLD_PX = 60;
// Once vertical movement pulls ahead of horizontal by this much, the
// gesture reads as a scroll, not a swipe — stop tracking (and stop calling
// preventDefault) so a vertical scroll that happens to start near the edge
// is never hijacked.
const VERTICAL_CANCEL_PX = 10;
// Matches Tailwind's `xl` breakpoint — Sidebar is a persistent, always-open
// panel at that width and up (see Sidebar.jsx/App.jsx), so an edge swipe
// there has no drawer to open and should fall back to whatever the browser
// would normally do. The default for `breakpointPx` below — a caller whose
// own drawer disappears at a different width (e.g. MarketingLayout.jsx's
// own drawer, gone at `sm:`) passes its own breakpoint instead.
const XL_BREAKPOINT_PX = 1280;

// Phones ship a system/browser "swipe from the left edge to go back"
// gesture that has nothing to do with this app's own navigation — a user
// meaning to open the nav drawer (the same drawer the top-left hamburger
// already opens, see Navbar.jsx) instead gets bounced to whatever page
// they were on before, which on a single-page app often reads as the
// whole app misbehaving rather than "the browser went back." This hook
// claims that same edge gesture for opening the drawer instead: a touch
// starting within EDGE_ZONE_PX of the left edge that moves right past
// OPEN_THRESHOLD_PX calls `onOpen()` and prevents the browser's own
// default handling of the gesture throughout, rather than fighting it only
// after the fact.
//
// This is a best-effort override, not a guarantee — Chrome for Android
// generally respects `preventDefault()` on the touchmove here, but iOS
// Safari's edge-swipe-back is a system-level gesture recognizer that page
// JavaScript cannot always suppress, particularly in standalone/installed-
// PWA mode. Pair with the global `overscroll-behavior-x: none` in
// index.css, which helps the same gesture in some browsers/versions but is
// also not a complete fix on its own — there is no combination of web APIs
// that reliably wins against it on every platform.
export function useEdgeSwipeOpen({ enabled, onOpen, breakpointPx = XL_BREAKPOINT_PX }) {
  const stateRef = useRef({ tracking: false, startX: 0, startY: 0 });

  useEffect(() => {
    if (!enabled) return;

    function handleTouchStart(e) {
      const touch = e.touches[0];
      if (!touch || touch.clientX > EDGE_ZONE_PX || window.innerWidth >= breakpointPx) return;
      stateRef.current = { tracking: true, startX: touch.clientX, startY: touch.clientY };
    }

    function handleTouchMove(e) {
      const state = stateRef.current;
      if (!state.tracking) return;
      const touch = e.touches[0];
      if (!touch) return;
      const deltaX = touch.clientX - state.startX;
      const deltaY = touch.clientY - state.startY;

      if (Math.abs(deltaY) - Math.abs(deltaX) > VERTICAL_CANCEL_PX) {
        state.tracking = false;
        return;
      }
      if (deltaX <= 0) return;

      // Claiming the gesture as our own from here on — this is what keeps
      // the browser from treating the rest of this same touch as its own
      // back-navigation swipe.
      e.preventDefault();

      if (deltaX >= OPEN_THRESHOLD_PX) {
        state.tracking = false;
        onOpen();
      }
    }

    function handleTouchEnd() {
      stateRef.current.tracking = false;
    }

    // { passive: false } is required for preventDefault() to have any
    // effect on a touchmove listener — browsers default touch listeners to
    // passive (never call preventDefault, so the browser can start
    // scrolling/navigating immediately) for scroll performance.
    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });
    document.addEventListener('touchcancel', handleTouchEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
      document.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [enabled, onOpen, breakpointPx]);
}
