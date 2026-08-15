import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const FEATURES = [
  {
    title: 'Quotes & invoices',
    description: 'Create, send, and track quotes and invoices, with PDF generation built in.',
  },
  {
    title: 'Payments & financials',
    description: 'Record payments, monitor overdue balances, and see revenue and profit at a glance.',
  },
  {
    title: 'Automated & organized',
    description: 'Recurring invoices, payment reminders, and an activity log — all handled for you.',
  },
];

export default function Landing() {
  const { user } = useAuth();

  return (
    <div>
      <section className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6 sm:py-24">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-6xl dark:text-white">
          Business, simplified.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-base text-slate-600 sm:text-lg dark:text-slate-400">
          EduSolution.com brings your clients, quotes, invoices, and payments together in one place.
        </p>
        <div className="mt-10 flex flex-col justify-center gap-3 sm:flex-row sm:gap-4">
          {user ? (
            <Link
              to="/dashboard"
              className="rounded-md bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-500"
            >
              Go to dashboard
            </Link>
          ) : (
            <Link
              to="/login"
              className="rounded-md bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-500"
            >
              Log in
            </Link>
          )}
        </div>
      </section>

      <section className="border-t border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/50">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-14 sm:gap-8 sm:px-6 sm:py-20 sm:grid-cols-3">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="rounded-lg bg-white p-6 shadow-sm dark:bg-slate-900">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{feature.title}</h2>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
