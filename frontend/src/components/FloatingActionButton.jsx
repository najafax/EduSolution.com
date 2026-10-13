// Retired by the Studio redesign (stage 1). This used to be a draggable
// floating "+" on every phone list page. The bottom bar's centre create
// button (components/BottomNav.jsx) is now the one create entry point on
// phones, and every page that rendered this already has its own "New X"
// header button, so a second plus button only duplicated it and could sit
// on top of content.
//
// The component is kept as a no-op, rather than deleting it and its ~20
// call sites in the same change, so this stage stays a shell-only diff;
// removing the call sites is a separate mechanical cleanup.
export default function FloatingActionButton() {
  return null;
}
