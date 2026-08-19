import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import StatusBadge from '../components/StatusBadge';
import KpiCard from '../components/KpiCard';
import {
  UsersIcon,
  QuoteIcon,
  InvoiceIcon,
  BankIcon,
  ClockIcon,
  LicenseIcon,
  SendIcon,
  CheckCircleIcon,
  TrendUpIcon,
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

const STEPS = [
  {
    icon: QuoteIcon,
    title: 'Create',
    description: 'Build a quote or invoice from your product catalog — line items, discounts, and tax computed for you.',
  },
  {
    icon: SendIcon,
    title: 'Send',
    description: 'Email it as a PDF with a secure link your client can open, accept, or pay from — no account required.',
  },
  {
    icon: CheckCircleIcon,
    title: 'Get paid',
    description: 'Record the payment and watch invoices, financials, and even license renewals update on their own.',
  },
];

const TRUST_ITEMS = ['PDF invoicing', 'Client self-serve links', 'Automated reminders', 'Recurring billing', 'Role-based access'];

function HeroPreview() {
  return (
    <div className="relative mx-auto max-w-sm lg:mx-0 lg:max-w-none">
      <div aria-hidden className="absolute -right-10 -top-10 h-56 w-56 rounded-full bg-lagoon-200/50 blur-3xl dark:bg-lagoon-800/20" />
      <div aria-hidden className="absolute -bottom-10 -left-10 h-48 w-48 rounded-full bg-emerald-100/50 blur-3xl dark:bg-emerald-900/10" />

      <div className="relative flex flex-col gap-3">
        <div className="ml-auto hidden w-full max-w-xs -rotate-1 grid-cols-2 gap-2 sm:grid">
          <KpiCard icon={<TrendUpIcon />} label="This month" value="$8,900" tone="positive" />
          <KpiCard icon={<ClockIcon />} label="Outstanding" value="$1,180" tone="warning" />
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-slate-400 dark:text-slate-500">
              <InvoiceIcon width={16} height={16} />
              <span className="text-xs font-semibold tracking-wide">INV-2026-014</span>
            </div>
            <StatusBadge status="paid" />
          </div>
          <p className="mt-4 text-xs font-medium text-slate-500 dark:text-slate-400">Billed to</p>
          <p className="font-display text-lg font-bold text-slate-900 dark:text-white">Coral Bay Academy</p>
          <p className="mt-3 font-display text-3xl font-extrabold tabular-nums text-slate-900 dark:text-white">$2,450.00</p>
          <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div className="h-full w-full rounded-full bg-emerald-500" />
          </div>
          <p className="mt-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">Paid in full</p>
        </div>
      </div>
    </div>
  );
}

export default function Landing() {
  const { user } = useAuth();

  return (
    <div>
      <section className="relative overflow-hidden border-b border-slate-200 bg-gradient-to-b from-lagoon-50 via-white to-white dark:border-slate-800 dark:from-slate-900 dark:via-slate-950 dark:to-slate-950">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-2 lg:gap-16">
          <div className="text-center lg:text-left">
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
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row sm:gap-4 lg:justify-start">
              {user ? (
                <Link
                  to="/dashboard"
                  className="flex min-h-11 items-center justify-center rounded-md bg-lagoon-600 px-6 text-sm font-semibold text-white shadow-sm shadow-lagoon-900/20 hover:bg-lagoon-500"
                >
                  Go to dashboard
                </Link>
              ) : (
                <Link
                  to="/login"
                  className="flex min-h-11 items-center justify-center rounded-md bg-lagoon-600 px-6 text-sm font-semibold text-white shadow-sm shadow-lagoon-900/20 hover:bg-lagoon-500"
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
            <div className="mt-8 flex flex-wrap justify-center gap-x-5 gap-y-2 lg:justify-start">
              {TRUST_ITEMS.map((item) => (
                <span key={item} className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <CheckCircleIcon width={14} height={14} className="text-lagoon-600 dark:text-lagoon-400" />
                  {item}
                </span>
              ))}
            </div>
          </div>

          <HeroPreview />
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
        </div>
      </section>

      <section className="border-b border-slate-200 dark:border-slate-800">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl dark:text-white">
              How it works
            </h2>
            <p className="mt-3 text-sm text-slate-600 sm:text-base dark:text-slate-400">
              From first quote to final payment, in three steps.
            </p>
          </div>
          <div className="mt-10 grid gap-8 sm:grid-cols-3 sm:gap-6">
            {STEPS.map((step, index) => (
              <div key={step.title} className="relative text-center sm:text-left">
                {index < STEPS.length - 1 && (
                  <div
                    aria-hidden
                    className="absolute top-6 left-[calc(50%+2.75rem)] hidden h-px w-[calc(100%-5.5rem)] bg-slate-200 sm:block dark:bg-slate-700"
                  />
                )}
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-lagoon-600 text-white shadow-sm shadow-lagoon-900/20 sm:mx-0">
                  <step.icon width={22} height={22} />
                </div>
                <p className="mt-4 text-xs font-bold tracking-wide text-lagoon-600 uppercase dark:text-lagoon-400">
                  Step {index + 1}
                </p>
                <h3 className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">{step.title}</h3>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/50">
        <div className="mx-auto max-w-4xl px-4 py-14 text-center sm:px-6 sm:py-20">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-lagoon-200 bg-white px-3 py-1 text-xs font-semibold text-lagoon-700 dark:border-lagoon-800 dark:bg-slate-900 dark:text-lagoon-400">
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

      <section className="bg-lagoon-600">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-4 py-12 text-center sm:flex-row sm:justify-between sm:px-6 sm:text-left">
          <div>
            <h2 className="font-display text-xl font-extrabold text-white sm:text-2xl">Ready to get started?</h2>
            <p className="mt-1 text-sm text-lagoon-100">Log in to manage your clients, quotes, and invoices.</p>
          </div>
          {user ? (
            <Link
              to="/dashboard"
              className="flex min-h-11 items-center justify-center rounded-md bg-white px-6 text-sm font-semibold text-lagoon-600 hover:bg-lagoon-50"
            >
              Go to dashboard
            </Link>
          ) : (
            <Link
              to="/login"
              className="flex min-h-11 items-center justify-center rounded-md bg-white px-6 text-sm font-semibold text-lagoon-600 hover:bg-lagoon-50"
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
          className="mt-3 inline-block text-sm font-medium text-lagoon-600 hover:text-lagoon-500"
        >
          www.edusolutionsmv.com
        </a>
      </section>
    </div>
  );
}
