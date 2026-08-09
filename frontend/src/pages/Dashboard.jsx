import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const SHORTCUTS = [
  { to: '/clients', label: 'Clients', description: 'Manage your client list' },
  { to: '/quotes', label: 'Quotes', description: 'Create and send quotes' },
  { to: '/invoices', label: 'Invoices', description: 'Bill clients and track payments' },
  { to: '/financials', label: 'Financials', description: 'Invoiced, paid, and outstanding totals' },
];

export default function Dashboard() {
  const { user } = useAuth();

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="text-2xl font-bold text-slate-900">Welcome, {user?.name}</h1>
      <p className="mt-2 text-sm text-slate-600">{user?.email}</p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {SHORTCUTS.map((s) => (
          <Link
            key={s.to}
            to={s.to}
            className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm hover:border-indigo-300 hover:shadow-md"
          >
            <h2 className="text-lg font-semibold text-slate-900">{s.label}</h2>
            <p className="mt-1 text-sm text-slate-600">{s.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
