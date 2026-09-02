import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import MarketingLayout from './MarketingLayout';
import { GraduationCapIcon, ProductIcon, CheckCircleIcon, ReportIcon, LicenseIcon, BankIcon } from '../../components/icons';

// Must stay in sync with pages/business/Website.jsx's own
// SERVICE_ICON_OPTIONS keys.
const SERVICE_ICONS = {
  service: ProductIcon,
  school: GraduationCapIcon,
  business: BankIcon,
  support: CheckCircleIcon,
  reports: ReportIcon,
  license: LicenseIcon,
};

const FEAT_ICON = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" className="mt-0.5 shrink-0 text-lagoon-600 dark:text-lagoon-400">
    <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export default function MarketingServices() {
  const [services, setServices] = useState([]);

  useEffect(() => {
    api.public
      .getSiteContent()
      .then((data) => setServices(data.services || []))
      .catch(() => {});
  }, []);

  return (
    <MarketingLayout>
      <div className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-6 lg:px-8">
        <span className="font-display inline-flex items-center gap-2 rounded-full bg-lagoon-50 px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide text-lagoon-700 dark:bg-lagoon-950 dark:text-lagoon-400">
          What we offer
        </span>
        <h1 className="font-display mt-5 text-4xl font-extrabold text-slate-900 dark:text-white">Everything we offer, in one place</h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-slate-600 dark:text-slate-400">
          Two platforms, one local partner — EduPage for schools, and our own Business Suite for quotes, invoicing and
          payments.
        </p>
      </div>

      <div className="mx-auto max-w-5xl px-4 pb-6 sm:px-6 lg:px-8">
        <div className="rounded-3xl bg-slate-50 p-9 dark:bg-slate-900">
          <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-start">
            <div className="max-w-md">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-lagoon-600">
                <GraduationCapIcon width={24} height={24} className="text-white" />
              </div>
              <h2 className="font-display mt-4 text-2xl font-bold text-slate-900 dark:text-white">EduPage for Schools</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                The school management platform your teachers and administrators already trust — delivered, licensed and
                supported locally by Edu Solutions as an authorized distributor.
              </p>
            </div>
          </div>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {[
              ['Timetabling & attendance', 'Class schedules and daily attendance in one system.'],
              ['Digital class registers', 'No more paper registers to lose or reconcile.'],
              ['Homework & e-learning', 'Assignments and lessons students can reach from home.'],
              ['Local rollout & training', 'We set your school up and train staff in person.'],
            ].map(([title, desc]) => (
              <div key={title} className="flex gap-2.5">
                {FEAT_ICON}
                <div>
                  <p className="font-display text-sm font-bold text-slate-900 dark:text-white">{title}</p>
                  <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 pb-6 sm:px-6 lg:px-8">
        <div className="rounded-3xl bg-lagoon-950 p-9">
          <div className="max-w-md">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-lagoon-400">
              <ProductIcon width={24} height={24} className="text-lagoon-950" />
            </div>
            <h2 className="font-display mt-4 text-2xl font-bold text-white">Edu Solutions Business Suite</h2>
            <p className="mt-2 text-sm leading-relaxed text-lagoon-100">
              The same billing and client-management platform we run Edu Solutions on ourselves — built for how small
              businesses in the Maldives actually get paid.
            </p>
          </div>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {[
              ['Clients & quotes', 'Every client and quote, searchable in one place.'],
              ['Invoicing & payments', 'Professional invoices, payments recorded as they land.'],
              ['Recurring billing', 'Set a schedule once — repeat invoices generate themselves.'],
              ['Financial reports', 'Revenue, expenses and outstanding balance at a glance.'],
              ['License tracking', 'Renewals and expiries flagged before they lapse.'],
              ['Role-based access', 'Give staff exactly the access they need, nothing more.'],
            ].map(([title, desc]) => (
              <div key={title} className="flex gap-2.5">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" className="mt-0.5 shrink-0 text-lagoon-300">
                  <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <div>
                  <p className="font-display text-sm font-bold text-white">{title}</p>
                  <p className="mt-0.5 text-sm text-lagoon-200">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Additional services from the CMS — only rendered once staff have
          actually added at least one, so an empty catalog never shows a
          pointless section header with nothing under it. */}
      {services.length > 0 && (
        <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
          <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">More ways we can help</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {services.map((s) => {
              const Icon = SERVICE_ICONS[s.icon] || ProductIcon;
              return (
                <div key={s.id} className="rounded-2xl border border-slate-200 p-6 dark:border-slate-800">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-lagoon-50 dark:bg-lagoon-950">
                    <Icon width={20} height={20} className="text-lagoon-600 dark:text-lagoon-400" />
                  </div>
                  <h3 className="font-display mt-3 text-base font-bold text-slate-900 dark:text-white">{s.title}</h3>
                  {s.description && <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">{s.description}</p>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="bg-lagoon-950 px-4 py-16 text-center sm:px-6 lg:px-8">
        <h2 className="font-display mx-auto max-w-lg text-3xl font-bold text-white">Not sure which platform fits?</h2>
        <p className="mx-auto mt-3 max-w-md text-slate-300">Tell us a little about your school or business and we'll point you to the right one.</p>
        <a href="/#contact" className="mt-6 inline-block min-h-11 rounded-lg bg-white px-6 py-3 text-sm font-bold text-lagoon-900 hover:bg-lagoon-50">
          Book a walkthrough
        </a>
      </div>
    </MarketingLayout>
  );
}
