import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { todayStr } from '../../lib/date';
import { useToast } from '../../context/ToastContext';
import Modal from '../../components/Modal';
import RecordPaymentModal from '../../components/RecordPaymentModal';
import SearchableSelect from '../../components/SearchableSelect';
import { Btn, Card, Chips, Detail, Empty, Row, full, useLoader, useSymbol } from './ui';

// Income: what is owed to the business (receivables aging with every open
// invoice), what has been received recently, and the profit on each sale.

const BUCKET_COLOR = { current: 'bg-emerald-500', d1_30: 'bg-amber-400', d31_60: 'bg-orange-500', d61_90: 'bg-red-400', d90plus: 'bg-red-700' };

export default function IncomeTab({ token, can, range, entry, clearEntry }) {
  const symbol = useSymbol(token);
  const { toast } = useToast();
  const canManage = can('invoices', 'manage');
  const { data: aging, error, reload } = useLoader(() => api.reports.receivablesAging(todayStr(), token), [token]);
  const { data: sum, reload: reloadSum } = useLoader(() => api.financials.summary(token, range), [token, range.from, range.to]);
  const { data: profit } = useLoader(() => api.supplierCosts.profit(token, range).catch(() => null), [token, range.from, range.to]);
  const [filter, setFilter] = useState('open');
  const [openId, setOpenId] = useState(null);
  const [payInvoice, setPayInvoice] = useState(null);
  const [picker, setPicker] = useState(false);
  const [pickId, setPickId] = useState('');

  const invoices = useMemo(
    () => (aging ? aging.clients.flatMap((c) => c.invoices.filter((i) => i.balance > 0.004).map((i) => ({ ...i, client_name: c.client_name }))) : []),
    [aging],
  );
  const shown = invoices.filter((i) => (filter === 'overdue' ? i.days_overdue > 0 : true));

  useEffect(() => {
    if (entry === 'payment') {
      setPicker(true);
      clearEntry();
    }
  }, [entry, clearEntry]);

  async function startPayment(id) {
    try {
      const { invoice } = await api.invoices.get(id, token);
      setPayInvoice(invoice);
      setPicker(false);
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  }

  if (error) return <p className="text-red-600 dark:text-red-400">{error}</p>;
  if (!aging) return <p className="py-8 text-slate-500">Loading…</p>;
  const totalBar = aging.total || 1;
  const tone = (i) => (i.days_overdue > 30 ? 'neg' : i.days_overdue > 0 ? 'warn' : 'neu');

  return (
    <div className="flex flex-col gap-4">
      <Card title="Owed to you">
        <p className="font-display text-3xl font-extrabold tabular-nums text-slate-900 dark:text-white">{full(symbol, aging.total)}</p>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {aging.invoiceCount} open invoice{aging.invoiceCount === 1 ? '' : 's'} · {full(symbol, aging.overdueTotal)} overdue
          {aging.avgDaysOverdue ? ` (about ${aging.avgDaysOverdue} days late)` : ''}
        </p>
        <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          {aging.buckets.map((b) => b.amount > 0 && <i key={b.key} className={`block h-full ${BUCKET_COLOR[b.key]}`} style={{ width: `${(b.amount / totalBar) * 100}%` }} />)}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
          {aging.buckets.map((b) => (
            <span key={b.key}><i className={`mr-1.5 inline-block h-2 w-2 rounded-sm ${BUCKET_COLOR[b.key]}`} />{b.label} {full(symbol, b.amount)}</span>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Open invoices" action={<Chips value={filter} onChange={setFilter} options={[['open', 'All open'], ['overdue', 'Overdue']]} />}>
          {shown.length === 0 ? (
            <Empty>{filter === 'overdue' ? 'Nothing is overdue.' : 'No open invoices.'}</Empty>
          ) : (
            shown.map((i) => (
              <Row
                key={i.id}
                title={`${i.number} · ${i.client_name}`}
                sub={`Due ${i.due_date}`}
                amount={full(symbol, i.balance)}
                tag={i.days_overdue > 0 ? `${i.days_overdue}d overdue` : 'Not due'}
                tone={tone(i)}
                open={openId === i.id}
                onClick={() => setOpenId(openId === i.id ? null : i.id)}
              >
                <Detail pairs={[['Invoice total', full(symbol, i.total)], ['Paid so far', full(symbol, i.amount_paid)], ['Issued', i.issue_date]]}>
                  {canManage && <Btn tone="primary" onClick={() => startPayment(i.id)}>Record payment</Btn>}
                  <Link className="min-h-10 rounded-xl bg-slate-100 px-3.5 py-2 text-sm font-semibold dark:bg-slate-800 dark:text-white" to={`/invoices/${i.id}`}>Open invoice</Link>
                </Detail>
              </Row>
            ))
          )}
        </Card>

        <div className="flex min-w-0 flex-col gap-4">
          <Card title="Recently received">
            {!sum ? <Empty>Loading…</Empty> : sum.recentPayments.length === 0 ? <Empty>No payments in this period.</Empty> : (
              sum.recentPayments.map((p) => (
                <Row key={p.id} title={`${p.invoice_number || ''} · ${p.client_name || ''}`} sub={`${String(p.paid_at).slice(0, 10)} · ${(p.method || '').replace('_', ' ')}`} amount={full(symbol, p.amount)} />
              ))
            )}
          </Card>
          {profit && (
            <Card title="Profit per sale">
              <p className="mb-2 text-sm text-slate-600 dark:text-slate-300">
                {profit.totals.count} sale{profit.totals.count === 1 ? '' : 's'} · profit {full(symbol, profit.totals.profit)}
                {profit.totals.marginPct !== null ? ` (${profit.totals.marginPct}%)` : ''}
              </p>
              {profit.sales.length === 0 ? <Empty>No sales in this period.</Empty> : profit.sales.slice(0, 12).map((s) => (
                <Row key={s.invoice_id} title={`${s.number} · ${s.client_name}`} sub={`Revenue ${full(symbol, s.revenue)} · cost ${full(symbol, s.costMvr)}`} amount={full(symbol, s.profit)} tag={s.basis} tone={s.basis === 'actual' ? 'pos' : 'neu'} />
              ))}
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Cost is the real supplier cost where a paid supplier invoice is linked, otherwise an estimate.</p>
            </Card>
          )}
        </div>
      </div>

      <Modal open={picker} onClose={() => setPicker(false)} title="Payment received">
        <p className="mb-2 text-sm text-slate-600 dark:text-slate-300">Which invoice was paid?</p>
        <SearchableSelect
          options={invoices.map((i) => ({ value: String(i.id), label: `${i.number} · ${i.client_name} · ${full(symbol, i.balance)}` }))}
          value={pickId}
          onChange={setPickId}
          placeholder="Search invoices…"
        />
        <div className="mt-4 flex justify-end gap-2">
          <Btn onClick={() => setPicker(false)}>Cancel</Btn>
          <Btn tone="primary" disabled={!pickId} onClick={() => startPayment(Number(pickId))}>Continue</Btn>
        </div>
      </Modal>

      <RecordPaymentModal
        open={Boolean(payInvoice)}
        onClose={() => setPayInvoice(null)}
        invoice={payInvoice}
        token={token}
        onRecorded={() => {
          setPayInvoice(null);
          toast('Payment recorded.', { type: 'success' });
          reload();
          reloadSum();
        }}
      />
    </div>
  );
}
