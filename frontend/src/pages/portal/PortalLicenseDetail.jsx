import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { usePortalAuth } from '../../context/PortalAuthContext';
import StatusBadge from '../../components/StatusBadge';
import { ChevronRightIcon } from '../../components/icons';

// The portal's own per-license page — the counterpart to
// routes/licenses.js's staff-side GET /:id/renewals, surfaced as a full
// page here rather than a modal opened from a list the way Licenses.jsx's
// own "History" action works, since PortalLicenses.jsx's cards had nowhere
// else to route a click before this existed.
export default function PortalLicenseDetail() {
  const { id } = useParams();
  const { token } = usePortalAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.portal.licenses
      .get(id, token)
      .then(setData)
      .catch((err) => setError(err.message));
  }, [id, token]);

  if (error && !data) {
    return <div className="px-4 py-16 text-center text-sm text-red-600 dark:text-red-400 sm:px-6">{error}</div>;
  }
  if (!data) {
    return <div className="px-4 py-16 text-center text-sm text-slate-500 dark:text-slate-400 sm:px-6">Loading…</div>;
  }

  const { license, renewals } = data;

  return (
    <div className="px-4 py-10 sm:px-6">
      <Link to="/portal/licenses" className="inline-flex items-center text-sm font-medium text-lagoon-600 hover:text-lagoon-500">
        <ChevronRightIcon width={16} height={16} className="rotate-180" />
        Back to licenses
      </Link>

      <div className="mt-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm sm:p-8 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{license.name}</h1>
          <StatusBadge status={license.display_status} />
        </div>

        <div className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <p className="font-medium text-slate-500 dark:text-slate-400">Billing cycle</p>
            <p className="text-slate-900 dark:text-white">{license.billing_cycle === 'monthly' ? 'Monthly' : 'Yearly'}</p>
          </div>
          <div>
            <p className="font-medium text-slate-500 dark:text-slate-400">Started</p>
            <p className="text-slate-900 dark:text-white">{license.start_date}</p>
            <p className="mt-2 font-medium text-slate-500 dark:text-slate-400">Expires</p>
            <p className="text-slate-900 dark:text-white">{license.expiry_date}</p>
          </div>
        </div>

        {license.notes && (
          <div className="mt-6 border-t border-slate-200 pt-4 text-sm dark:border-slate-700">
            <p className="font-medium text-slate-500 dark:text-slate-400">Notes</p>
            <p className="mt-1 whitespace-pre-line text-slate-600 dark:text-slate-400">{license.notes}</p>
          </div>
        )}

        <div className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-700">
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Renewal history</p>
          {renewals.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">No renewals recorded yet.</p>
          ) : (
            <div className="mt-2 flex flex-col gap-2">
              {renewals.map((r) => (
                <div key={r.id} className="rounded-lg border border-slate-100 px-3 py-2 text-sm dark:border-slate-800">
                  <p className="font-medium text-slate-900 dark:text-white">{r.renewed_at.slice(0, 10)}</p>
                  <p className="text-slate-500 dark:text-slate-400">
                    {r.previous_expiry_date} → {r.new_expiry_date}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && <p className="mt-6 text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </div>
  );
}
