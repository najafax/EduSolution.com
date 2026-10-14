import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import BottomSheet from './BottomSheet';
import { useToggleLink } from '../lib/useToggleLink';
import { HomeIcon, InvoiceIcon, UsersIcon, GridIcon, PlusIcon, QuoteIcon, ExpenseIcon, ChevronRightIcon } from './icons';

// Studio redesign (stage 1): four destinations plus one create button, as a
// floating pill. Material 3 and Apple's tab bar guidance both cap a bottom
// bar at five items; the old bar carried six and a second hamburger route
// to the same pages. Everything that used to have its own tab (Quotes,
// Licenses, Settings) is one tap away on the More page (pages/More.jsx),
// and Quotes shares the "Sales" tab with Invoices.
//
// Every tab is still filtered through can(module, 'view') exactly like the
// old bar was, and every create shortcut through can(module, 'manage') —
// this changes how navigation looks and is grouped, never who can reach
// what. Permission enforcement itself is unchanged (server-side).
//
// Phone-only (sm:hidden); tablets and desktop keep the sidebar.
const SALES_PATHS = ['/invoices', '/quotes', '/quote-requests', '/recurring-invoices'];

const CREATE_ITEMS = [
  { label: 'New invoice', module: 'invoices', to: '/invoices/new', Icon: InvoiceIcon },
  { label: 'New quote', module: 'quotes', to: '/quotes/new', Icon: QuoteIcon },
  { label: 'Add client', module: 'clients', to: '/clients?new=1', Icon: UsersIcon },
  { label: 'Record expense', module: 'expenses', to: '/expenses?new=1', Icon: ExpenseIcon },
];

export default function BottomNav() {
  const { can } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const toggleMore = useToggleLink('/more');

  const path = location.pathname;
  const startsWith = (to) => path === to || path.startsWith(`${to}/`);

  // "Sales" opens whichever of Invoices/Quotes this user can actually see.
  const salesTo = can('invoices', 'view') ? '/invoices' : can('quotes', 'view') ? '/quotes' : null;

  const tabs = [
    { key: 'home', to: '/dashboard', label: 'Home', Icon: HomeIcon, active: startsWith('/dashboard') },
    salesTo && { key: 'sales', to: salesTo, label: 'Sales', Icon: InvoiceIcon, active: SALES_PATHS.some(startsWith) },
    can('clients', 'view') && { key: 'clients', to: '/clients', label: 'Clients', Icon: UsersIcon, active: startsWith('/clients') },
    { key: 'more', to: '/more', label: 'More', Icon: GridIcon, active: startsWith('/more') },
  ].filter(Boolean);

  const createItems = CREATE_ITEMS.filter((item) => can(item.module, 'manage'));

  // The create button sits in the middle: after the first two tabs.
  const left = tabs.slice(0, 2);
  const right = tabs.slice(2);

  function renderTab({ key, to, label, Icon, active }) {
    const onClick = key === 'more' ? toggleMore : undefined;
    return (
      <Link
        key={key}
        to={to}
        onClick={onClick}
        aria-current={active ? 'page' : undefined}
        className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl text-[11px] font-semibold ${
          active
            ? 'bg-white/50 text-lagoon-700 shadow-inner backdrop-blur dark:bg-white/10 dark:text-lagoon-300'
            : 'text-slate-700 dark:text-slate-300'
        }`}
      >
        <Icon width={21} height={21} />
        {label}
      </Link>
    );
  }

  return (
    <>
      <nav
        aria-label="Main"
        className="fixed inset-x-3 z-30 flex items-center gap-1 rounded-[28px] border border-white/40 bg-white/25 p-1.5 shadow-xl shadow-slate-900/10 ring-1 ring-white/30 backdrop-blur-xl backdrop-saturate-200 sm:hidden dark:border-white/10 dark:bg-slate-900/30 dark:ring-white/5 dark:shadow-black/40"
        style={{ bottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
      >
        {left.map(renderTab)}
        {createItems.length > 0 && (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            aria-label="Create new"
            aria-haspopup="dialog"
            className="-mt-5 mb-0.5 flex h-14 w-14 shrink-0 items-center justify-center rounded-[20px] bg-slate-900 text-white shadow-lg shadow-slate-900/30 active:scale-95 dark:bg-lagoon-600"
          >
            <PlusIcon width={26} height={26} strokeWidth={2.2} />
          </button>
        )}
        {right.map(renderTab)}
      </nav>

      <BottomSheet open={createOpen} onClose={() => setCreateOpen(false)} title="Create">
        <ul className="flex flex-col gap-1.5">
          {createItems.map(({ label, to, Icon }) => (
            <li key={to}>
              <button
                type="button"
                onClick={() => {
                  setCreateOpen(false);
                  navigate(to);
                }}
                className="flex min-h-14 w-full items-center gap-3 rounded-2xl bg-slate-50 px-3 text-left font-semibold text-slate-900 hover:bg-slate-100 dark:bg-slate-800 dark:text-white dark:hover:bg-slate-700"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-lagoon-50 text-lagoon-700 dark:bg-lagoon-950 dark:text-lagoon-300">
                  <Icon width={19} height={19} />
                </span>
                <span className="flex-1">{label}</span>
                <ChevronRightIcon width={16} height={16} className="text-slate-400" />
              </button>
            </li>
          ))}
        </ul>
      </BottomSheet>
    </>
  );
}
