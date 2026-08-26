import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { usePortalAuth } from '../../context/PortalAuthContext';
import StatusBadge from '../../components/StatusBadge';
import EmptyState from '../../components/EmptyState';
import SearchInput from '../../components/SearchInput';
import { LicenseIcon } from '../../components/icons';

// Each card now links to PortalLicenseDetail.jsx (renewal history) — this
// list itself is still just enough to see what's active/expiring/expired
// at a glance, the detail page is where the rest lives.
export default function PortalLicenses() {
  const { token, settings } = usePortalAuth();
  const [licenses, setLicenses] = useState(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const symbol = settings?.currency_symbol || '$';

  useEffect(() => {
    api.portal.licenses
      .list(token)
      .then(({ licenses }) => setLicenses(licenses))
      .catch((err) => setError(err.message));
  }, [token]);

  // Client-side only — the whole list is already fetched unpaginated (a
  // single client's own license count is inherently small, see
  // routes/clientPortal.js's own note on why none of these portal lists
  // take ?q=/?page=), so a search box here just filters what's already in
  // memory rather than needing a new backend param.
  const filtered = licenses?.filter((l) => l.name.toLowerCase().includes(search.trim().toLowerCase())) ?? [];

  return (
    <div className="px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Licenses</h1>

      {licenses && licenses.length > 0 && (
        <div className="mt-4 max-w-sm">
          <SearchInput value={search} onChange={setSearch} placeholder="Search licenses…" />
        </div>
      )}

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {!licenses ? (
        <p className="mt-10 text-center text-sm text-slate-500 dark:text-slate-400">Loading…</p>
      ) : licenses.length === 0 ? (
        <div className="mt-6 rounded-lg border border-slate-200 dark:border-slate-700">
          <EmptyState icon={<LicenseIcon />} title="No licenses yet." message="Any licenses on your account will show up here." />
        </div>
      ) : filtered.length === 0 ? (
        <p className="mt-10 text-center text-sm text-slate-500 dark:text-slate-400">No licenses match "{search}".</p>
      ) : (
        <>
          <div className="mt-6 hidden overflow-x-auto rounded-lg border border-slate-200 bg-white sm:block dark:border-slate-700 dark:bg-slate-900">
            <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
              <thead>
                <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Billing cycle</th>
                  <th className="px-4 py-3">Expires</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filtered.map((license) => (
                  <tr key={license.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                    <td className="whitespace-nowrap px-4 py-3">
                      <Link to={`/portal/licenses/${license.id}`} className="font-medium text-lagoon-600 hover:text-lagoon-500">
                        {license.name}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-400">
                      {license.billing_cycle === 'monthly' ? 'Monthly' : 'Yearly'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-400">{license.expiry_date}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <StatusBadge status={license.display_status} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-slate-900 dark:text-white">
                      {symbol}
                      {license.amount.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-6 flex flex-col gap-2.5 sm:hidden">
            {filtered.map((license) => (
              <Link
                key={license.id}
                to={`/portal/licenses/${license.id}`}
                className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-lagoon-300 hover:shadow-md dark:border-slate-700 dark:bg-slate-900"
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
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
