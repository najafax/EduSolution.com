import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { InvoiceIcon, TrendUpIcon, ClockIcon } from '../components/icons';

const FEATURES = [
  {
    icon: InvoiceIcon,
    title: 'Quotes & invoices',
    description: 'Create, send, and track quotes and invoices, with PDF generation built in.',
  },
  {
    icon: TrendUpIcon,
    title: 'Payments & financials',
    description: 'Record payments, monitor overdue balances, and see revenue and profit at a glance.',
  },
  {
    icon: ClockIcon,
    title: 'Automated & organized',
    description: 'Recurring invoices, payment reminders, and an activity log — all handled for you.',
  },
];

export default function Landing() {
  const { user } = useAuth();

  return (
    <div>
      <section className="overflow-hidden border-b border-slate-200 bg-gradient-to-b from-indigo-50 via-white to-white dark:border-slate-800 dark:from-slate-900 dark:via-slate-950 dark:to-slate-950">
        <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 sm:py-24">
          <img src="/logo-symbol.png" alt="" className="mx-auto h-14 w-14" />
          <h1 className="mt-6 text-3xl font-bold tracking-tight text-slate-900 sm:text-5xl dark:text-white">
            Welcome to <span className="text-indigo-600">Edu Solutions</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base text-slate-600 sm:text-lg dark:text-slate-400">
            EduSolutions Maldives is a registered Educational Technology Consultancy business connecting and
            adapting the latest edtech innovations to meet the evolving needs of 21st-century education.
          </p>
          <div className="mt-10 flex flex-col justify-center gap-3 sm:flex-row sm:gap-4">
            {user ? (
              <Link
                to="/dashboard"
                className="flex min-h-11 items-center justify-center rounded-md bg-indigo-600 px-6 text-sm font-semibold text-white hover:bg-indigo-500"
              >
                Go to dashboard
              </Link>
            ) : (
              <Link
                to="/login"
                className="flex min-h-11 items-center justify-center rounded-md bg-indigo-600 px-6 text-sm font-semibold text-white hover:bg-indigo-500"
              >
                Log in
              </Link>
            )}
            <a
              href="https://www.edusolutionsmv.com"
              target="_blank"
              rel="noreferrer"
              className="flex min-h-11 items-center justify-center rounded-md border border-slate-300 px-6 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Visit edusolutionsmv.com
            </a>
          </div>
        </div>
      </section>

      <section className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/50">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl dark:text-white">
              Everything your business needs in one place
            </h2>
            <p className="mt-3 text-sm text-slate-600 sm:text-base dark:text-slate-400">
              EduSolution.com brings your clients, quotes, invoices, and payments together, so you can spend less
              time on admin and more time on what matters.
            </p>
          </div>
          <div className="mt-10 grid gap-6 sm:grid-cols-3">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="rounded-lg bg-white p-6 shadow-sm dark:bg-slate-900">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
                  <feature.icon />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-slate-900 dark:text-white">{feature.title}</h3>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-slate-200 dark:border-slate-800">
        <div className="mx-auto max-w-4xl px-4 py-14 sm:px-6 sm:py-20">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl dark:text-white">Our mission</h2>
          <p className="mt-4 text-base leading-relaxed text-slate-600 sm:text-lg dark:text-slate-400">
            Our mission is to empower educational institutions with smart, scalable, and futuristic solutions that
            drive excellence in teaching, learning, and administration.
          </p>
        </div>
      </section>

      <section className="bg-indigo-600">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-4 py-12 text-center sm:flex-row sm:justify-between sm:px-6 sm:text-left">
          <div>
            <h2 className="text-xl font-bold text-white sm:text-2xl">Ready to get started?</h2>
            <p className="mt-1 text-sm text-indigo-100">Log in to manage your clients, quotes, and invoices.</p>
          </div>
          {user ? (
            <Link
              to="/dashboard"
              className="flex min-h-11 items-center justify-center rounded-md bg-white px-6 text-sm font-semibold text-indigo-600 hover:bg-indigo-50"
            >
              Go to dashboard
            </Link>
          ) : (
            <Link
              to="/login"
              className="flex min-h-11 items-center justify-center rounded-md bg-white px-6 text-sm font-semibold text-indigo-600 hover:bg-indigo-50"
            >
              Log in
            </Link>
          )}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-10 text-center sm:px-6">
        <img src="/logo-wordmark.png" alt="Edu Solutions" className="mx-auto h-10 w-auto dark:brightness-0 dark:invert" />
        <a
          href="https://www.edusolutionsmv.com"
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-block text-sm font-medium text-indigo-600 hover:text-indigo-500"
        >
          www.edusolutionsmv.com
        </a>
      </section>
    </div>
  );
}
