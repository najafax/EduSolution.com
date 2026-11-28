import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { shopApi, money } from './shopApi.js';
import { useCart } from './cart.jsx';
import { useShop } from './ShopApp.jsx';
import { ProductImage, Spinner, EMBER, whatsappLink } from './ui.jsx';

const input = 'w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-base outline-none focus:border-[#0B1B3A]';

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-bold text-[#0B1B3A]">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Checkout() {
  const { settings } = useShop();
  const cart = useCart();
  const nav = useNavigate();
  const shownAt = useRef(Date.now());
  const [f, setF] = useState({ name: '', phone: '', email: '', island: '', boat: '', address: '', notes: '', payment_method: settings.has_bank_details ? 'bank_transfer' : 'purchase_order', po_number: '', website: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cur = settings.currency;
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  // Refresh prices (and drop anything no longer sold) before the customer pays.
  useEffect(() => {
    if (cart.lines.length === 0) return;
    Promise.all(cart.lines.map((l) => shopApi.product(l.id).then((d) => [l.id, d.product]).catch(() => [l.id, null]))).then((rows) => {
      const fresh = {};
      rows.forEach(([id, p]) => { if (p && p.stock_status !== 'out') fresh[id] = p; });
      cart.refresh(fresh);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (cart.lines.length === 0) {
    return (
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <h1 className="font-display text-3xl font-extrabold text-[#0B1B3A]">Your cart is empty</h1>
        <Link to="/products" className="mt-6 inline-block rounded-xl px-6 py-3 font-display font-extrabold text-white" style={{ background: EMBER }}>Start shopping</Link>
      </div>
    );
  }

  async function submit(e, viaWhatsapp = false) {
    if (e) e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const r = await shopApi.createOrder({
        ...f,
        items: cart.lines.map((l) => ({ product_id: l.id, quantity: l.qty })),
        t: shownAt.current,
      });
      if (!r.token) throw new Error('We could not place your order. Please try again.');
      const lines = cart.lines.map((l) => `${l.qty} × ${l.name}`).join('\n');
      const wa = viaWhatsapp
        ? whatsappLink(settings.whatsapp, `Hi, I just placed order ${r.number} (${money(cart.total, cur)}):\n${lines}\nDelivery: ${f.island}${f.boat ? `, ${f.boat}` : ''}. Name: ${f.name}.`)
        : '';
      cart.clear();
      nav(`/order/${r.token}`, { replace: true, state: { fresh: true, wa } });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const methods = [
    ...(settings.has_bank_details ? [['bank_transfer', 'Bank transfer', 'We show our account details after you order. We dispatch once payment is received.']] : []),
    ['purchase_order', 'Purchase order (organisations)', 'For schools and government offices: we deliver once we receive your purchase order.'],
    ...(settings.card_enabled ? [['card', 'Card', 'We send you a secure payment link to pay by card.']] : []),
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="font-display text-3xl font-extrabold tracking-tight text-[#0B1B3A] sm:text-4xl">Checkout</h1>
      <form onSubmit={submit} className="mt-6 grid gap-8 lg:grid-cols-[1fr_380px]">
        <div className="space-y-5 rounded-3xl bg-white p-5 shadow-sm sm:p-8">
          <h2 className="font-display text-xl font-extrabold text-[#0B1B3A]">Delivery details</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name"><input required className={input} value={f.name} onChange={set('name')} autoComplete="name" /></Field>
            <Field label="Phone number" hint="We call or WhatsApp to confirm delivery."><input required inputMode="tel" className={input} value={f.phone} onChange={set('phone')} autoComplete="tel" /></Field>
            <Field label="Email (optional)"><input type="email" className={input} value={f.email} onChange={set('email')} autoComplete="email" /></Field>
            <Field label="Island / atoll"><input required className={input} value={f.island} onChange={set('island')} placeholder="e.g. Maafushi, Kaafu" /></Field>
            <Field label="Boat name or harbour (optional)" hint="We deliver to the boat or harbour you request."><input className={input} value={f.boat} onChange={set('boat')} /></Field>
            <Field label="Address (optional)"><input className={input} value={f.address} onChange={set('address')} autoComplete="street-address" /></Field>
          </div>
          <Field label="Notes (optional)"><textarea rows={3} className={input} value={f.notes} onChange={set('notes')} placeholder="Anything we should know for delivery?" /></Field>
          {/* honeypot: real visitors never see or fill this */}
          <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
            <label>Website<input tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} /></label>
          </div>

          <h2 className="pt-2 font-display text-xl font-extrabold text-[#0B1B3A]">How would you like to pay?</h2>
          <div className="grid gap-3">
            {methods.map(([v, t, d]) => (
              <label key={v} className={`flex cursor-pointer items-start gap-3 rounded-2xl border-2 p-4 ${f.payment_method === v ? 'border-[#0B1B3A] bg-[#0B1B3A]/[0.03]' : 'border-slate-200'}`}>
                <input type="radio" name="pay" className="mt-1" checked={f.payment_method === v} onChange={() => setF((s) => ({ ...s, payment_method: v }))} />
                <span><span className="block font-bold text-[#0B1B3A]">{t}</span><span className="text-sm text-slate-500">{d}</span></span>
              </label>
            ))}
          </div>
          {f.payment_method === 'purchase_order' && (
            <Field label="PO number (optional)" hint="Not ready yet? Send the PO to us by email or WhatsApp after ordering, quoting your order number."><input className={input} value={f.po_number} onChange={set('po_number')} /></Field>
          )}
        </div>

        <aside className="h-fit space-y-4 rounded-3xl bg-white p-5 shadow-sm sm:p-6 lg:sticky lg:top-28">
          <h2 className="font-display text-xl font-extrabold text-[#0B1B3A]">Your order</h2>
          <div className="space-y-3">
            {cart.lines.map((l) => (
              <div key={l.id} className="flex gap-3">
                <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-white ring-1 ring-slate-100">
                  <ProductImage product={{ images: l.image ? [l.image] : [], name: l.name }} className="h-full w-full" />
                </div>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="line-clamp-2 font-semibold text-[#0B1B3A]">{l.name}</p>
                  <p className="text-slate-500">{l.qty} × {money(l.price, cur)}</p>
                </div>
                <div className="text-sm font-bold text-[#0B1B3A]">{money(l.qty * l.price, cur)}</div>
              </div>
            ))}
          </div>
          <div className="flex items-baseline justify-between border-t border-slate-100 pt-4">
            <span className="text-sm text-slate-600">Total</span>
            <span className="font-display text-3xl font-extrabold text-[#0B1B3A]">{money(cart.total, cur)}</span>
          </div>
          <p className="text-xs text-slate-500">{settings.delivery_note}</p>
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>}
          <button disabled={busy} className="w-full rounded-xl py-4 font-display text-base font-extrabold text-white transition hover:brightness-110 disabled:opacity-60" style={{ background: EMBER }}>
            {busy ? 'Placing your order…' : 'Place order'}
          </button>
          {whatsappLink(settings.whatsapp) && (
            <button type="button" disabled={busy} onClick={(ev) => { const form = ev.currentTarget.closest('form'); if (form && !form.reportValidity()) return; submit(null, true); }} className="w-full rounded-xl border-2 border-emerald-600 py-3.5 font-display text-sm font-extrabold text-emerald-700 hover:bg-emerald-50 disabled:opacity-60">
              Place order &amp; send it on WhatsApp
            </button>
          )}
          <p className="text-center text-xs text-slate-500">By ordering you agree to our <Link to="/terms" className="underline">terms of sale</Link>.</p>
        </aside>
      </form>
    </div>
  );
}

const STEPS = [['new', 'Received'], ['confirmed', 'Confirmed'], ['packed', 'Packed'], ['dispatched', 'On its way'], ['delivered', 'Delivered']];

export function OrderPage() {
  const { token } = useParams();
  const { settings } = useShop();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const load = () => shopApi.order(token).then(setData).catch((e) => setError(e.message));
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [token]);

  if (error) return <div className="mx-auto max-w-xl px-4 py-24 text-center text-slate-600">{error}</div>;
  if (!data) return <Spinner />;
  const o = data.order;
  const cur = settings.currency;
  const idx = STEPS.findIndex(([s]) => s === o.status);
  const loc = useLocation();
  const wa = whatsappLink(settings.whatsapp, `Hi, about my order ${o.number}.`);
  const sentWa = loc.state && loc.state.wa;
  const payNote = {
    purchase_order: 'We deliver once we receive your purchase order. Please send it to us quoting your order number.',
    bank_transfer: 'Please transfer the total to the account below and send us the slip, quoting your order number.',
    card: o.payment_link ? 'Pay securely by card using the button below.' : 'We will send you a secure card payment link shortly.',
  }[o.payment_method];

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="rounded-3xl bg-white p-6 shadow-sm sm:p-10">
        <div className="text-xs font-extrabold uppercase tracking-[0.2em]" style={{ color: EMBER }}>Thank you, {o.customer_name.split(' ')[0]}</div>
        <h1 className="mt-1 font-display text-3xl font-extrabold text-[#0B1B3A]">Order {o.number}</h1>
        <p className="mt-1 text-sm text-slate-500">Keep this page: it shows where your order is. Delivering to {o.island}{o.boat ? ` (${o.boat})` : ''}.</p>

        {o.status === 'cancelled' ? (
          <p className="mt-6 rounded-2xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">This order was cancelled. Contact us if that is a surprise.</p>
        ) : (
          <ol className="mt-8 grid grid-cols-5 gap-1">
            {STEPS.map(([s, label], i) => (
              <li key={s} className="text-center">
                <div className={`mx-auto grid h-9 w-9 place-items-center rounded-full text-sm font-extrabold ${i <= idx ? 'text-white' : 'bg-slate-100 text-slate-400'}`} style={i <= idx ? { background: i === idx ? EMBER : '#0B1B3A' } : undefined}>{i < idx ? '✓' : i + 1}</div>
                <div className={`mt-1.5 text-[11px] font-semibold sm:text-xs ${i <= idx ? 'text-[#0B1B3A]' : 'text-slate-400'}`}>{label}</div>
              </li>
            ))}
          </ol>
        )}

        <div className="mt-8 divide-y divide-slate-100 text-sm">
          {data.items.map((i) => (
            <div key={i.sku + i.name} className="flex justify-between gap-4 py-3">
              <span className="text-slate-700">{i.quantity} × {i.name}</span>
              <span className="font-bold text-[#0B1B3A]">{money(i.amount, cur)}</span>
            </div>
          ))}
          <div className="flex justify-between py-4">
            <span className="font-bold text-[#0B1B3A]">Total</span>
            <span className="font-display text-2xl font-extrabold text-[#0B1B3A]">{money(o.total, cur)}</span>
          </div>
        </div>

        <div className="rounded-2xl bg-[#F6F1E9] p-4 text-sm text-slate-700">
          <div className="font-bold text-[#0B1B3A]">Payment · {o.payment_status === 'paid' ? 'Paid' : 'Not paid yet'}</div>
          <p className="mt-1">{payNote}</p>
          {o.payment_link && o.payment_status !== 'paid' && (
            <a href={o.payment_link} target="_blank" rel="noreferrer" className="mt-3 inline-block rounded-xl px-6 py-3 font-display text-sm font-extrabold text-white" style={{ background: EMBER }}>Pay by card →</a>
          )}
          {o.bank_details && <pre className="mt-3 whitespace-pre-wrap rounded-xl bg-white p-3 font-sans text-sm text-slate-800">{o.bank_details}</pre>}
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link to="/products" className="rounded-xl bg-[#0B1B3A] px-5 py-3 font-display text-sm font-extrabold text-white">Keep shopping</Link>
          {sentWa && <a href={sentWa} target="_blank" rel="noreferrer" className="rounded-xl bg-emerald-600 px-5 py-3 font-display text-sm font-extrabold text-white">Send this order on WhatsApp</a>}
          {wa && <a href={wa} target="_blank" rel="noreferrer" className="rounded-xl border border-emerald-600 px-5 py-3 font-display text-sm font-extrabold text-emerald-700">Message us on WhatsApp</a>}
        </div>
      </div>
    </div>
  );
}
