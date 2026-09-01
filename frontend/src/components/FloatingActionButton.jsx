import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

const BUTTON_SIZE = 56; // h-14 w-14 (3.5rem)
const EDGE_MARGIN = 8;
// Keeps the button from being dragged down behind BottomNav.jsx's floating
// glass dock (the dock's own bottom margin + height, plus a little
// breathing room above it) — BottomNav has no ref exposed here, so this is
// a fixed estimate rather than a live measurement. Bumped when BottomNav
// became a floating dock (0.875rem margin + ~64px tall) rather than a bar
// flush against the screen edge.
const BOTTOM_RESERVE = 96;
const DRAG_THRESHOLD = 6; // px of movement before a press counts as a drag, not a tap
const STORAGE_KEY = 'edusolution_fab_position';

// A translucent "liquid glass" droplet rather than a flat, opaque gradient
// circle: backdrop-blur + a semi-transparent lagoon gradient (90% opacity,
// not 100%) so the page behind softly shows through, a light glass-edge
// border, and a soft lagoon-tinted glow shadow — the same glass material
// BottomNav.jsx's own dock uses, so the two read as one connected surface.
const BASE_CLASSES =
  'fixed z-20 flex h-14 w-14 touch-none select-none items-center justify-center overflow-hidden rounded-full border border-white/40 bg-gradient-to-br from-lagoon-500/90 to-lagoon-700/90 text-white shadow-[0_10px_28px_-6px_rgba(14,124,134,0.55)] backdrop-blur-md hover:from-lagoon-400/90 hover:to-lagoon-600/90 sm:hidden dark:border-white/15';
// Default spot — bottom-right, clearing BottomNav's floating dock — used
// until a position has been measured or restored (see the layout effect
// below). Raised from 5.5rem to 6rem to clear the dock's own extra margin.
const DEFAULT_STYLE = { right: '1.25rem', bottom: 'calc(6rem + env(safe-area-inset-bottom))' };
// A small blurred white blob near the top-left of the button — a droplet's
// specular highlight, the detail that reads as "glass/water" rather than a
// plain translucent circle. Purely decorative and static (aria-hidden,
// pointer-events-none, no animation).
const GlossHighlight = (
  <span aria-hidden="true" className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 rounded-full bg-white/60 blur-[3px]" />
);

const PlusIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <path d="M12 5v14M5 12h14" strokeLinecap="round" />
  </svg>
);

function clamp(pos) {
  const maxX = Math.max(window.innerWidth - BUTTON_SIZE - EDGE_MARGIN, EDGE_MARGIN);
  const maxY = Math.max(window.innerHeight - BUTTON_SIZE - BOTTOM_RESERVE, EDGE_MARGIN);
  return {
    x: Math.min(Math.max(pos.x, EDGE_MARGIN), maxX),
    y: Math.min(Math.max(pos.y, EDGE_MARGIN), maxY),
  };
}

function loadStoredPosition() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number') return null;
    return clamp(parsed);
  } catch {
    return null;
  }
}

// Mobile-only "add new" shortcut, styled as a translucent "liquid glass"
// droplet (see BASE_CLASSES/GlossHighlight above) matching BottomNav.jsx's
// own floating glass dock. Fixed bottom-right by default, but
// user-draggable anywhere on screen — a plain tap still fires `to`/`onClick`
// exactly as before; only a real drag (movement past DRAG_THRESHOLD)
// repositions it instead of activating. The chosen position persists across
// visits via localStorage, so it stays wherever it was last left.
export default function FloatingActionButton({ to, onClick, label }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(() => loadStoredPosition());
  const [dragging, setDragging] = useState(false);
  const dragState = useRef(null); // { startX, startY, originX, originY, moved }
  const justDraggedRef = useRef(false);

  // No stored position yet: measure where the default CSS (right/bottom,
  // including the safe-area env()) actually placed the button, and adopt
  // that as the initial explicit x/y — so dragging starts from the exact
  // spot the button was already visually sitting at, with no jump.
  useLayoutEffect(() => {
    if (pos || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    setPos(clamp({ x: rect.left, y: rect.top }));
  }, [pos]);

  useEffect(() => {
    function handleResize() {
      setPos((current) => (current ? clamp(current) : current));
    }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  function handlePointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    const rect = ref.current.getBoundingClientRect();
    dragState.current = { startX: e.clientX, startY: e.clientY, originX: rect.left, originY: rect.top, moved: false };
    ref.current.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e) {
    const drag = dragState.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    drag.moved = true;
    setDragging(true);
    setPos(clamp({ x: drag.originX + dx, y: drag.originY + dy }));
  }

  function handlePointerUp(e) {
    const drag = dragState.current;
    dragState.current = null;
    setDragging(false);
    if (drag?.moved) {
      justDraggedRef.current = true;
      setPos((current) => {
        if (current) localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
        return current;
      });
    }
    if (ref.current?.hasPointerCapture?.(e.pointerId)) ref.current.releasePointerCapture(e.pointerId);
  }

  // The click event that follows a drag's pointerup would otherwise still
  // activate `to`/`onClick` — this is the guard that makes a drag
  // reposition the button instead of navigating/opening the form it's for.
  function handleClick(e) {
    if (justDraggedRef.current) {
      justDraggedRef.current = false;
      e.preventDefault();
      return;
    }
    onClick?.(e);
  }

  const style = pos ? { left: pos.x, top: pos.y, transition: dragging ? 'none' : undefined } : DEFAULT_STYLE;
  const className = `${BASE_CLASSES} ${dragging ? 'scale-105 cursor-grabbing' : 'cursor-grab'}`;
  const dragHandlers = {
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: handlePointerUp,
  };

  if (to) {
    return (
      <Link ref={ref} to={to} className={className} style={style} aria-label={label} onClick={handleClick} {...dragHandlers}>
        {GlossHighlight}
        <PlusIcon />
      </Link>
    );
  }
  return (
    <button ref={ref} type="button" className={className} style={style} aria-label={label} onClick={handleClick} {...dragHandlers}>
      {GlossHighlight}
      <PlusIcon />
    </button>
  );
}
