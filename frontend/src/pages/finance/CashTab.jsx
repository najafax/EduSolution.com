import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { todayStr } from '../../lib/date';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../lib/useConfirm';
import SupplierInvoiceModal from '../../components/SupplierInvoiceModal';
import { Btn, Card, Chips, Detail, Empty, Field, FormModal, INPUT, Pill, Row, full, n2, usd, useLoader, useSymbol } from './ui';

// Cash & USD: the bank balance, the USD account (bought, paid out, sold, at a
// weighted-average cost), the supplier bills still to pay, and the sales that
// are waiting for a supplier invoice.

const EMPTY_TXN = { type: 'buy', txn_date: todayStr(), usd_amount: '', mvr_amount: '', rate: '', reference: '', notes: '' };
const KIND_LABEL = { opening: 'Opening balance', buy: 'Buy USD', sell: 'Convert USD to MVR' };

export default function CashTab({ token, can, entry, clearEntry }) {
  const symbol = useSymbol(token);
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const canManage = can('financials', 'manage');
  const { data: sum, reload: reloadSum } = useLoader(() => api.financials.summary(token), [token]);
  const { data: acct, error, reload: reloadAcct } = useLoader(() => api.usdAccount.get(token), [token]);
  const { data: over, reload: reloadOver } = useLoader(() => api.supplierCosts.report(token), [token]);
  const { data: si, reload: reloadSi } = useLoader(() => api.supplierInvoices.list(token), [token]);
  const [siFilter, setSiFilter] = useState('unpaid');
  const [openId, setOpenId] = useState(null);
  const [txn, setTxn] = useState(null);
  const [busy, setBusy] = useState(false);
  const [txnError, setTxnError] = useState('');
  const [siModal, setSiModal] = useState(null); // { invoice?, presetLink? }

  const reloadAll = () => (reloadSum(), reloadAcct(), reloadOver(), reloadSi());

  useEffect(() => {
    if (entry === 'buy-usd') {
      setTxn({ ...EMPTY_TXN });
      setTxnError('');
      clearEntry();
    } else if (entry === 'supplier-invoice') {
      setSiModal({});
      clearEntry();
    }
  }, [entry, clearEntry]);

  const set = (k) => (e) => setTxn((t) => ({ ...t, [k]: e.target.value }));

  async function saveTxn() {
    setBusy(true);
    setTxnError('');
    const p = { type: txn.type, txn_date: txn.txn_date, usd_amount: Number(txn.usd_amount), reference: txn.reference, notes: txn.notes };
    if (txn.type === 'opening') p.rate = Number(txn.rate);
    else p.mvr_amount = Number(txn.mvr_amount);
    try {
      if (txn.id) await api.usdAccount.update(txn.id, p, token);
      else await api.usdAccount.create(p, token);
      toast('Saved.', { type: 'success' });
      setTxn(null);
      reloadAll();
    } catch (err) {
      setTxnError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function act(fn, ok) {
    try {
      await fn();
      if (ok) toast(ok, { type: 'success' });
      reloadAll();
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  }

  async function removeTxn(t) {
    if (!(await confirm({ title: 'Delete this USD entry?', message: `${t.type_label} · ${usd(t.usd_amount)} on ${t.txn_date}`, confirmLabel: 'Delete' }))) return;
    act(() => api.usdAccount.remove(t.id, token), 'Entry deleted.');
  }

  async function pay(s) {
    if (!(await confirm({ title: `Pay ${s.supplier}?`, message: `${usd(s.usd_amount)} comes out of the USD account today, in full.${s.payment_url ? ' Only do this after you have paid through the supplier\'s link.' : ''}`, confirmLabel: 'Pay', danger: false }))) return;
    act(() => api.supplierInvoices.pay(s.id, { txn_date: todayStr() }, token), 'Supplier paid.');
  }
  async function unpay(s) {
    if (!(await confirm({ title: 'Undo this payment?', message: `${usd(s.usd_amount)} goes back into the USD account.`, confirmLabel: 'Undo payment' }))) return;
    act(() => api.supplierInvoices.unpay(s.id, token), 'Payment undone.');
  }
  async function removeSi(s) {
    if (!(await confirm({ title: 'Delete this supplier invoice?', message: `${s.supplier} · ${usd(s.usd_amount)}`, confirmLabel: 'Delete' }))) return;
    act(() => api.supplierInvoices.remove(s.id, token), 'Deleted.');
  }

  if (error) return <p className="text-red-600 dark:text-red-400">{error}</p>;
  if (!acct) return <p className="py-8 text-slate-500">Loading…</p>;

  const invoices = (si?.supplierInvoices || []).filter((s) => (siFilter === 'all' ? true : s.status === siFilter));
  const shortfall = over && over.shortfallUsd > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Bank balance">
          <p className="font-display text-3xl font-extrabold tabular-nums text-slate-900 dark:text-white">{sum ? full(symbol, sum.bankBalance) : '…'}</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Starting balance + net profit + contributions − owner draws, profit payouts and the MVR spent buying USD.</p>
        </Card>
        <Card
          title="USD account"
          action={canManage && (
            <div className="flex gap-2">
              {!acct.hasOpening && <Btn onClick={() => (setTxn({ ...EMPTY_TXN, type: 'opening' }), setTxnError(''))}>Opening balance</Btn>}
              <Btn tone="primary" onClick={() => (setTxn({ ...EMPTY_TXN }), setTxnError(''))}>Buy USD</Btn>
              <Btn onClick={() => (setTxn({ ...EMPTY_TXN, type: 'sell' }), setTxnError(''))}>Sell</Btn>
            </div>
          )}
        >
          <p className="font-display text-3xl font-extrabold tabular-nums text-slate-900 dark:text-white">{usd(acct.balanceUsd)}</p>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            {acct.avgRate ? `Average cost ${n2(acct.avgRate)} per USD · worth ${full(symbol, acct.bookValueMvr)}` : 'No USD held yet.'}
            {acct.lastBuyRate ? ` · last buy ${n2(acct.lastBuyRate)}` : ''}
          </p>
          {acct.warning && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{acct.warning}</p>}
        </Card>
      </div>

      {shortfall && (
        <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          You need <b>{usd(over.shortfallUsd)}</b> more{over.shortfallMvr ? ` (about ${full(symbol, over.shortfallMvr)})` : ''} to pay every unpaid supplier invoice.
          {canManage && <Btn className="ml-2" onClick={() => (setTxn({ ...EMPTY_TXN, usd_amount: String(over.shortfallUsd), mvr_amount: over.shortfallMvr ? String(over.shortfallMvr) : '' }), setTxnError(''))}>Buy USD</Btn>}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Supplier invoices"
          action={<div className="flex items-center gap-2"><Chips value={siFilter} onChange={setSiFilter} options={[['unpaid', 'Unpaid'], ['paid', 'Paid'], ['all', 'All']]} />{canManage && <Btn tone="primary" onClick={() => setSiModal({})}>+ Add</Btn>}</div>}
        >
          {invoices.length === 0 ? <Empty>No {siFilter === 'all' ? '' : siFilter} supplier invoices.</Empty> : invoices.map((s) => (
            <Row
              key={s.id}
              title={s.supplier}
              sub={`${s.number || 'No number'}${s.due_date ? ` · due ${s.due_date}` : ''}`}
              amount={usd(s.usd_amount)}
              tag={s.status === 'paid' ? 'Paid' : s.is_overdue ? 'Overdue' : 'Unpaid'}
              tone={s.status === 'paid' ? 'pos' : s.is_overdue ? 'neg' : 'warn'}
              open={openId === `si${s.id}`}
              onClick={() => setOpenId(openId === `si${s.id}` ? null : `si${s.id}`)}
            >
              <Detail pairs={[
                ['Invoice date', s.invoice_date], ['Funds sales', s.links.length ? s.links.map((l) => l.number || `#${l.invoice_id}`).join(', ') : 'none linked'],
                ['Not assigned', usd(s.unassigned_usd)], ...(s.status === 'paid' ? [['Paid on', s.paid_at]] : []),
              ]}>
                {s.status === 'unpaid' && s.payment_url && (
                  <a href={s.payment_url} target="_blank" rel="noopener noreferrer" title={s.payment_url} className="inline-flex min-h-9 items-center rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800">
                    Open payment link ({(() => { try { return new URL(s.payment_url).hostname; } catch { return 'link'; } })()})
                  </a>
                )}
                {canManage && s.status === 'unpaid' && <Btn tone="primary" onClick={() => pay(s)}>{s.payment_url ? 'Mark paid' : 'Pay in full'}</Btn>}
                {canManage && s.status === 'paid' && <Btn onClick={() => unpay(s)}>Undo payment</Btn>}
                {canManage && <Btn onClick={() => setSiModal({ invoice: s })}>{s.status === 'paid' ? 'Links' : 'Edit'}</Btn>}
                {s.has_file && <Btn onClick={() => api.supplierInvoices.openFile(s.id, token).catch((e) => toast(e.message, { type: 'error' }))}>View file</Btn>}
                {canManage && s.status === 'unpaid' && <Btn tone="danger" onClick={() => removeSi(s)}>Delete</Btn>}
              </Detail>
            </Row>
          ))}
        </Card>

        <div className="flex min-w-0 flex-col gap-4">
          <Card title="Sales waiting for a supplier invoice">
            {!over ? <Empty>Loading…</Empty> : over.awaiting.length === 0 ? <Empty>Every tracked sale has its supplier invoice.</Empty> : over.awaiting.map((a) => (
              <Row key={a.invoice_id} title={`${a.number} · ${a.client_name}`} sub={`Issued ${a.issue_date}`} amount={`~${usd(a.remainingUsd)}`} open={openId === `aw${a.invoice_id}`} onClick={() => setOpenId(openId === `aw${a.invoice_id}` ? null : `aw${a.invoice_id}`)}>
                <Detail pairs={[['Estimated cost', usd(a.estimatedUsd)], ['Already linked', usd(a.linkedUsd)]]}>
                  {canManage && <Btn tone="primary" onClick={() => setSiModal({ presetLink: { invoice_id: a.invoice_id, usd_amount: a.remainingUsd } })}>Add supplier invoice</Btn>}
                  {canManage && <Btn onClick={() => act(() => api.supplierCosts.markDone(a.invoice_id, true, token), 'Marked: no supplier invoice needed.')}>Not needed</Btn>}
                </Detail>
              </Row>
            ))}
          </Card>

          <Card title="USD ledger">
            {acct.transactions.length === 0 ? <Empty>No USD entries yet.</Empty> : acct.transactions.slice(0, 30).map((t) => {
              const plus = t.type === 'buy' || t.type === 'opening';
              return (
                <Row
                  key={t.id}
                  title={t.type_label}
                  sub={`${t.txn_date}${t.payee ? ` · ${t.payee}` : ''}${t.reference ? ` · ${t.reference}` : ''}`}
                  amount={`${plus ? '+' : '−'}${usd(t.usd_amount)}`}
                  tag={t.type === 'supplier_payment' ? `${full(symbol, t.costMvr || 0)} cost` : t.mvr_amount ? full(symbol, t.mvr_amount) : undefined}
                  tone={t.type === 'supplier_payment' ? 'warn' : 'neu'}
                  open={openId === `tx${t.id}`}
                  onClick={() => setOpenId(openId === `tx${t.id}` ? null : `tx${t.id}`)}
                >
                  <Detail pairs={[['Rate', t.usd_amount && t.mvr_amount ? n2(t.mvr_amount / t.usd_amount) : '—'], ['Notes', t.notes || '—']]}>
                    {canManage && t.type !== 'supplier_payment' && <Btn onClick={() => (setTxn({ ...t, usd_amount: String(t.usd_amount), mvr_amount: String(t.mvr_amount || ''), rate: t.type === 'opening' && t.usd_amount ? String(t.mvr_amount / t.usd_amount) : '' }), setTxnError(''))}>Edit</Btn>}
                    {canManage && t.type !== 'supplier_payment' && <Btn tone="danger" onClick={() => removeTxn(t)}>Delete</Btn>}
                    {t.type === 'supplier_payment' && <Pill>Managed from the supplier invoice</Pill>}
                  </Detail>
                </Row>
              );
            })}
          </Card>
        </div>
      </div>

      <FormModal open={Boolean(txn)} onClose={() => setTxn(null)} title={txn ? `${txn.id ? 'Edit' : 'New'}: ${KIND_LABEL[txn.type] || txn.type}` : ''} onSubmit={saveTxn} busy={busy} error={txnError}>
        {txn && (
          <>
            <Field label="Date"><input required type="date" className={INPUT} value={txn.txn_date} onChange={set('txn_date')} /></Field>
            <Field label="USD amount"><input required type="number" min="0" step="0.01" className={INPUT} value={txn.usd_amount} onChange={set('usd_amount')} /></Field>
            {txn.type === 'opening' ? (
              <Field label="Average cost (MVR per USD)" className="sm:col-span-2"><input required type="number" min="0" step="0.0001" className={INPUT} value={txn.rate} onChange={set('rate')} /></Field>
            ) : (
              <Field label={txn.type === 'sell' ? 'MVR received' : 'MVR paid'} className="sm:col-span-2">
                <input required type="number" min="0" step="0.01" className={INPUT} value={txn.mvr_amount} onChange={set('mvr_amount')} />
                {Number(txn.usd_amount) > 0 && Number(txn.mvr_amount) > 0 && <span className="text-xs text-slate-500 dark:text-slate-400">Rate {n2(txn.mvr_amount / txn.usd_amount)} MVR per USD</span>}
              </Field>
            )}
            <Field label="Reference (optional)" className="sm:col-span-2"><input className={INPUT} value={txn.reference || ''} onChange={set('reference')} /></Field>
          </>
        )}
      </FormModal>

      <SupplierInvoiceModal
        open={Boolean(siModal)}
        onClose={() => setSiModal(null)}
        token={token}
        invoice={siModal?.invoice || null}
        presetLink={siModal?.presetLink || null}
        onSaved={() => {
          setSiModal(null);
          toast('Saved.', { type: 'success' });
          reloadAll();
        }}
      />
      {confirmDialog}
    </div>
  );
}
