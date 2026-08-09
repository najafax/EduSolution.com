import { Link } from 'react-router-dom';

const CLASSES =
  'fixed z-20 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg hover:bg-indigo-500 sm:hidden';
const STYLE = { right: '1.25rem', bottom: 'calc(1.25rem + env(safe-area-inset-bottom))' };

const PlusIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <path d="M12 5v14M5 12h14" strokeLinecap="round" />
  </svg>
);

// Mobile-only "add new" shortcut, fixed bottom-right. Pass `to` to navigate
// (quotes/invoices open a dedicated /new route) or `onClick` for pages like
// Clients that toggle an inline form instead of routing.
export default function FloatingActionButton({ to, onClick, label }) {
  if (to) {
    return (
      <Link to={to} className={CLASSES} style={STYLE} aria-label={label}>
        <PlusIcon />
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={CLASSES} style={STYLE} aria-label={label}>
      <PlusIcon />
    </button>
  );
}
