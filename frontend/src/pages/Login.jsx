import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { IDLE_LOGOUT_MESSAGE_KEY } from '../components/IdleTimeoutMonitor';
import {
  UsersIcon,
  QuoteIcon,
  InvoiceIcon,
  BankIcon,
  ClockIcon,
  LicenseIcon,
  CheckCircleIcon,
  GraduationCapIcon,
} from '../components/icons';

// Icon-chip color per feature — reuses KpiCard's own tone palette (see
// KpiCard.jsx's TONES) so "money" cards read emerald and "time-sensitive"
// cards read amber the same way a real KpiCard would, rather than a
// one-off palette invented just for this page. Clients/Quotes/Invoices/
// Licenses stay lagoon (the app's neutral/brand hue) since they're core
// modules, not a positive/warning signal in their own right.
const TONE = {
  lagoon: 'bg-lagoon-50 text-lagoon-600 dark:bg-lagoon-950 dark:text-lagoon-400',
  emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400',
  amber: 'bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400',
};

const FEATURES = [
  {
    icon: UsersIcon,
    tone: 'lagoon',
    title: 'Clients',
    description: "Keep every client's contact details, and their full quote and invoice history, in one place.",
  },
  {
    icon: QuoteIcon,
    tone: 'lagoon',
    title: 'Quotes',
    description: 'Send professional quotes your client can accept or decline online, then convert one to an invoice in a click.',
  },
  {
    icon: InvoiceIcon,
    tone: 'lagoon',
    title: 'Invoices',
    description: 'Generate polished PDF invoices, email them straight to a client, and track balances due automatically.',
  },
  {
    icon: BankIcon,
    tone: 'emerald',
    title: 'Payments & financials',
    description: 'Record payments as they land, watch your bank balance, and see revenue and profit at a glance.',
  },
  {
    icon: ClockIcon,
    tone: 'amber',
    title: 'Recurring & reminders',
    description: 'Recurring invoices generate themselves on schedule, and overdue reminders go out automatically.',
  },
  {
    icon: LicenseIcon,
    tone: 'lagoon',
    title: 'License tracking',
    description: "Track a client's software licenses, with expiry alerts and automatic renewal the moment they pay.",
  },
];

const TRUST_ITEMS = ['PDF invoicing', 'Client self-serve links', 'Automated reminders', 'Recurring billing', 'Role-based access'];

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

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xl sm:p-8 dark:border-slate-700 dark:bg-slate-900">
      <h2 className="text-xl font-bold text-slate-900 dark:text-white">Log in</h2>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        Accounts are created by an administrator — contact yours if you need access.
      </p>

      {notice && (
        <p className="mt-4 rounded-md bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
          {notice}
        </p>
      )}

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
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
            className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-950 dark:text-white"
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
            className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-950 dark:text-white"
          />
          <p className="mt-1 text-right">
            <Link to="/forgot-password" className="text-xs font-medium text-lagoon-600 hover:text-lagoon-500">
              Forgot password?
            </Link>
          </p>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="mt-2 min-h-11 rounded-md bg-lagoon-600 px-4 py-2 text-sm font-semibold text-white hover:bg-lagoon-500 disabled:opacity-60"
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
      <div aria-hidden className="absolute -right-10 -top-10 h-56 w-56 rounded-full bg-lagoon-200/50 blur-3xl dark:bg-lagoon-800/20" />
      <div aria-hidden className="absolute -bottom-10 -left-10 h-48 w-48 rounded-full bg-emerald-100/50 blur-3xl dark:bg-emerald-900/10" />
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
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-12 sm:px-6 sm:py-20 lg:grid-cols-2 lg:gap-16 lg:py-24">
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
            <h1 className="mt-5 font-display text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl dark:text-white">
              Welcome to <span className="text-lagoon-600">Edu Solutions</span>
            </h1>
            <p className="mt-4 font-display text-lg font-bold text-slate-700 sm:text-xl dark:text-slate-300">
              Quotes, invoices, and payments — handled for you.
            </p>
            <p className="mx-auto mt-4 max-w-xl text-base text-slate-600 sm:text-lg lg:mx-0 dark:text-slate-400">
              EduSolutions Maldives is a registered Educational Technology Consultancy business connecting and
              adapting the latest edtech innovations to meet the evolving needs of 21st-century education.
            </p>
            <div className="mt-8 flex justify-center lg:justify-start">
              <a
                href="https://www.edusolutionsmv.com"
                target="_blank"
                rel="noreferrer"
                className="flex min-h-11 items-center justify-center rounded-md border border-slate-300 px-6 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Visit edusolutionsmv.com
              </a>
            </div>
            <div className="mt-8 flex flex-wrap justify-center gap-x-5 gap-y-2 lg:justify-start">
              {TRUST_ITEMS.map((item) => (
                <span key={item} className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <CheckCircleIcon width={14} height={14} className="text-lagoon-600 dark:text-lagoon-400" />
                  {item}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/50">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl dark:text-white">
              Everything your business needs in one place
            </h2>
            <p className="mt-3 text-sm text-slate-600 sm:text-base dark:text-slate-400">
              EduSolution.com brings your clients, quotes, invoices, and payments together, so you can spend less
              time on admin and more time on what matters.
            </p>
          </div>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <div
                key={feature.title}
                className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-slate-700 dark:bg-slate-900"
              >
                <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${TONE[feature.tone]}`}>
                  <feature.icon />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-slate-900 dark:text-white">{feature.title}</h3>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{feature.description}</p>
              </div>
            ))}
          </div>

          {/* A supplementary mention, not a 7th grid card — EduPage is a
              real, separate school-management platform (aSc EduPage,
              edupage.org), not a module of this app, so it gets its own
              visually distinct panel rather than blending into the FEATURES
              grid above. */}
          <div className="mx-auto mt-8 max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900 sm:p-8">
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-lagoon-50 text-lagoon-600 dark:bg-lagoon-950 dark:text-lagoon-400">
                <GraduationCapIcon />
              </div>
              <div className="flex-1">
                <p className="text-xs font-bold tracking-wide text-lagoon-600 uppercase dark:text-lagoon-400">
                  Technology partner
                </p>
                <h3 className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">
                  We also bring EduPage to Maldivian schools
                </h3>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                  Edu Solutions Pvt Ltd is an authorized distributor of EduPage products in the Maldives — a
                  cloud-based school management platform used by schools worldwide for timetabling, attendance,
                  digital class registers, homework, and e-learning, keeping teachers, students, and parents
                  connected.
                </p>
              </div>
              <a
                href="https://www.edupage.org"
                target="_blank"
                rel="noreferrer"
                className="flex min-h-11 w-full shrink-0 items-center justify-center rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 sm:w-auto dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Learn more about EduPage
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-slate-200 dark:border-slate-800">
        <div className="mx-auto max-w-4xl px-4 py-14 text-center sm:px-6 sm:py-20">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-lagoon-200 bg-lagoon-50 px-3 py-1 text-xs font-semibold text-lagoon-700 dark:border-lagoon-800 dark:bg-lagoon-950/60 dark:text-lagoon-400">
            About EduSolutions Maldives
          </span>
          <h2 className="mt-5 font-display text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl dark:text-white">
            Our mission
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg dark:text-slate-400">
            Our mission is to empower educational institutions with smart, scalable, and futuristic solutions that
            drive excellence in teaching, learning, and administration.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-10 text-center sm:px-6">
        <img src="/logo-wordmark.png" alt="Edu Solutions" className="mx-auto h-10 w-auto dark:brightness-0 dark:invert" />
        <a
          href="https://www.edusolutionsmv.com"
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-block text-sm font-medium text-lagoon-600 hover:text-lagoon-500"
        >
          www.edusolutionsmv.com
        </a>
      </section>
    </div>
  );
}
