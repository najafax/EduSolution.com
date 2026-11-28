import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { useToast } from '../../../context/ToastContext';
import Modal from '../../../components/Modal';
import Pagination from '../../../components/Pagination';
import StatusFilterChips from '../../../components/StatusFilterChips';
import { AREA, BTN, BTN2, INPUT, Field } from './common';

const STATUSES = ['new', 'confirmed', 'packed', 'dispatched', 'delivered', 'cancelled'];
const PAY = { cod: 'Pay on delivery (old)', purchase_order: 'Purchase order', bank_transfer: 'Bank transfer', card: 'Card' };
const TONE = { new: 'bg-red-100 text-red-700', confirmed: 'bg-sky-100 text-sky-700', packed: 'bg-indigo-100 text-indigo-700', dispatched: 'bg-amber-100 text-amber-800', delivered: 'bg-emerald-100 text-emerald-700', cancelled: 'bg-slate-200 text-slate-600' };

function OrderModal({ token, id, canManage, canInvoice, onClose, onChanged }) {
  const { toast } = useToast();
  const [d, setD] = useState(null);
  const [f, setF] = useState({ status: 'new', payment_status: 'unpaid', staff_notes: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.shop.order(id, token).then((r) => { setD(r); setF({ status: r.order.status, payment_status: r.order.payment_status, staff_notes: r.order.staff_notes || '' }); });
  }, [id, token]);
  if (!d) return <p className="py-10 text-center text-sm text-slate-500">Loading…</p>;
  const o = d.order;
  async function save() {
    setBusy(true);
    try { await api.shop.updateOrder(id, f, token); toast('Order updated', { type: 'success' }); onChanged(); onClose(); } catch (e) { toast(e.message, { type: 'error' }); } finally { setBusy(false); }
  }
  async function invoice() {
    setBusy(true);
    try { const r = await api.shop.createInvoice(id, token); toast(`Draft invoice ${r.number} created`, { type: 'success' }); onChanged(); const x = await api.shop.order(id, token); setD(x); } catch (e) { toast(e.message, { type: 'error' }); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-4 text-sm text-slate-700 dark:text-slate-200">
      <div className="grid gap-1">
        <div><b>{o.customer_name}</b> · <a className="text-lagoon-700 underline" href={`tel:${o.phone}`}>{o.phone}</a>{o.email && <> · {o.email}</>}</div>
        <div>Deliver to <b>{o.island}</b>{o.boat && <> · boat/harbour: <b>{o.boat}</b></>}{o.address && <> · {o.address}</>}</div>
        {o.notes && <div className="rounded-lg bg-amber-50 p-2 text-slate-800">Customer note: {o.notes}</div>}
        <div>Payment: <b>{PAY[o.payment_method]}</b>{o.po_number && <> · PO number: <b>{o.po_number}</b></>}</div>
      </div>
      <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
        {d.items.map((i) => <div key={i.id} className="flex justify-between gap-3 px-3 py-2"><span>{i.quantity} × {i.name} <span className="text-xs text-slate-500">({i.sku})</span></span><b>{Number(i.amount).toLocaleString()}</b></div>)}
        <div className="flex justify-between px-3 py-2 font-bold"><span>Total</span><span>{Number(o.total).toLocaleString()}</span></div>
      </div>
      {canManage && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Order status"><select className={INPUT} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
          <Field label="Payment"><select className={INPUT} value={f.payment_status} onChange={(e) => setF({ ...f, payment_status: e.target.value })}><option value="unpaid">Unpaid</option><option value="paid">Paid</option><option value="refunded">Refunded</option></select></Field>
          <Field label="Staff notes (private)" className="sm:col-span-2"><textarea rows={3} className={AREA} value={f.staff_notes} onChange={(e) => setF({ ...f, staff_notes: e.target.value })} /></Field>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          {d.invoice ? <Link className="font-semibold text-lagoon-700 underline" to={`/invoices/${d.invoice.id}`}>Invoice {d.invoice.number}</Link>
            : canInvoice && <button type="button" disabled={busy} className={BTN2} onClick={invoice}>Create client + draft invoice</button>}
        </div>
        <div className="flex gap-2"><button type="button" className={BTN2} onClick={onClose}>Close</button>{canManage && <button type="button" disabled={busy} className={BTN} onClick={save}>Save</button>}</div>
      </div>
    </div>
  );
}

export default function OrdersTab({ token, canManage, canInvoice, refreshStats }) {
  const [status, setStatus] = useState('open');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(null);
  function load() { api.shop.orders(token, { status, page }).then(setData).catch(() => {}); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [token, status, page]);
  useEffect(() => setPage(1), [status]);
  return (
    <div className="space-y-4">
      <StatusFilterChips value={status} onChange={setStatus} options={[{ value: 'open', label: 'Open' }, { value: 'new', label: 'New' }, { value: 'dispatched', label: 'On the way' }, { value: 'delivered', label: 'Delivered' }, { value: 'cancelled', label: 'Cancelled' }, { value: '', label: 'All' }]} />
      {data && data.orders.length === 0 && <p className="rounded-2xl bg-white py-14 text-center text-sm text-slate-500 dark:bg-slate-800">No orders here yet.</p>}
      <div className="grid gap-3">
        {data?.orders.map((o) => (
          <button key={o.id} type="button" onClick={() => setOpen(o.id)} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl bg-white p-4 text-left shadow-sm hover:shadow-md dark:border dark:border-slate-700 dark:bg-slate-800">
            <b className="text-slate-900 dark:text-white">{o.number}</b>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${TONE[o.status]}`}>{o.status}</span>
            <span className="text-sm text-slate-600 dark:text-slate-300">{o.customer_name} · {o.island}</span>
            <span className="text-xs text-slate-500">{o.item_count} items · {PAY[o.payment_method]} · {o.payment_status}</span>
            <b className="ml-auto text-slate-900 dark:text-white">{Number(o.total).toLocaleString()}</b>
          </button>
        ))}
      </div>
      {data && <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />}
      <Modal open={open !== null} onClose={() => setOpen(null)} title="Order" maxWidthClass="max-w-2xl">
        {open !== null && <OrderModal key={open} token={token} id={open} canManage={canManage} canInvoice={canInvoice} onClose={() => setOpen(null)} onChanged={() => { load(); refreshStats(); }} />}
      </Modal>
    </div>
  );
}
