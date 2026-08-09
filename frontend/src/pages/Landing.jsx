import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const FEATURES = [
  {
    title: 'Track your progress',
    description: 'See exactly where you left off and what to tackle next.',
  },
  {
    title: 'Learn at your pace',
    description: 'Structured content you can revisit any time, on any device.',
  },
  {
    title: 'Secure by default',
    description: 'Your account and data are protected with modern authentication.',
  },
];

export default function Landing() {
  const { user } = useAuth();

  return (
    <div>
      <section className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6 sm:py-24">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-6xl">
          Learning, simplified.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-base text-slate-600 sm:text-lg">
          EduSolution.com brings your courses, progress, and resources together in one place.
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
            <>
              <Link
                to="/signup"
                className="rounded-md bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-500"
              >
                Get started
              </Link>
              <Link
                to="/login"
                className="rounded-md border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Log in
              </Link>
            </>
          )}
        </div>
      </section>

      <section className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-14 sm:gap-8 sm:px-6 sm:py-20 sm:grid-cols-3">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="rounded-lg bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">{feature.title}</h2>
              <p className="mt-2 text-sm text-slate-600">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
