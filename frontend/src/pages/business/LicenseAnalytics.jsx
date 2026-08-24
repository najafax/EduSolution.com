import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import KpiCard from '../../components/KpiCard';
import MobileListAccordion from '../../components/MobileListAccordion';
import YearlyBarChart from '../../components/YearlyBarChart';
import BreakdownBars from '../../components/BreakdownBars';
import { LicenseIcon, TrendUpIcon, AlertTriangleIcon, CheckCircleIcon, ClockIcon } from '../../components/icons';

const NEW_COLOR = '#0e7c86';
const RENEWAL_COLOR = '#059669';
const YEARLY_SERIES = [
  { key: 'newLicenses', label: 'New licenses', color: NEW_COLOR },
  { key: 'renewals', label: 'Renewals', color: RENEWAL_COLOR },
];

export default function LicenseAnalytics() {
  const { token, can } = useAuth();
  const canView = can('licenses', 'view');
  const [data, setData] = useState(null);
  const [settings, setSettings] = useState(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!canView) return;
    api.licenses
      .analytics(token)
      .then(setData)
      .catch((err) => setError(err.message));
    // .finally flips settingsLoaded whether the fetch succeeds or fails —
    // the loading gate below waits on this too, so money figures never
    // flash '$' before the real currency symbol arrives (see Dashboard.jsx's
    // own note on this race for the full story).
    api.settings
      .get(token)
      .then(({ settings }) => setSettings(settings))
      .catch(() => {})
      .finally(() => setSettingsLoaded(true));
  }, [token, canView]);

  if (!canView) {
    return <div className="px-4 py-10 text-sm text-slate-500 dark:text-slate-400 sm:px-6 lg:px-8">You are not authorized to view this page.</div>;
  }

  const symbol = settings?.currency_symbol || '$';
  const currentYear = new Date().getFullYear();
  const thisYear = data?.byYear.find((y) => y.year === currentYear);

  if (error && !data) return <div className="px-4 py-10 text-sm text-red-600 dark:text-red-400 sm:px-6 lg:px-8">{error}</div>;
  if (!data || !settingsLoaded) return <div className="px-4 py-10 text-sm text-slate-500 dark:text-slate-400 sm:px-6 lg:px-8">Loading…</div>;

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">License analytics</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Activations, renewals, and changes by year, going back to your earliest license.
          </p>
        </div>
        <Link
          to="/licenses"
          className="min-h-11 flex items-center rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Back to licenses
        </Link>
      </div>

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard icon={<LicenseIcon />} label="Total licenses" value={data.totals.totalLicenses} tone="neutral" />
        <KpiCard icon={<TrendUpIcon />} label="New this year" value={thisYear?.newLicenses ?? 0} tone="positive" />
        <KpiCard icon={<CheckCircleIcon />} label="Renewals this year" value={thisYear?.renewals ?? 0} tone="positive" />
        <KpiCard icon={<ClockIcon />} label="Billing changes this year" value={thisYear?.billingCycleChanges ?? 0} tone="neutral" />
        <KpiCard icon={<AlertTriangleIcon />} label="Cancelled this year" value={thisYear?.cancelled ?? 0} tone="negative" />
        <KpiCard icon={<CheckCircleIcon />} label="Reactivated this year" value={thisYear?.reactivated ?? 0} tone="positive" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2 dark:border-slate-700 dark:bg-slate-900">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">New licenses &amp; renewals by year</h2>
          <div className="mt-4">
            <YearlyBarChart
              data={data.byYear}
              series={YEARLY_SERIES}
              emptyMessage="No license activity yet."
              ariaLabel="New licenses and renewals per year"
            />
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Billing cycle split</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Current licenses, by cycle.</p>
          <div className="mt-4">
            <BreakdownBars
              emptyMessage="No licenses yet."
              rows={[
                { key: 'monthly', label: 'Monthly', color: '#0e7c86', value: data.byBillingCycle.monthly || 0 },
                { key: 'yearly', label: 'Yearly', color: '#059669', value: data.byBillingCycle.yearly || 0 },
              ]}
            />
          </div>
          <dl className="mt-5 space-y-1.5 border-t border-slate-100 pt-4 text-xs dark:border-slate-800">
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Total renewals (all-time)</dt>
              <dd className="font-medium text-slate-900 dark:text-white">{data.totals.totalRenewals}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Billing cycle changes (all-time)</dt>
              <dd className="font-medium text-slate-900 dark:text-white">{data.totals.totalBillingCycleChanges}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Cancelled (all-time)</dt>
              <dd className="font-medium text-slate-900 dark:text-white">{data.totals.totalCancelled}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Reactivated (all-time)</dt>
              <dd className="font-medium text-slate-900 dark:text-white">{data.totals.totalReactivated}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Year by year</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            "Cancelled", "Reactivated", and "Billing changes" only count activity recorded since this report shipped — earlier
            edits weren't tracked at that level of detail, so those columns read 0 for older years even if changes happened.
            "Est. revenue" values every license at today's price, not what was actually charged that year.
          </p>
        </div>
        <div className="hidden overflow-x-auto sm:block">
          <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
            <thead>
              <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                <th className="px-5 py-3">Year</th>
                <th className="px-4 py-3 text-right">New</th>
                <th className="px-4 py-3 text-right">Renewals</th>
                <th className="px-4 py-3 text-right">Cancelled</th>
                <th className="px-4 py-3 text-right">Reactivated</th>
                <th className="px-4 py-3 text-right">Billing changes</th>
                <th className="px-5 py-3 text-right">Est. revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.byYear.map((y) => (
                <tr key={y.year}>
                  <td className="px-5 py-3 font-medium text-slate-900 dark:text-white">{y.year}</td>
                  <td className="px-4 py-3 text-right dark:text-white">{y.newLicenses}</td>
                  <td className="px-4 py-3 text-right dark:text-white">{y.renewals}</td>
                  <td className="px-4 py-3 text-right dark:text-white">{y.cancelled}</td>
                  <td className="px-4 py-3 text-right dark:text-white">{y.reactivated}</td>
                  <td className="px-4 py-3 text-right dark:text-white">{y.billingCycleChanges}</td>
                  <td className="px-5 py-3 text-right dark:text-white">
                    {symbol}
                    {y.revenueEstimate.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-2.5 p-4 sm:hidden">
          {data.byYear.map((y) => (
            <MobileListAccordion
              key={y.year}
              name="license-analytics-years"
              summary={
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-slate-900 dark:text-white">{y.year}</span>
                  <span className="text-slate-500 dark:text-slate-400">
                    {y.newLicenses} new · {y.renewals} renewed
                  </span>
                </div>
              }
            >
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Cancelled</dt>
                <dd className="text-slate-900 dark:text-white">{y.cancelled}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Reactivated</dt>
                <dd className="text-slate-900 dark:text-white">{y.reactivated}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Billing changes</dt>
                <dd className="text-slate-900 dark:text-white">{y.billingCycleChanges}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Est. revenue</dt>
                <dd className="text-slate-900 dark:text-white">
                  {symbol}
                  {y.revenueEstimate.toFixed(2)}
                </dd>
              </div>
            </MobileListAccordion>
          ))}
        </div>
      </div>

      {data.topClients.length > 0 && (
        <div className="mt-6 rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Top clients by license count</h2>
          </div>
          <div className="hidden overflow-x-auto sm:block">
            <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
              <thead>
                <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                  <th className="px-5 py-3">Client</th>
                  <th className="px-4 py-3 text-right">Licenses</th>
                  <th className="px-5 py-3 text-right">Current total value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.topClients.map((c) => (
                  <tr key={c.id}>
                    <td className="px-5 py-3 dark:text-white">
                      <Link to="/clients" className="text-lagoon-600 hover:text-lagoon-500">
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right dark:text-white">{c.license_count}</td>
                    <td className="px-5 py-3 text-right dark:text-white">
                      {symbol}
                      {c.total_amount.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-2.5 p-4 sm:hidden">
            {data.topClients.map((c) => (
              <MobileListAccordion
                key={c.id}
                name="license-analytics-clients"
                summary={
                  <div className="flex items-center justify-between gap-3">
                    <Link to="/clients" className="text-lagoon-600 hover:text-lagoon-500" onClick={(e) => e.stopPropagation()}>
                      {c.name}
                    </Link>
                    <span className="text-slate-500 dark:text-slate-400">{c.license_count} licenses</span>
                  </div>
                }
              >
                <div className="flex justify-between">
                  <dt className="text-slate-500 dark:text-slate-400">Current total value</dt>
                  <dd className="text-slate-900 dark:text-white">
                    {symbol}
                    {c.total_amount.toFixed(2)}
                  </dd>
                </div>
              </MobileListAccordion>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
