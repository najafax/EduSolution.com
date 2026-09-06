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
import { BankIcon, TrendDownIcon, TrendUpIcon, DownloadIcon, PlusIcon, PencilIcon, TrashIcon, RefreshIcon, HistoryIcon } from '../../components/icons';

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
//
// **Per-draw balance + partial returns**: each individual draw row also
// carries its own computed `balance` (amount minus every return linked to
// it via `parent_draw_id` — see db/index.js and routes/ownerDraws.js) —
// distinct from the KPI strip's own table-wide outstandingBalance. A
// `type: 'draw'` row with `balance > 0` gets a "Record return" row action
// (openReturn/RefreshIcon) that opens `returnTarget`'s modal: the draw's
// own amount/already-returned/remaining-balance summary, its full return
// history (fetched via `GET /:id/returns`, same shape as Licenses.jsx's own
// renewal-history modal), and a form to record a partial or full payment
// back — `POST /:id/returns` (`api.ownerDraws.recordReturn`), which always
// attributes the new return to the same person who took the draw and
// validates the amount against that specific draw's own remaining balance
// server-side (the same validation the modal's own client-side check
// mirrors, so a bad amount surfaces immediately rather than only after a
// round trip). The modal stays open after a successful partial payment
// (`returnDetail` refreshed from the response) so recording several
// installments against the same draw doesn't mean reopening it each time.
// The original draw row itself is never modified or deleted once fully
// repaid — only its computed `returned_amount`/`balance` change — so once
// `balance` reaches 0 `rowActions()` swaps the same `openReturn(d)` action
// to a "View history" button (`HistoryIcon`, tone `slate`, in place of the
// emerald "Record return" one) rather than dropping it entirely: the same
// modal opens either way, its own `balance > 0.004` check inside already
// replaces the payment form with "This draw has been fully repaid." once
// there's nothing left to record, so a fully-repaid draw's return history
// stays reachable from the list rather than becoming invisible the moment
// the last payment closes it out.
//
// **Outstanding by owner**: the KPI strip's own `outstandingBalance` is a
// single table-wide figure — useful with one owner/partner, ambiguous the
// moment there's more than one, since it can't say *who* still owes what.
// `GET /summary`'s `byName` (`routes/ownerDraws.js`'s own `byNameBreakdown()`)
// answers that directly: one row per distinct `taken_by_name` with that
// person's own totalDraws/totalReturns/outstanding, sorted highest-
// outstanding-first. Rendered as its own small card right below the KPI
// strip, and — same "don't show a redundant view of the same one figure"
// call as the KPI strip's own single-owner case — only once
// `summary.byName.length > 1`, so a business with just one owner/partner
// never sees this card at all.
//
// **Linked-return indicator**: a return created via the "Record return"/
// "View history" flow above carries `parent_draw_id`, but until now that
// link was only ever visible inside the specific draw's own history modal
// — scanning the main list, a linked return and a freeform/historical one
// (see db/index.js's own note on `parent_draw_id`) looked identical.
// `routes/ownerDraws.js`'s `GET /` now LEFT JOINs each row back to its own
// parent draw and returns `parent_draw_date`/`parent_draw_amount` alongside
// it (both `null` for a draw row or an unlinked return) — a linked return's
// row (desktop table's "Taken by" cell, mobile accordion's own detail row)
// shows a small "↳ draw of {amount} · {date}" subtitle, same "only show
// the exception case" convention every other optional per-row detail in
// this app already follows.
//
// **"Outstanding only" filter + balance-sorted list**: `BALANCE_OPTIONS`
// is a second `StatusFilterChips` row below the existing type chips —
// `?hasBalance=1` (`routes/ownerDraws.js`'s own `GET /`) forces `type =
// 'draw'` and filters to a computed `balance > BALANCE_EPSILON`, so
// finding "who still owes money" no longer means scanning the balance
// column by eye. It also switches the list's own `ORDER BY` to balance
// descending instead of the usual date-recency order — "outstanding only"
// is about surfacing who owes the most, not what happened most recently
// — so the two, biggest-balance-first and filtered-to-outstanding-draws,
// pair naturally under one toggle rather than needing a separate sort
// control. `selectType()`/`selectBalanceFilter()` keep the two chip rows
// from contradicting each other (a return never has a balance, so picking
// one clears the other) rather than silently producing an empty list.
//
// **Per-owner statement PDF**: `routes/ownerDraws.js`'s `GET
// /statement/pdf?takenBy=` (`lib/reportPdf.js`'s `renderOwnerStatementPdf`,
// modeled directly on that file's own `renderBankBalancePdf`) is a
// printable ledger for one owner/partner — every draw/return in
// chronological order with a running balance column, plus a closing
// drawn/returned/outstanding summary. Reachable two ways: a "Statement"
// button next to the "Filter by name" dropdown once a specific owner is
// selected (covers the single-owner case), and a small download icon next
// to each row of the "Outstanding by owner" panel above (covers the
// multi-owner case without needing to touch the name filter first).
const TYPE_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'draw', label: 'Draws' },
  { value: 'return', label: 'Returns' },
];
// "Outstanding only" only ever means "a draw with something still owed" —
// it forces type='draw' server-side (see routes/ownerDraws.js's own
// GET / above) and additionally sorts by balance descending there, so
// switching it on both narrows the list and surfaces who owes the most
// first, without needing a separate sort control of its own.
const BALANCE_OPTIONS = [
  { value: '', label: 'All balances' },
  { value: 'outstanding', label: 'Outstanding only' },
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
  const [balanceFilter, setBalanceFilter] = useState('');

  const [returnTarget, setReturnTarget] = useState(null);
  const [returnDetail, setReturnDetail] = useState(null);
  const [returnDetailError, setReturnDetailError] = useState('');
  const [returnAmount, setReturnAmount] = useState('');
  const [returnDate, setReturnDate] = useState(todayStr());
  const [returnNotes, setReturnNotes] = useState('');
  const [returnSubmitting, setReturnSubmitting] = useState(false);
  const [returnError, setReturnError] = useState('');

  const { pendingIds, deleteWithUndo } = useUndoableDelete((id) => api.ownerDraws.remove(id, token));
  const visibleDraws = draws.filter((d) => !pendingIds.has(d.id));
  const { confirm, confirmDialog } = useConfirm();

  function load() {
    // Only show the loading skeleton on the very first load — see
    // CapitalContributions.jsx's own note on why (avoids the list visibly
    // jumping height on every search/filter refetch).
    if (draws.length === 0) setLoading(true);
    api.ownerDraws
      .list(token, { q: debouncedSearch, page, type: typeFilter, takenBy: takenByFilter, hasBalance: balanceFilter === 'outstanding' ? '1' : undefined })
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
  useEffect(load, [token, debouncedSearch, page, typeFilter, takenByFilter, balanceFilter]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadSummary, [token]);
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, typeFilter, takenByFilter, balanceFilter]);

  // "Outstanding only" and a specific type are mutually exclusive (a
  // return never has a balance — see routes/ownerDraws.js's own note on
  // GET / above), so picking one clears the other rather than letting the
  // two chip rows silently contradict each other.
  function selectType(v) {
    setTypeFilter(v);
    if (v === 'return') setBalanceFilter('');
  }
  function selectBalanceFilter(v) {
    setBalanceFilter(v);
    if (v === 'outstanding') setTypeFilter('');
  }

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

  // Opens the Return modal — pre-fills from the already-known list row
  // (`d.balance`, computed server-side by GET /) so the amount field and
  // summary numbers render instantly, then swaps in the freshly-fetched,
  // authoritative detail (including the full return history) once it
  // arrives, the same "instant from cache, then confirm from the server"
  // shape EmailPreviewModal's own "fetch on open" pattern follows.
  function openReturn(d) {
    setReturnTarget(d);
    setReturnDetail(null);
    setReturnDetailError('');
    setReturnAmount(d.balance != null ? String(d.balance) : '');
    setReturnDate(todayStr());
    setReturnNotes('');
    setReturnError('');
    api.ownerDraws
      .returns(d.id, token)
      .then((detail) => {
        setReturnDetail(detail);
        setReturnAmount(detail.draw.balance != null ? String(detail.draw.balance) : '');
      })
      .catch((err) => setReturnDetailError(err.message));
  }

  async function submitReturn(e) {
    e.preventDefault();
    if (!returnTarget) return;
    setReturnError('');
    const amountNum = Number(returnAmount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setReturnError('Amount must be a positive number');
      return;
    }
    const remaining = returnDetail?.draw?.balance ?? returnTarget.balance ?? 0;
    if (amountNum > remaining + 0.005) {
      setReturnError(`Amount cannot exceed the remaining balance of ${remaining.toFixed(2)}`);
      return;
    }
    setReturnSubmitting(true);
    try {
      const { draw, returns } = await api.ownerDraws.recordReturn(
        returnTarget.id,
        { amount: amountNum, draw_date: returnDate, notes: returnNotes },
        token,
      );
      setReturnDetail({ draw, returns });
      setReturnTarget(draw);
      setReturnAmount(draw.balance != null ? String(draw.balance) : '');
      setReturnNotes('');
      toast('Return recorded.', { type: 'success' });
      load();
      loadSummary();
    } catch (err) {
      setReturnError(err.message);
    } finally {
      setReturnSubmitting(false);
    }
  }

  // Shared between the desktop table's action cell and each mobile
  // MobileListAccordion card's expanded body, same convention Licenses.jsx's
  // own rowActions() already establishes — so the two breakpoints can
  // never drift apart on which buttons a row gets.
  function rowActions(d) {
    return (
      <>
        {d.type === 'draw' && canManage && (
          d.balance > 0.004 ? (
            <IconActionButton
              icon={RefreshIcon}
              tone="emerald"
              onClick={() => openReturn(d)}
              title="Record return"
              label="Record a return against this draw"
            />
          ) : (
            <IconActionButton
              icon={HistoryIcon}
              tone="slate"
              onClick={() => openReturn(d)}
              title="View history"
              label="View this draw's return history"
            />
          )
        )}
        {canManage && (
          <>
            <IconActionButton icon={PencilIcon} tone="slate" onClick={() => startEdit(d)} title="Edit" label="Edit record" />
            <IconActionButton icon={TrashIcon} tone="red" onClick={() => handleDelete(d)} title="Delete" label="Delete record" />
          </>
        )}
      </>
    );
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

      {/* Only worth showing once more than one owner/partner has drawn or
          returned money — with a single owner this would just repeat the
          "Outstanding balance" KPI card above under a different name. */}
      {summary && summary.byName.length > 1 && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Outstanding by owner</p>
          <div className="mt-2 flex flex-col divide-y divide-slate-100 dark:divide-slate-800">
            {summary.byName.map((n) => (
              <div key={n.name} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900 dark:text-white">{n.name}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {n.totalDraws.toFixed(2)} drawn · {n.totalReturns.toFixed(2)} returned
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`text-sm font-semibold ${
                      n.outstanding > 0.004
                        ? 'text-amber-700 dark:text-amber-400'
                        : n.outstanding < -0.004
                          ? 'text-red-700 dark:text-red-400'
                          : 'text-emerald-700 dark:text-emerald-400'
                    }`}
                  >
                    {n.outstanding.toFixed(2)}
                  </span>
                  <button
                    type="button"
                    onClick={() => api.ownerDraws.statementPdf(n.name, token)}
                    title={`Download statement for ${n.name}`}
                    aria-label={`Download statement for ${n.name}`}
                    className="rounded-md border border-slate-300 p-1.5 text-slate-500 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-800"
                  >
                    <DownloadIcon width={14} height={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
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
        {takenByFilter && (
          <button
            type="button"
            onClick={() => api.ownerDraws.statementPdf(takenByFilter, token)}
            className="flex min-h-11 items-center gap-1.5 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <DownloadIcon width={16} height={16} />
            Statement
          </button>
        )}
      </div>
      <div className="mt-3 flex flex-col gap-2">
        <StatusFilterChips options={TYPE_OPTIONS} value={typeFilter} onChange={selectType} />
        <StatusFilterChips options={BALANCE_OPTIONS} value={balanceFilter} onChange={selectBalanceFilter} />
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
            <TableSkeleton rows={5} cols={canManage ? ['w-24', 'w-20', 'w-32', 'w-40', 'w-20', 'w-20', 'w-24'] : ['w-24', 'w-20', 'w-32', 'w-40', 'w-20', 'w-20']} />
          </div>
        ) : visibleDraws.length === 0 ? (
          <EmptyState
            icon={<BankIcon />}
            title={search || typeFilter || takenByFilter || balanceFilter ? 'No records match these filters.' : 'No owner draws recorded yet.'}
            message={!search && !typeFilter && !takenByFilter && !balanceFilter && canManage ? 'Record money an owner or partner has taken out of the business.' : undefined}
            action={!search && !typeFilter && !takenByFilter && !balanceFilter && canManage ? { label: 'New record', onClick: startCreate } : undefined}
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
                    <th className="px-4 py-3 text-right">Balance</th>
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
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900 dark:text-white">
                        {d.taken_by_name}
                        {d.type === 'return' && d.parent_draw_id && (
                          <span className="mt-0.5 block text-xs font-normal text-slate-400 dark:text-slate-500">
                            ↳ draw of {d.parent_draw_amount.toFixed(2)} · {d.parent_draw_date}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{d.notes || '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-slate-900 dark:text-white">{d.amount.toFixed(2)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {d.type === 'draw' ? (
                          <span
                            className={
                              d.balance > 0.004
                                ? 'font-medium text-amber-700 dark:text-amber-400'
                                : 'text-emerald-700 dark:text-emerald-400'
                            }
                          >
                            {d.balance.toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-500">—</span>
                        )}
                      </td>
                      {canManage && (
                        <td className="whitespace-nowrap px-4 py-3">
                          <div className="flex justify-end gap-1.5">{rowActions(d)}</div>
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
                    {d.type === 'draw' && (
                      <div className="flex justify-between">
                        <dt className="text-slate-500 dark:text-slate-400">Balance</dt>
                        <dd
                          className={
                            d.balance > 0.004
                              ? 'font-medium text-amber-700 dark:text-amber-400'
                              : 'text-emerald-700 dark:text-emerald-400'
                          }
                        >
                          {d.balance.toFixed(2)}
                        </dd>
                      </div>
                    )}
                    {d.type === 'return' && d.parent_draw_id && (
                      <div className="flex justify-between">
                        <dt className="text-slate-500 dark:text-slate-400">Linked to</dt>
                        <dd className="text-slate-900 dark:text-white">
                          {d.parent_draw_amount.toFixed(2)} · {d.parent_draw_date}
                        </dd>
                      </div>
                    )}
                    {d.notes && (
                      <div className="flex justify-between">
                        <dt className="text-slate-500 dark:text-slate-400">Notes</dt>
                        <dd className="text-slate-900 dark:text-white">{d.notes}</dd>
                      </div>
                    )}
                    {canManage && <div className="flex flex-wrap gap-1.5 pt-1">{rowActions(d)}</div>}
                  </MobileListAccordion>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {pageInfo && <Pagination page={pageInfo.page} totalPages={pageInfo.totalPages} onChange={setPage} />}

      {canManage && !showForm && <FloatingActionButton onClick={startCreate} label="New record" />}

      <Modal open={!!returnTarget} onClose={() => setReturnTarget(null)} title={returnTarget ? `Return — ${returnTarget.taken_by_name}` : ''}>
        {returnTarget && (
          <div className="flex flex-col gap-4">
            <div className="rounded-md bg-slate-50 p-3 text-sm dark:bg-slate-800">
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Drawn</span>
                <span className="font-medium text-slate-900 dark:text-white">{returnTarget.amount.toFixed(2)}</span>
              </div>
              <div className="mt-1 flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Already returned</span>
                <span className="font-medium text-emerald-700 dark:text-emerald-400">
                  {(returnDetail?.draw.returned_amount ?? returnTarget.returned_amount ?? 0).toFixed(2)}
                </span>
              </div>
              <div className="mt-1.5 flex justify-between border-t border-slate-200 pt-1.5 dark:border-slate-700">
                <span className="text-slate-500 dark:text-slate-400">Balance to be paid</span>
                <span className="font-semibold text-slate-900 dark:text-white">
                  {(returnDetail?.draw.balance ?? returnTarget.balance ?? 0).toFixed(2)}
                </span>
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">Return history</p>
              {returnDetailError ? (
                <p className="text-sm text-red-600 dark:text-red-400">{returnDetailError}</p>
              ) : returnDetail === null ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
              ) : returnDetail.returns.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">No returns recorded yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {returnDetail.returns.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-4 py-2 text-sm">
                      <span className="text-slate-500 dark:text-slate-400">
                        {r.draw_date}
                        {r.notes ? ` — ${r.notes}` : ''}
                      </span>
                      <span className="font-medium text-slate-900 dark:text-white">{r.amount.toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {(returnDetail?.draw.balance ?? returnTarget.balance ?? 0) > 0.004 ? (
              <form onSubmit={submitReturn} className="flex flex-col gap-3 border-t border-slate-200 pt-3 dark:border-slate-700">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Record a payment</p>
                {returnError && <p className="text-sm text-red-600 dark:text-red-400">{returnError}</p>}
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Amount</span>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      required
                      value={returnAmount}
                      onChange={(e) => setReturnAmount(e.target.value)}
                      className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Date</span>
                    <div className="mt-1 flex h-11 w-full items-center overflow-hidden rounded-md border border-slate-300 px-3 focus-within:border-lagoon-500 dark:border-slate-600">
                      <input
                        type="date"
                        required
                        value={returnDate}
                        onChange={(e) => setReturnDate(e.target.value)}
                        className="h-full w-full appearance-none border-0 bg-transparent p-0 text-base focus:outline-none dark:text-white"
                      />
                    </div>
                  </label>
                </div>
                <label className="block">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Notes</span>
                  <input
                    type="text"
                    value={returnNotes}
                    onChange={(e) => setReturnNotes(e.target.value)}
                    placeholder="Optional context"
                    className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                  />
                </label>
                <div className="flex gap-3">
                  <button
                    type="submit"
                    disabled={returnSubmitting}
                    className="min-h-11 rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500 disabled:opacity-60"
                  >
                    {returnSubmitting ? 'Recording…' : 'Record return'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setReturnTarget(null)}
                    className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    Close
                  </button>
                </div>
              </form>
            ) : (
              <p className="text-sm text-emerald-700 dark:text-emerald-400">This draw has been fully repaid.</p>
            )}
          </div>
        )}
      </Modal>

      {confirmDialog}
    </div>
  );
}
