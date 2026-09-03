import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { todayStr, todayPlus, timeAgo } from '../../lib/date';
import StatusBadge from '../../components/StatusBadge';
import SearchInput from '../../components/SearchInput';
import StatusFilterChips from '../../components/StatusFilterChips';
import FloatingActionButton from '../../components/FloatingActionButton';
import Pagination from '../../components/Pagination';
import Modal from '../../components/Modal';
import EmailPreviewModal from '../../components/EmailPreviewModal';
import HtmlEmailPreviewModal from '../../components/HtmlEmailPreviewModal';
import SearchableSelect from '../../components/SearchableSelect';
import MobileListAccordion from '../../components/MobileListAccordion';
import { TableSkeleton } from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import KpiCard from '../../components/KpiCard';
import IconActionButton from '../../components/IconActionButton';
import {
  LicenseIcon,
  CheckCircleIcon,
  ClockIcon,
  AlertTriangleIcon,
  RefreshIcon,
  XIcon,
  BellIcon,
  HistoryIcon,
  PencilIcon,
  TrashIcon,
  DownloadIcon,
  PlusIcon,
  ReportIcon,
  LinkIcon,
  SendIcon,
} from '../../components/icons';
import { useConfirm } from '../../lib/useConfirm';
import { useDebouncedValue } from '../../lib/useDebouncedValue';

const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'expiring_soon', label: 'Expiring soon' },
  { value: 'expired', label: 'Expired' },
  { value: 'cancelled', label: 'Cancelled' },
];

// Left accent stripe on each mobile card — same status meaning as
// StatusBadge's colors, just as a stripe instead of a pill.
const ACCENT = {
  active: 'bg-emerald-500',
  expiring_soon: 'bg-amber-500',
  expired: 'bg-red-500',
  cancelled: 'bg-slate-300 dark:bg-slate-600',
};

const EMPTY_FORM = {
  client_id: '',
  name: '',
  billing_cycle: 'yearly',
  amount: '',
  start_date: todayStr(),
  expiry_date: todayPlus(365),
  url: '',
  notes: '',
  status: 'active',
};

export default function Licenses() {
  const { token, can } = useAuth();
  const canManage = can('licenses', 'manage');
  const [licenses, setLicenses] = useState([]);
  const [pageInfo, setPageInfo] = useState(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [status, setStatus] = useState('');
  const [summary, setSummary] = useState(null);
  const [clients, setClients] = useState([]);
  const [settings, setSettings] = useState(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [busy, setBusy] = useState(null); // { id, action } — tracks which row/action is in flight so buttons show the right busy label
  const [remindTarget, setRemindTarget] = useState(null);
  const [renewalConfirmTarget, setRenewalConfirmTarget] = useState(null);
  const [historyTarget, setHistoryTarget] = useState(null);
  const [renewals, setRenewals] = useState(null);
  const [renewalsError, setRenewalsError] = useState('');
  const { confirm, confirmDialog } = useConfirm();

  function load() {
    // Only show the loading skeleton on the very first load — once there's
    // a list on screen, a refetch (search/filter/page change) keeps the
    // current rows visible until the new ones arrive instead of flashing
    // to a fixed-row-count skeleton whose height matches neither the old
    // nor new result count, which read as the page visibly jumping.
    if (licenses.length === 0) setLoading(true);
    api.licenses
      .list(token, { q: debouncedSearch, status, page })
      .then(({ licenses, ...rest }) => {
        setLicenses(licenses);
        setPageInfo(rest.totalPages ? rest : null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }
  function loadSummary() {
    api.licenses.summary(token).then(setSummary).catch(() => {});
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [token, debouncedSearch, status, page]);
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, status]);
  useEffect(() => {
    loadSummary();
    api.clients.list(token).then(({ clients }) => setClients(clients));
    // .finally flips settingsLoaded whether the fetch succeeds or fails —
    // the loading gate below waits on this too (on the initial load only,
    // same as the list itself — see load()'s own note), so the Amount
    // column never flashes '$' before the real currency symbol arrives
    // (see Dashboard.jsx's own note on this race for the full story).
    api.settings
      .get(token)
      .then(({ settings }) => setSettings(settings))
      .catch(() => {})
      .finally(() => setSettingsLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function startCreate() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(true);
  }

  async function startEdit(row) {
    setError('');
    try {
      const { license } = await api.licenses.get(row.id, token);
      setForm({
        client_id: String(license.client_id),
        name: license.name,
        billing_cycle: license.billing_cycle,
        amount: license.amount,
        start_date: license.start_date,
        expiry_date: license.expiry_date,
        url: license.url,
        notes: license.notes,
        status: license.status,
      });
      setEditingId(license.id);
      setShowForm(true);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!form.client_id) {
      setError('Please select a client');
      return;
    }
    setSubmitting(true);
    const payload = {
      client_id: Number(form.client_id),
      name: form.name,
      billing_cycle: form.billing_cycle,
      amount: Number(form.amount) || 0,
      start_date: form.start_date,
      expiry_date: form.expiry_date,
      url: form.url,
      notes: form.notes,
      status: form.status,
    };
    try {
      if (editingId) {
        await api.licenses.update(editingId, payload, token);
      } else {
        await api.licenses.create(payload, token);
      }
      setShowForm(false);
      load();
      loadSummary();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id) {
    if (!(await confirm({ title: 'Delete this license?', message: 'This cannot be undone.', confirmLabel: 'Delete' }))) return;
    setError('');
    try {
      await api.licenses.remove(id, token);
      load();
      loadSummary();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleRenew(l) {
    if (
      !(await confirm({
        title: 'Renew this license?',
        message: `${l.name} (${l.client_name}) will be extended by one billing cycle.`,
        confirmLabel: 'Renew',
        danger: false,
      }))
    )
      return;
    setError('');
    setBusy({ id: l.id, action: 'renew' });
    try {
      await api.licenses.renew(l.id, token);
      load();
      loadSummary();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  // Cancel/Reactivate go through the same generic PUT /:id the Edit form
  // uses (there's no dedicated cancel route, unlike invoices' POST /:id/void)
  // — `l` already carries every field PUT requires straight from the list
  // response, so no extra GET /:id round-trip is needed first. Previously
  // the only way to cancel a license was to open Edit and change the Status
  // dropdown buried at the end of the form; these are the same one-click,
  // confirm-then-act actions every other license/invoice lifecycle change
  // in the app already gets (Renew, Void, Delete).
  async function updateLicenseStatus(l, status, action) {
    setError('');
    setBusy({ id: l.id, action });
    try {
      await api.licenses.update(
        l.id,
        {
          client_id: l.client_id,
          name: l.name,
          billing_cycle: l.billing_cycle,
          amount: l.amount,
          start_date: l.start_date,
          expiry_date: l.expiry_date,
          url: l.url,
          notes: l.notes,
          status,
        },
        token,
      );
      load();
      loadSummary();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function handleCancel(l) {
    if (
      !(await confirm({
        title: 'Cancel this license?',
        message: `${l.name} (${l.client_name}) will no longer show as active and won't get expiry reminders. You can reactivate it later.`,
        confirmLabel: 'Cancel license',
      }))
    )
      return;
    updateLicenseStatus(l, 'cancelled', 'cancel');
  }

  async function handleReactivate(l) {
    if (
      !(await confirm({
        title: 'Reactivate this license?',
        message: `${l.name} (${l.client_name}) will show as active again.`,
        confirmLabel: 'Reactivate',
        danger: false,
      }))
    )
      return;
    updateLicenseStatus(l, 'active', 'reactivate');
  }

  async function handleExportCsv() {
    setError('');
    try {
      await api.licenses.exportCsv(token);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleExportXlsx() {
    setError('');
    try {
      await api.licenses.exportXlsx(token);
    } catch (err) {
      setError(err.message);
    }
  }

  function openHistory(l) {
    setHistoryTarget(l);
    setRenewals(null);
    setRenewalsError('');
    api.licenses
      .renewals(l.id, token)
      .then(({ renewals }) => setRenewals(renewals))
      .catch((err) => setRenewalsError(err.message));
  }

  const symbol = settings?.currency_symbol || '$';

  function rowActions(l) {
    const rowBusy = busy?.id === l.id;
    const isBusy = (action) => rowBusy && busy.action === action;
    // Cancel and Send renewal reminder both disappear the moment a license
    // has ever been renewed (last_renewed_at set — by a manual Renew click
    // or the auto-renew-on-invoice-payment flow, either way), not just
    // while it's active — a license someone's already paid to renew isn't
    // meant to be casually cancelled or nagged about again.
    return (
      <>
        {l.status === 'active' && l.display_status !== 'active' && (
          <IconActionButton
            icon={RefreshIcon}
            tone="lagoon"
            onClick={() => handleRenew(l)}
            disabled={rowBusy}
            spinning={isBusy('renew')}
            title={isBusy('renew') ? 'Renewing…' : 'Renew'}
            label="Renew license"
          />
        )}
        {l.status === 'active' && !l.last_renewed_at && (
          <IconActionButton
            icon={XIcon}
            tone="orange"
            onClick={() => handleCancel(l)}
            disabled={rowBusy}
            title={isBusy('cancel') ? 'Cancelling…' : 'Cancel license'}
            label="Cancel license"
          />
        )}
        {l.status === 'cancelled' && (
          <IconActionButton
            icon={CheckCircleIcon}
            tone="emerald"
            onClick={() => handleReactivate(l)}
            disabled={rowBusy}
            title={isBusy('reactivate') ? 'Reactivating…' : 'Reactivate'}
            label="Reactivate license"
          />
        )}
        {l.status !== 'cancelled' && !l.last_renewed_at && (
          <IconActionButton
            icon={BellIcon}
            tone="amber"
            onClick={() => setRemindTarget(l)}
            title="Send renewal reminder"
          />
        )}
        {l.status !== 'cancelled' && !l.last_renewal_confirmation_sent_at && (
          <IconActionButton
            icon={SendIcon}
            tone="emerald"
            onClick={() => setRenewalConfirmTarget(l)}
            title="Send renewal confirmation"
          />
        )}
        <IconActionButton icon={HistoryIcon} tone="slate" onClick={() => openHistory(l)} title="Renewal history" label="View renewal history" />
        <IconActionButton icon={PencilIcon} tone="slate" onClick={() => startEdit(l)} title="Edit" label="Edit license" />
        <IconActionButton icon={TrashIcon} tone="red" onClick={() => handleDelete(l.id)} title="Delete" label="Delete license" />
      </>
    );
  }

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-slate-900 dark:text-white">Licenses</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Track active client licenses, renew them once paid, and stay ahead of expiries.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/licenses/analytics"
            className="flex min-h-11 items-center gap-1.5 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <ReportIcon width={16} height={16} />
            Analytics
          </Link>
          <button
            onClick={handleExportCsv}
            className="flex min-h-11 items-center gap-1.5 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <DownloadIcon width={16} height={16} />
            Export CSV
          </button>
          <button
            onClick={handleExportXlsx}
            className="hidden min-h-11 items-center gap-1.5 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800 sm:flex"
          >
            <DownloadIcon width={16} height={16} />
            Export Excel
          </button>
          {canManage && (
            <button
              onClick={startCreate}
              className="flex min-h-11 items-center gap-1.5 rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500"
            >
              <PlusIcon width={16} height={16} />
              New license
            </button>
          )}
        </div>
      </div>

      {summary && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiCard icon={<CheckCircleIcon />} label="Active" value={summary.active} tone="positive" />
          <KpiCard icon={<ClockIcon />} label="Expiring soon" value={summary.expiring_soon} tone="warning" />
          <KpiCard icon={<AlertTriangleIcon />} label="Expired" value={summary.expired} tone="negative" />
          <KpiCard icon={<LicenseIcon />} label="Cancelled" value={summary.cancelled} tone="neutral" />
        </div>
      )}

      <div className="mt-6 sm:max-w-sm">
        <SearchInput value={search} onChange={setSearch} placeholder="Search licenses…" />
      </div>
      <div className="mt-3">
        <StatusFilterChips options={STATUS_OPTIONS} value={status} onChange={setStatus} />
      </div>

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-6 rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        {loading || !settingsLoaded ? (
          <div className="overflow-x-auto">
            <TableSkeleton rows={5} cols={['w-32', 'w-28', 'w-16', 'w-24', 'w-20', 'w-24', 'w-20', 'w-32']} />
          </div>
        ) : licenses.length === 0 ? (
          <EmptyState
            icon={<LicenseIcon />}
            title={search || status ? 'No licenses match these filters.' : 'No licenses yet.'}
            message={!search && !status && canManage ? 'Add a license to start tracking its renewal.' : undefined}
            action={!search && !status && canManage ? { label: 'New license', onClick: startCreate } : undefined}
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto sm:block">
              <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                    <th className="px-4 py-3">License</th>
                    <th className="px-4 py-3">Client</th>
                    <th className="px-4 py-3">URL</th>
                    <th className="px-4 py-3">Expiry</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Last payment</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    {canManage && <th className="px-4 py-3" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {licenses.map((l) => (
                    <tr key={l.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                      <td className="whitespace-nowrap px-4 py-3">
                        <p className="font-medium text-slate-900 dark:text-white">{l.name}</p>
                        {l.last_renewal_confirmation_sent_at && (
                          <p className="mt-0.5 text-xs text-emerald-600 dark:text-emerald-400">
                            Renewal confirmation sent {timeAgo(l.last_renewal_confirmation_sent_at)}
                          </p>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-400">{l.client_name}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {l.url ? (
                          <a
                            href={l.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-lagoon-600 hover:text-lagoon-500 dark:text-lagoon-400"
                          >
                            <LinkIcon width={14} height={14} />
                            Open
                          </a>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-600">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-400">{l.expiry_date}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <StatusBadge status={l.display_status} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-400">
                        {l.last_renewed_at ? (
                          l.last_renewed_at.slice(0, 10)
                        ) : (
                          <span className="text-slate-400 dark:text-slate-600">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-slate-900 dark:text-white">
                        {symbol}
                        {l.amount.toFixed(2)}
                      </td>
                      {canManage && (
                        <td className="whitespace-nowrap px-4 py-3">
                          <div className="flex justify-end gap-1.5">{rowActions(l)}</div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-2.5 sm:hidden">
              {licenses.map((l) => (
                <MobileListAccordion
                  key={l.id}
                  name="licenses-list"
                  accent={ACCENT[l.display_status]}
                  summary={
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-slate-900 dark:text-white">{l.name}</p>
                        <p className="truncate text-slate-500 dark:text-slate-400">{l.client_name}</p>
                        {l.last_renewal_confirmation_sent_at && (
                          <p className="truncate text-xs text-emerald-600 dark:text-emerald-400">
                            Renewal confirmation sent {timeAgo(l.last_renewal_confirmation_sent_at)}
                          </p>
                        )}
                      </div>
                      <StatusBadge status={l.display_status} />
                    </div>
                  }
                >
                  <div className="flex justify-between">
                    <dt className="text-slate-500 dark:text-slate-400">Expiry</dt>
                    <dd className="text-slate-900 dark:text-white">{l.expiry_date}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500 dark:text-slate-400">Last payment</dt>
                    <dd className="text-slate-900 dark:text-white">{l.last_renewed_at ? l.last_renewed_at.slice(0, 10) : '—'}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500 dark:text-slate-400">Amount</dt>
                    <dd className="text-slate-900 dark:text-white">
                      {symbol}
                      {l.amount.toFixed(2)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500 dark:text-slate-400">Billing</dt>
                    <dd className="capitalize text-slate-900 dark:text-white">{l.billing_cycle}</dd>
                  </div>
                  {l.url && (
                    <div className="flex justify-between">
                      <dt className="text-slate-500 dark:text-slate-400">URL</dt>
                      <dd>
                        <a
                          href={l.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-lagoon-600 hover:text-lagoon-500 dark:text-lagoon-400"
                        >
                          <LinkIcon width={14} height={14} />
                          Open
                        </a>
                      </dd>
                    </div>
                  )}
                  {canManage && <div className="flex flex-wrap gap-1.5 pt-1">{rowActions(l)}</div>}
                </MobileListAccordion>
              ))}
            </div>
          </>
        )}
      </div>

      {pageInfo && <Pagination page={pageInfo.page} totalPages={pageInfo.totalPages} onChange={setPage} />}

      <Modal open={showForm} onClose={() => setShowForm(false)} title={editingId ? 'Edit license' : 'New license'} maxWidthClass="max-w-2xl">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="grid grid-cols-2 gap-3">
            <label className="block col-span-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Client</span>
              <SearchableSelect
                options={clients.map((c) => ({ value: c.id, label: c.name }))}
                value={form.client_id}
                onChange={(value) => setForm((f) => ({ ...f, client_id: value }))}
                placeholder="Search clients…"
              />
            </label>

            <label className="block col-span-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">License name</span>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. LMS Pro Annual License"
                className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              />
            </label>

            <label className="block col-span-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Activation URL</span>
              <input
                type="url"
                value={form.url}
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                placeholder="https://…"
                className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Billing cycle</span>
              <select
                value={form.billing_cycle}
                onChange={(e) => setForm((f) => ({ ...f, billing_cycle: e.target.value }))}
                className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              >
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Renewal amount</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Start date</span>
              <div className="mt-1 flex h-11 w-full items-center overflow-hidden rounded-md border border-slate-300 px-3 focus-within:border-lagoon-500 dark:border-slate-600">
                <input
                  type="date"
                  required
                  value={form.start_date}
                  onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
                  className="h-full w-full appearance-none border-0 bg-transparent p-0 text-base focus:outline-none dark:text-white"
                />
              </div>
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Expiry date</span>
              <div className="mt-1 flex h-11 w-full items-center overflow-hidden rounded-md border border-slate-300 px-3 focus-within:border-lagoon-500 dark:border-slate-600">
                <input
                  type="date"
                  required
                  value={form.expiry_date}
                  onChange={(e) => setForm((f) => ({ ...f, expiry_date: e.target.value }))}
                  className="h-full w-full appearance-none border-0 bg-transparent p-0 text-base focus:outline-none dark:text-white"
                />
              </div>
            </label>

            {editingId && (
              <label className="block">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Status</span>
                <select
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                  className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                >
                  <option value="active">Active</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </label>
            )}
          </div>

          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Notes</span>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={2}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            />
          </label>

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="min-h-11 rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500 disabled:opacity-60"
            >
              {submitting ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      {remindTarget && (
        <EmailPreviewModal
          open
          onClose={() => setRemindTarget(null)}
          title="Send renewal reminder"
          showAttachmentNote={false}
          loadPreview={() => api.licenses.remindPreview(remindTarget.id, token)}
          onSend={(payload) =>
            api.licenses.remind(remindTarget.id, payload, token).then(() => {
              load();
              loadSummary();
            })
          }
        />
      )}

      {renewalConfirmTarget && (
        <HtmlEmailPreviewModal
          open
          onClose={() => setRenewalConfirmTarget(null)}
          title="Send renewal confirmation"
          loadPreview={() => api.licenses.renewalConfirmPreview(renewalConfirmTarget.id, token)}
          onSend={() =>
            api.licenses.sendRenewalConfirm(renewalConfirmTarget.id, token).then(() => {
              load();
            })
          }
        />
      )}

      <Modal open={!!historyTarget} onClose={() => setHistoryTarget(null)} title={historyTarget ? `Renewal history — ${historyTarget.name}` : ''}>
        {renewalsError ? (
          <p className="text-sm text-red-600 dark:text-red-400">{renewalsError}</p>
        ) : renewals === null ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
        ) : renewals.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No renewals recorded yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {renewals.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                <span className="text-slate-500 dark:text-slate-400">{r.renewed_at.slice(0, 10)}</span>
                <span className="text-slate-900 dark:text-white">
                  {r.previous_expiry_date} → {r.new_expiry_date}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      {canManage && !showForm && <FloatingActionButton onClick={startCreate} label="New license" />}

      {confirmDialog}
    </div>
  );
}
