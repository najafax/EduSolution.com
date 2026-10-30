import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { todayStr } from '../../lib/date';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../lib/useConfirm';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import SearchInput from '../../components/SearchInput';
import Pagination from '../../components/Pagination';
import { Btn, Card, Chips, Detail, Empty, Field, FormModal, INPUT, Row, full, usd, useLoader, useSymbol } from './ui';

// Expenses: operating costs (rent, salaries, software…) you record by hand,
// plus the supplier payments that come out of the USD account. Supplier
// payments are managed from Cash & USD, so they are read-only here.

const EMPTY = { category: '', description: '', amount: '', expense_date: todayStr(), payee: '', notes: '' };

export default function ExpensesTab({ token, can, entry, clearEntry, goTab }) {
  const symbol = useSymbol(token);
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const canManage = can('expenses', 'manage');
  const [kind, setKind] = useState('operating');
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search);
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState(null);
  const [form, setForm] = useState(null); // null = closed; { id?, ...fields }
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  useEffect(() => setPage(1), [q, category]);

  const { data, error, reload } = useLoader(() => api.expenses.list(token, { q, page, category }), [token, q, page, category]);
  const canSeeUsd = can('financials', 'view');
  const { data: usdData } = useLoader(() => (canSeeUsd ? api.usdAccount.get(token) : Promise.resolve(null)), [token, canSeeUsd]);

  useEffect(() => {
    if (entry === 'expense') {
      setKind('operating');
      setForm({ ...EMPTY, expense_date: todayStr() });
      setFormError('');
      clearEntry();
    }
  }, [entry, clearEntry]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    setBusy(true);
    setFormError('');
    const payload = { ...form, amount: Number(form.amount) };
    try {
      if (form.id) await api.expenses.update(form.id, payload, token);
      else await api.expenses.create(payload, token);
      toast('Expense saved.', { type: 'success' });
      setForm(null);
      reload();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(x) {
    if (!(await confirm({ title: 'Delete this expense?', message: `${x.description} · ${full(symbol, x.amount)}`, confirmLabel: 'Delete' }))) return;
    try {
      await api.expenses.remove(x.id, token);
      toast('Expense deleted.', { type: 'success' });
      reload();
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  }

  const payments = (usdData?.transactions || []).filter((t) => t.type === 'supplier_payment');
  const kinds = [['operating', 'Operating']].concat(canSeeUsd ? [['supplier', 'Supplier costs']] : []);

  return (
    <div className="flex flex-col gap-4">
      <Card
        title={kind === 'operating' ? 'Operating expenses' : 'Supplier payments'}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {kinds.length > 1 && <Chips options={kinds} value={kind} onChange={setKind} />}
            {kind === 'operating' && canManage && <Btn tone="primary" onClick={() => (setForm({ ...EMPTY, expense_date: todayStr() }), setFormError(''))}>+ Expense</Btn>}
          </div>
        }
      >
        {kind === 'operating' ? (
          <>
            {error && <p className="mb-2 text-red-600 dark:text-red-400">{error}</p>}
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="w-full sm:w-72"><SearchInput value={search} onChange={setSearch} placeholder="Search expenses…" /></div>
              <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} className="min-h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white">
                <option value="">All categories</option>
                {(data?.categories || []).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <Btn onClick={() => api.expenses.exportCsv(token, { q, category }).catch((e) => toast(e.message, { type: 'error' }))}>Export CSV</Btn>
            </div>
            {data && <p className="mb-1 text-sm text-slate-600 dark:text-slate-300">Total for this view: <b className="tabular-nums">{full(symbol, data.totalAmount)}</b> ({data.total} expense{data.total === 1 ? '' : 's'})</p>}
            {!data ? <Empty>Loading…</Empty> : data.expenses.length === 0 ? <Empty>No expenses yet.</Empty> : data.expenses.map((x) => (
              <Row key={x.id} title={x.description} sub={`${x.expense_date}${x.payee ? ` · ${x.payee}` : ''}`} amount={full(symbol, x.amount)} tag={x.category} open={openId === x.id} onClick={() => setOpenId(openId === x.id ? null : x.id)}>
                <Detail pairs={[['Category', x.category], ['Date', x.expense_date], ['Payee', x.payee || '—'], ['Notes', x.notes || '—']]}>
                  {canManage && <Btn onClick={() => (setForm({ ...x, amount: String(x.amount) }), setFormError(''))}>Edit</Btn>}
                  {canManage && <Btn tone="danger" onClick={() => remove(x)}>Delete</Btn>}
                </Detail>
              </Row>
            ))}
            {data && <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />}
          </>
        ) : (
          <>
            <p className="mb-2 text-sm text-slate-600 dark:text-slate-300">Money paid to suppliers from the USD account. It is booked as a cost at the account’s average rate. Manage these from <button type="button" className="underline" onClick={() => goTab('cash')}>Cash &amp; USD</button>.</p>
            {payments.length === 0 ? <Empty>No supplier payments yet.</Empty> : payments.map((t) => (
              <Row key={t.id} title={t.payee || 'Supplier'} sub={`${t.txn_date}${t.reference ? ` · ${t.reference}` : ''}`} amount={usd(t.usd_amount)} tag={`${full(symbol, t.costMvr || 0)} cost`} tone="warn" />
            ))}
          </>
        )}
      </Card>

      <FormModal open={Boolean(form)} onClose={() => setForm(null)} title={form?.id ? 'Edit expense' : 'New expense'} onSubmit={save} busy={busy} error={formError}>
        {form && (
          <>
            <Field label="Category">
              <select required className={INPUT} value={form.category} onChange={set('category')}>
                <option value="">Choose…</option>
                {(data?.categories || []).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Date"><input required type="date" className={INPUT} value={form.expense_date} onChange={set('expense_date')} /></Field>
            <Field label="Description" className="sm:col-span-2"><input required className={INPUT} value={form.description} onChange={set('description')} /></Field>
            <Field label="Amount"><input required type="number" min="0" step="0.01" className={INPUT} value={form.amount} onChange={set('amount')} /></Field>
            <Field label="Paid to (optional)"><input className={INPUT} value={form.payee || ''} onChange={set('payee')} /></Field>
            <Field label="Notes (optional)" className="sm:col-span-2"><textarea rows={2} className={INPUT} value={form.notes || ''} onChange={set('notes')} /></Field>
          </>
        )}
      </FormModal>
      {confirmDialog}
    </div>
  );
}
