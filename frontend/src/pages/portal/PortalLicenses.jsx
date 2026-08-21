import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { usePortalAuth } from '../../context/PortalAuthContext';
import StatusBadge from '../../components/StatusBadge';
import EmptyState from '../../components/EmptyState';
import { LicenseIcon } from '../../components/icons';

// List-only, same scope call as the backend route (routes/clientPortal.js)
// — no detail/renewal-history view yet, just enough for a client to see
// what's active/expiring/expired at a glance.
export default function PortalLicenses() {
  const { token, settings } = usePortalAuth();
  const [licenses, setLicenses] = useState(null);
  const [error, setError] = useState('');
  const symbol = settings?.currency_symbol || '$';

  useEffect(() => {
    api.portal.licenses
      .list(token)
      .then(({ licenses }) => setLicenses(licenses))
      .catch((err) => setError(err.message));
  }, [token]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Licenses</h1>

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {!licenses ? (
        <p className="mt-10 text-center text-sm text-slate-500 dark:text-slate-400">Loading…</p>
      ) : licenses.length === 0 ? (
        <div className="mt-6 rounded-lg border border-slate-200 dark:border-slate-700">
          <EmptyState icon={<LicenseIcon />} title="No licenses yet." message="Any licenses on your account will show up here." />
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-2.5">
          {licenses.map((license) => (
            <div
              key={license.id}
              className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900"
            >
              <div className="min-w-0">
                <p className="font-medium text-slate-900 dark:text-white">{license.name}</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {license.billing_cycle === 'monthly' ? 'Monthly' : 'Yearly'} · Expires {license.expiry_date}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="font-semibold text-slate-900 dark:text-white">
                  {symbol}
                  {license.amount.toFixed(2)}
                </span>
                <StatusBadge status={license.display_status} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
