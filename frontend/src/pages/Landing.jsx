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
      <section className="overflow-hidden border-b border-slate-200 bg-gradient-to-br from-indigo-50 via-white to-orange-50 dark:border-slate-800 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-2 lg:gap-16">
          <div>
            <img src="/logo-symbol.png" alt="" className="h-14 w-14" />
            <h1 className="mt-6 text-3xl font-bold tracking-tight text-slate-900 sm:text-5xl dark:text-white">
              Welcome to <span className="text-indigo-600">Edu Solutions</span>
            </h1>
            <p className="mt-6 text-base text-slate-600 sm:text-lg dark:text-slate-400">
              EduSolutions Maldives is a registered Educational Technology Consultancy business based in the
              Maldives. We specialize in connecting and adapting the latest edtech innovations to meet the evolving
              needs of 21st-century education.
            </p>
            <p className="mt-4 text-base text-slate-600 sm:text-lg dark:text-slate-400">
              Our mission is to empower educational institutions with smart, scalable, and futuristic solutions that
              drive excellence in teaching, learning, and administration.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:gap-4">
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
                className="flex min-h-11 items-center justify-center rounded-md border border-slate-300 px-6 text-sm font-semibold text-slate-700 hover:bg-white dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Visit edusolutionsmv.com
              </a>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-sm lg:max-w-none">
            <img
              src="/ceo-hassan-najah.jpg"
              alt="Hassan Najah, Chief Executive Officer of Edu Solutions"
              className="aspect-[4/5] w-full rounded-3xl object-cover shadow-xl"
            />
            <div className="absolute bottom-4 left-4 right-4 rounded-xl bg-indigo-600 px-5 py-3 text-white shadow-lg sm:right-auto sm:min-w-[220px]">
              <p className="text-base font-semibold">Hassan Najah</p>
              <p className="text-xs text-indigo-100">Chief Executive Officer</p>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/50">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-14 sm:gap-8 sm:px-6 sm:py-20 sm:grid-cols-3">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="rounded-lg bg-white p-6 shadow-sm dark:bg-slate-900">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{feature.title}</h2>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{feature.description}</p>
            </div>
          ))}
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
