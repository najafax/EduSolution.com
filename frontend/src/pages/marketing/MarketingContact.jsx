import { useEffect, useState } from 'react';
import MarketingLayout from './MarketingLayout';
import { api } from '../../lib/api';

export default function MarketingContact() {
  const [settings, setSettings] = useState(null);

  useEffect(() => {
    api.public
      .getSiteContent()
      .then((data) => setSettings(data.settings || {}))
      .catch(() => setSettings({}));
  }, []);

  const phone = settings?.phone?.trim();
  const email = settings?.email?.trim();
  const address = settings?.address?.trim();
  const hasAnyDetail = Boolean(phone || email || address);

  return (
    <MarketingLayout>
      <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 lg:px-8">
        <span className="font-display inline-flex items-center gap-2 rounded-full bg-lagoon-50 px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide text-lagoon-700 dark:bg-lagoon-950 dark:text-lagoon-400">
          Contact us
        </span>
        <h1 className="font-display mt-5 text-4xl font-extrabold text-slate-900 dark:text-white">Let's talk</h1>
        <p className="mt-4 text-lg text-slate-600 dark:text-slate-400">
          Reach out and we'll help you find the right fit — EduPage, the Business Suite, or both.
        </p>
      </div>

      <div className="mx-auto max-w-3xl px-4 pb-20 sm:px-6 lg:px-8">
        {settings === null ? (
          <div className="grid gap-4 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-32 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-900" />
            ))}
          </div>
        ) : !hasAnyDetail ? (
          <p className="text-center text-slate-500 dark:text-slate-400">Contact details coming soon.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            {phone && (
              <a
                href={`tel:${phone}`}
                className="flex flex-col items-center gap-3 rounded-2xl bg-slate-50 p-8 text-center transition-colors hover:bg-lagoon-50 dark:bg-slate-900 dark:hover:bg-lagoon-950/40"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-lagoon-600">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8">
                    <path
                      d="M4.5 4h3.2l1.6 4.4-2 1.6a12.5 12.5 0 0 0 5.7 5.7l1.6-2 4.4 1.6v3.2c0 1-.9 1.8-1.9 1.6-8-.8-13.9-6.7-14.7-14.7C2.7 4.9 3.5 4 4.5 4Z"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                <p className="font-display text-sm font-bold text-slate-900 dark:text-white">Phone</p>
                <p className="text-sm text-slate-600 dark:text-slate-400">{phone}</p>
              </a>
            )}
            {email && (
              <a
                href={`mailto:${email}`}
                className="flex flex-col items-center gap-3 rounded-2xl bg-slate-50 p-8 text-center transition-colors hover:bg-lagoon-50 dark:bg-slate-900 dark:hover:bg-lagoon-950/40"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-lagoon-600">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8">
                    <rect x="3" y="5" width="18" height="14" rx="2" />
                    <path d="M3.5 6.5 12 13l8.5-6.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <p className="font-display text-sm font-bold text-slate-900 dark:text-white">Email</p>
                <p className="break-all text-sm text-slate-600 dark:text-slate-400">{email}</p>
              </a>
            )}
            {address && (
              <div className="flex flex-col items-center gap-3 rounded-2xl bg-slate-50 p-8 text-center dark:bg-slate-900">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-lagoon-600">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8">
                    <path d="M12 21s7-6.3 7-11.5A7 7 0 0 0 5 9.5C5 14.7 12 21 12 21Z" strokeLinejoin="round" />
                    <circle cx="12" cy="9.5" r="2.5" />
                  </svg>
                </div>
                <p className="font-display text-sm font-bold text-slate-900 dark:text-white">Address</p>
                <p className="text-sm text-slate-600 dark:text-slate-400">{address}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </MarketingLayout>
  );
}
