import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useUndoableDelete } from '../../lib/useUndoableDelete';
import { useConfirm } from '../../lib/useConfirm';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { todayStr } from '../../lib/date';
import SearchInput from '../../components/SearchInput';
import FloatingActionButton from '../../components/FloatingActionButton';
import Pagination from '../../components/Pagination';
import Modal from '../../components/Modal';
import SearchableSelect from '../../components/SearchableSelect';
import StatusFilterChips from '../../components/StatusFilterChips';
import KpiCard from '../../components/KpiCard';
import { TableSkeleton } from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import MobileListAccordion from '../../components/MobileListAccordion';
import IconActionButton from '../../components/IconActionButton';
import { BankIcon, TrendDownIcon, TrendUpIcon, DownloadIcon, PlusIcon, PencilIcon, TrashIcon } from '../../components/icons';

// Money an owner/partner takes OUT of the business, with an explicit way to
// record paying some or all of it back — the mirror of CapitalContributions
// (money going IN). See db/index.js's own owner_draws CREATE TABLE comment
// for why this is a separate table with a `type` column rather than folding
// into capital_contributions or a plain "shareholder payments" expense: a
// draw carries a running balance a plain expense/contribution has no notion
// of. Same list+modal-form+FAB shape as CapitalContributions.jsx, with a
// type selector/filter and a KPI strip (Total drawn / Total returned /
// Outstanding balance) added on top, mirroring Licenses.jsx's own
// summary-strip convention.
const TYPE_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'draw', label: 'Draws' },
  { value: 'return', label: 'Returns' },
];
const EMPTY_FORM = { type: 'draw', taken_by_name: '', amount: '', draw_date: todayStr(), notes: '' };

export default function OwnerDraws() {
  const { token, can } = useAuth();
  const { toast } = useToast();
  const canManage = can('expenses', 'manage');
  const [draws, setDraws] = useState([]);
  const [names, setNames] = useState([]);
  const [summary, setSummary] = useState(null);
  const [pageInfo, setPageInfo] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [typeFilter, setTypeFilter] = useState('');
  const [takenByFilter, setTakenByFilter] = useState('');

  const { pendingIds, deleteWithUndo } = useUndoableDelete((id) => api.ownerDraws.remove(id, token));
  const visibleDraws = draws.filter((d) => !pendingIds.has(d.id));
  const { confirm, confirmDialog } = useConfirm();

  function load() {
    // Only show the loading skeleton on the very first load — see
    // CapitalContributions.jsx's own note on why (avoids the list visibly
    // jumping height on every search/filter refetch).
    if (draws.length === 0) setLoading(true);
    api.ownerDraws
      .list(token, { q: debouncedSearch, page, type: typeFilter, takenBy: takenByFilter })
      .then(({ draws, names, ...rest }) => {
        setDraws(draws);
        setNames(names);
        setPageInfo(rest.totalPages ? rest : null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  function loadSummary() {
    api.ownerDraws.summary(token).then(setSummary).catch(() => {});
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [token, debouncedSearch, page, typeFilter, takenByFilter]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadSummary, [token]);
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, typeFilter, takenByFilter]);

  function startCreate() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(true);
  }

  function startEdit(draw) {
    setForm({
      type: draw.type,
      taken_by_name: draw.taken_by_name,
      amount: draw.amount,
      draw_date: draw.draw_date,
      notes: draw.notes,
    });
    setEditingId(draw.id);
    setShowForm(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (editingId) {
        await api.ownerDraws.update(editingId, form, token);
        toast('Record updated.', { type: 'success' });
      } else {
        await api.ownerDraws.create(form, token);
        toast(form.type === 'return' ? 'Return recorded.' : 'Draw recorded.', { type: 'success' });
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

  async function handleDelete(draw) {
    const noun = draw.type === 'return' ? 'return' : 'draw';
    if (!(await confirm({ title: `Delete this ${noun} for ${draw.taken_by_name}?`, confirmLabel: 'Delete' }))) return;
    deleteWithUndo([draw.id], `${noun === 'return' ? 'Return' : 'Draw'} for "${draw.taken_by_name}" deleted.`);
    // deleteWithUndo's own DELETE request doesn't actually fire until its
    // undo window closes (see lib/useUndoableDelete.js) — the KPI strip's
    // totals only need refreshing once that real request has gone out, so
    // this mirrors that same window rather than reloading a summary the
    // delete hasn't touched yet (or reloading needlessly if "Undo" is
    // clicked, which is harmless — just an extra fetch of unchanged data).
    setTimeout(loadSummary, 5200);
  }

  async function handleExportCsv() {
    setError('');
    try {
      await api.ownerDraws.exportCsv(token);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleExportXlsx() {
    setError('');
    try {
      await api.ownerDraws.exportXlsx(token);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Owner draws</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Money an owner or partner has taken out of the business, and any of it paid back.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
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
              New record
            </button>
          )}
        </div>
      </div>

      {summary && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <KpiCard icon={<TrendDownIcon />} label="Total drawn" value={summary.totalDraws.toFixed(2)} tone="warning" />
          <KpiCard icon={<TrendUpIcon />} label="Total returned" value={summary.totalReturns.toFixed(2)} tone="positive" />
          <KpiCard
            icon={<BankIcon />}
            label="Outstanding balance"
            value={summary.outstandingBalance.toFixed(2)}
            tone={summary.outstandingBalance > 0 ? 'negative' : 'neutral'}
            className="col-span-2 sm:col-span-1"
          />
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 sm:max-w-sm">
          <SearchInput value={search} onChange={setSearch} placeholder="Search draws and returns…" />
        </div>
        {names.length > 0 && (
          <div className="w-full max-w-xs sm:w-56">
            <SearchableSelect
              options={[{ value: '', label: 'Everyone' }, ...names.map((n) => ({ value: n, label: n }))]}
              value={takenByFilter}
              onChange={setTakenByFilter}
              placeholder="Filter by name…"
            />
          </div>
        )}
      </div>
      <div className="mt-3">
        <StatusFilterChips options={TYPE_OPTIONS} value={typeFilter} onChange={setTypeFilter} />
      </div>

      {error && !showForm && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <Modal open={showForm} onClose={() => setShowForm(false)} title={editingId ? 'Edit record' : 'New record'} maxWidthClass="max-w-lg">
        <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
          {error && <p className="text-sm text-red-600 dark:text-red-400 sm:col-span-2">{error}</p>}
          <div className="sm:col-span-2">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Type</span>
            <div className="mt-1 flex gap-2">
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, type: 'draw' }))}
                className={`min-h-11 flex-1 rounded-md border px-4 text-sm font-medium ${
                  form.type === 'draw'
                    ? 'border-amber-600 bg-amber-50 text-amber-700 dark:border-amber-500 dark:bg-amber-950 dark:text-amber-300'
                    : 'border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                Draw (money taken out)
              </button>
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, type: 'return' }))}
                className={`min-h-11 flex-1 rounded-md border px-4 text-sm font-medium ${
                  form.type === 'return'
                    ? 'border-emerald-600 bg-emerald-50 text-emerald-700 dark:border-emerald-500 dark:bg-emerald-950 dark:text-emerald-300'
                    : 'border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                Return (paid back)
              </button>
            </div>
          </div>
          <div className="sm:col-span-2">
            <label className="block">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Taken by</span>
              <input
                type="text"
                required
                value={form.taken_by_name}
                onChange={(e) => setForm((f) => ({ ...f, taken_by_name: e.target.value }))}
                placeholder="Which owner or partner"
                className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              />
            </label>
          </div>
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Amount</span>
            <input
              type="number"
              min="0.01"
              step="0.01"
              required
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Date</span>
            <div className="mt-1 flex h-11 w-full items-center overflow-hidden rounded-md border border-slate-300 px-3 focus-within:border-lagoon-500 dark:border-slate-600">
              <input
                type="date"
                required
                value={form.draw_date}
                onChange={(e) => setForm((f) => ({ ...f, draw_date: e.target.value }))}
                className="h-full w-full appearance-none border-0 bg-transparent p-0 text-base focus:outline-none dark:text-white"
              />
            </div>
          </label>
          <div className="sm:col-span-2">
            <label className="block">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Notes</span>
              <input
                type="text"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Optional context"
                className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              />
            </label>
          </div>
          <div className="flex gap-3 sm:col-span-2">
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

      <div className="mt-6 rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        {loading ? (
          <div className="overflow-x-auto">
            <TableSkeleton rows={5} cols={canManage ? ['w-24', 'w-20', 'w-32', 'w-40', 'w-20', 'w-16'] : ['w-24', 'w-20', 'w-32', 'w-40', 'w-20']} />
          </div>
        ) : visibleDraws.length === 0 ? (
          <EmptyState
            icon={<BankIcon />}
            title={search || typeFilter || takenByFilter ? 'No records match these filters.' : 'No owner draws recorded yet.'}
            message={!search && !typeFilter && !takenByFilter && canManage ? 'Record money an owner or partner has taken out of the business.' : undefined}
            action={!search && !typeFilter && !takenByFilter && canManage ? { label: 'New record', onClick: startCreate } : undefined}
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto sm:block">
              <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Taken by</th>
                    <th className="px-4 py-3">Notes</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    {canManage && <th className="px-4 py-3" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {visibleDraws.map((d) => (
                    <tr key={d.id}>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-400">{d.draw_date}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                            d.type === 'return'
                              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                              : 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                          }`}
                        >
                          {d.type}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900 dark:text-white">{d.taken_by_name}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{d.notes || '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-slate-900 dark:text-white">{d.amount.toFixed(2)}</td>
                      {canManage && (
                        <td className="whitespace-nowrap px-4 py-3">
                          <div className="flex justify-end gap-1.5">
                            <IconActionButton icon={PencilIcon} tone="slate" onClick={() => startEdit(d)} title="Edit" label="Edit record" />
                            <IconActionButton icon={TrashIcon} tone="red" onClick={() => handleDelete(d)} title="Delete" label="Delete record" />
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="sm:hidden">
              <div className="flex flex-col gap-2.5">
                {visibleDraws.map((d) => (
                  <MobileListAccordion
                    key={d.id}
                    name="owner-draws-list"
                    accent={d.type === 'return' ? 'bg-emerald-500' : 'bg-amber-500'}
                    summary={
                      <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-slate-900 dark:text-white">{d.taken_by_name}</p>
                          <p className="text-slate-500 dark:text-slate-400 capitalize">
                            {d.type} · {d.draw_date}
                          </p>
                        </div>
                        <p className="shrink-0 text-slate-900 dark:text-white">{d.amount.toFixed(2)}</p>
                      </div>
                    }
                  >
                    {d.notes && (
                      <div className="flex justify-between">
                        <dt className="text-slate-500 dark:text-slate-400">Notes</dt>
                        <dd className="text-slate-900 dark:text-white">{d.notes}</dd>
                      </div>
                    )}
                    {canManage && (
                      <div className="flex gap-1.5 pt-1">
                        <IconActionButton icon={PencilIcon} tone="slate" onClick={() => startEdit(d)} title="Edit" label="Edit record" />
                        <IconActionButton icon={TrashIcon} tone="red" onClick={() => handleDelete(d)} title="Delete" label="Delete record" />
                      </div>
                    )}
                  </MobileListAccordion>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {pageInfo && <Pagination page={pageInfo.page} totalPages={pageInfo.totalPages} onChange={setPage} />}

      {canManage && !showForm && <FloatingActionButton onClick={startCreate} label="New record" />}

      {confirmDialog}
    </div>
  );
}
