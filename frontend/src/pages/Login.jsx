import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { IDLE_LOGOUT_MESSAGE_KEY } from '../components/IdleTimeoutMonitor';
import { GraduationCapIcon } from '../components/icons';

function LoginForm() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [notice] = useState(() => {
    const idleMessage = sessionStorage.getItem(IDLE_LOGOUT_MESSAGE_KEY);
    if (idleMessage) {
      sessionStorage.removeItem(IDLE_LOGOUT_MESSAGE_KEY);
      return idleMessage;
    }
    return location.state?.message || '';
  });

  function handleChange(e) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const { token, user, permissions, sessionTimeoutMinutes } = await api.login(form);
      login(token, user, permissions, sessionTimeoutMinutes);
      navigate('/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  // Focus rings use a soft outer glow (box-shadow) layered under the
  // existing border-color change, rather than border-color alone — the
  // same premium-input treatment Stripe/Linear-style forms use, a bit more
  // considered than a flat 1px color swap.
  const inputClass =
    'mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 px-3.5 py-2 text-base shadow-sm transition-shadow focus:border-lagoon-500 focus:shadow-[0_0_0_3px_rgba(14,124,134,0.15)] focus:outline-none dark:border-slate-600 dark:bg-slate-950 dark:text-white dark:focus:shadow-[0_0_0_3px_rgba(63,169,166,0.2)]';

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-xl sm:p-9 dark:border-slate-700 dark:bg-slate-900">
      <h2 className="text-xl font-bold text-ink dark:text-white">Log in</h2>
      <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
        Accounts are created by an administrator — contact yours if you need access.
      </p>

      {notice && (
        <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
          {notice}
        </p>
      )}

      <form onSubmit={handleSubmit} className="mt-7 flex flex-col gap-5">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={form.email}
            onChange={handleChange}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={form.password}
            onChange={handleChange}
            className={inputClass}
          />
          <p className="mt-1.5 text-right">
            <Link to="/forgot-password" className="text-xs font-medium text-lagoon-600 hover:text-lagoon-500">
              Forgot password?
            </Link>
          </p>
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="mt-1 min-h-11 rounded-lg bg-lagoon-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-lagoon-600/25 transition-shadow hover:bg-lagoon-500 hover:shadow-xl hover:shadow-lagoon-600/30 disabled:opacity-60 disabled:shadow-none"
        >
          {submitting ? 'Logging in…' : 'Log in'}
        </button>
      </form>
    </div>
  );
}

function HeroLoginCard() {
  return (
    <div className="relative mx-auto max-w-sm lg:mx-0 lg:max-w-none">
      {/* Toned down from the original — a quieter, more restrained glow
          (lower opacity) reads as "quiet confidence" rather than a busy
          decorative flourish competing with the card it sits behind. */}
      <div aria-hidden className="absolute -right-10 -top-10 h-56 w-56 rounded-full bg-lagoon-200/30 blur-3xl dark:bg-lagoon-800/15" />
      <div aria-hidden className="absolute -bottom-10 -left-10 h-48 w-48 rounded-full bg-emerald-100/30 blur-3xl dark:bg-emerald-900/10" />
      <div className="relative">
        <LoginForm />
      </div>
    </div>
  );
}

export default function Login() {
  const { token, loading } = useAuth();

  // Login now doubles as the app's landing page (see App.jsx: both "/" and
  // "/login" render this component) — there is no separate Landing page
  // anymore. Every real visitor here is either signing in or already signed
  // in (there's no public signup, see routes/auth.js), so an already-
  // authenticated visit — the Navbar brand link, a stale bookmark — should
  // just continue to the dashboard rather than show a login form/marketing
  // page they have no reason to see. Same loading/token pattern as
  // ProtectedRoute.jsx, mirrored here instead of shared since the redirect
  // target and "what to show while deciding" differ.
  if (loading) {
    return <div className="flex justify-center py-24 text-slate-500 dark:text-slate-400">Loading…</div>;
  }
  if (token) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div>
      <section className="relative overflow-hidden border-b border-slate-200 bg-gradient-to-b from-lagoon-50 via-white to-white dark:border-slate-800 dark:from-slate-900 dark:via-slate-950 dark:to-slate-950">
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-2 lg:gap-20 lg:py-32">
          {/* Login form first in source order (and on mobile) — most
              visitors here are returning staff who just want to sign in,
              not a new customer discovering the product for the first
              time. lg:order-2/lg:order-1 below swap it to the right and
              put the marketing copy on the left once there's room for
              both side by side. */}
          <div className="lg:order-2">
            <HeroLoginCard />
          </div>

          <div className="text-center lg:order-1 lg:text-left">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-lagoon-200 bg-lagoon-50 px-3 py-1 text-xs font-semibold text-lagoon-700 dark:border-lagoon-800 dark:bg-lagoon-950/60 dark:text-lagoon-400">
              Educational Technology Consultancy
            </span>
            <h1 className="mt-6 text-balance font-display text-4xl font-extrabold tracking-tight text-ink sm:text-5xl dark:text-white">
              Welcome to <span className="text-lagoon-600">Edu Solutions</span>
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-base text-slate-500 sm:text-lg lg:mx-0 dark:text-slate-400">
              EduSolutions Maldives is a registered Educational Technology Consultancy, bringing the latest edtech
              innovations to schools and institutions across the Maldives to meet the evolving demands of
              21st-century education.
            </p>
            <div className="mt-9 flex justify-center lg:justify-start">
              <a
                href="https://www.edusolutionsmaldives.com"
                target="_blank"
                rel="noreferrer"
                className="flex min-h-11 items-center justify-center rounded-lg border border-slate-300 px-6 text-sm font-semibold text-slate-700 shadow-sm transition-shadow hover:shadow-md dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Visit edusolutionsmaldives.com
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/50">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          {/* EduPage is a real, separate school-management platform (aSc
              EduPage, edupage.org), not a module of this app — it gets its
              own section rather than living inside the app's own feature
              grid (removed; see git history for the 6-card "Clients/Quotes/
              Invoices/Payments & financials/Recurring & reminders/License
              tracking" grid that used to sit above this panel). Border
              dropped in favor of shadow-only — a "floating" card reads
              quieter/more premium than a bordered box on a tinted section
              background, consistent with the refined shadow tokens now
              used app-wide. */}
          <div className="mx-auto max-w-3xl rounded-2xl bg-white p-7 shadow-md dark:bg-slate-900 sm:p-9">
            <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-lagoon-50 text-lagoon-600 dark:bg-lagoon-950 dark:text-lagoon-400">
                <GraduationCapIcon />
              </div>
              <div className="flex-1">
                <p className="text-xs font-bold tracking-wide text-lagoon-600 uppercase dark:text-lagoon-400">
                  Technology partner
                </p>
                <h3 className="mt-1 text-lg font-semibold text-ink dark:text-white">
                  Also serving schools through EduPage
                </h3>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                  Edu Solutions Pvt Ltd is an authorized distributor of EduPage products in the Maldives. EduPage is
                  a cloud-based school management platform used by schools around the world to handle timetabling,
                  attendance, digital class registers, homework, and e-learning, while keeping teachers, students,
                  and parents connected.
                </p>
              </div>
              <a
                href="https://www.edupage.org"
                target="_blank"
                rel="noreferrer"
                className="flex min-h-11 w-full shrink-0 items-center justify-center rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 shadow-sm transition-shadow hover:shadow-md sm:w-auto dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Learn more about EduPage
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-slate-200 dark:border-slate-800">
        <div className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-6 sm:py-24">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-lagoon-200 bg-lagoon-50 px-3 py-1 text-xs font-semibold text-lagoon-700 dark:border-lagoon-800 dark:bg-lagoon-950/60 dark:text-lagoon-400">
            About EduSolutions Maldives
          </span>
          <h2 className="mt-6 text-balance font-display text-2xl font-extrabold tracking-tight text-ink sm:text-3xl dark:text-white">
            Our mission
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-slate-500 sm:text-lg dark:text-slate-400">
            We're committed to equipping educational institutions with smart, scalable, forward-looking solutions
            that raise the standard of teaching, learning, and administration.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12 text-center sm:px-6">
        <img src="/logo-wordmark.png" alt="Edu Solutions" className="mx-auto h-10 w-auto dark:brightness-0 dark:invert" />
        <a
          href="https://www.edusolutionsmaldives.com"
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-block text-sm font-medium text-lagoon-600 hover:text-lagoon-500"
        >
          www.edusolutionsmaldives.com
        </a>
      </section>
    </div>
  );
}
