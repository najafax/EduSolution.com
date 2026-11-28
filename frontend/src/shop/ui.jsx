import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { imgUrl, money } from './shopApi.js';
import { useCart } from './cart.jsx';

export const NAVY = '#0B1B3A';
export const EMBER = '#E8472B';

export const THEMES = {
  ember: 'from-[#F0592F] via-[#E8472B] to-[#B8260E]',
  ocean: 'from-[#2E86F5] via-[#0B5FD6] to-[#07357D]',
  forest: 'from-[#1FA46D] via-[#0F7B4E] to-[#07442B]',
  ink: 'from-[#2A3350] via-[#161C30] to-[#0A0D18]',
};

export function whatsappLink(number, text = '') {
  let d = String(number || '').replace(/\D/g, '');
  if (d.length === 7) d = `960${d}`;
  if (!d) return '';
  return `https://wa.me/${d}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

export function Countdown({ endsAt, className = '' }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const ms = new Date(endsAt).getTime() - now;
  if (!endsAt || !Number.isFinite(ms) || ms <= 0) return null;
  const s = Math.floor(ms / 1000);
  const parts = [
    [Math.floor(s / 86400), 'd'],
    [Math.floor((s % 86400) / 3600), 'h'],
    [Math.floor((s % 3600) / 60), 'm'],
    [s % 60, 's'],
  ];
  return (
    <div className={`flex items-center gap-1.5 ${className}`} aria-label="Time left">
      {parts.map(([v, l]) => (
        <span key={l} className="min-w-[2.6rem] rounded-lg bg-black/30 px-2 py-1 text-center font-display text-lg font-extrabold tabular-nums leading-none text-white">
          {String(v).padStart(2, '0')}
          <span className="ml-0.5 text-[10px] font-semibold uppercase opacity-70">{l}</span>
        </span>
      ))}
    </div>
  );
}

export function ProductImage({ product, className = '', index = 0 }) {
  const id = product.images?.[index];
  const [broken, setBroken] = useState(false);
  if (id && !broken) {
    return <img src={imgUrl(id)} alt={product.name} loading="lazy" onError={() => setBroken(true)} className={`object-contain ${className}`} />;
  }
  return (
    <div className={`flex flex-col items-center justify-center bg-gradient-to-br from-[#EEF1F7] to-[#DCE2EE] text-center ${className}`}>
      <span className="font-display text-2xl font-extrabold uppercase tracking-wide text-[#0B1B3A]/30">{product.brand || 'Item'}</span>
      <span className="mt-1 text-[11px] font-medium text-[#0B1B3A]/40">{product.size || product.model}</span>
    </div>
  );
}

const STOCK = {
  in_stock: ['In stock', 'text-emerald-700 bg-emerald-50'],
  low: ['Only a few left', 'text-amber-800 bg-amber-50'],
  on_request: ['Available on request', 'text-sky-800 bg-sky-50'],
  out: ['Out of stock', 'text-slate-600 bg-slate-100'],
};
export function StockPill({ status }) {
  const [label, cls] = STOCK[status] || STOCK.in_stock;
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${cls}`}>{label}</span>;
}

export function ProductCard({ p, currency }) {
  const cart = useCart();
  const out = p.stock_status === 'out';
  return (
    <div className="group flex flex-col overflow-hidden rounded-2xl bg-white shadow-[0_1px_2px_rgba(11,27,58,.06),0_8px_24px_-12px_rgba(11,27,58,.18)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_32px_-12px_rgba(11,27,58,.35)]">
      <Link to={`/product/${p.id}`} className="relative block aspect-[4/3] bg-white p-3">
        <ProductImage product={p} className="h-full w-full" />
        {p.on_sale && (
          <span className="absolute left-3 top-3 rounded-full px-2.5 py-1 font-display text-xs font-extrabold text-white" style={{ background: EMBER }}>
            -{p.discount_percent}%
          </span>
        )}
      </Link>
      <div className="flex flex-1 flex-col gap-1.5 px-4 pb-4">
        <span className="text-[11px] font-bold uppercase tracking-wider text-[#0B1B3A]/50">{p.brand}{p.size ? ` · ${p.size}` : ''}</span>
        <Link to={`/product/${p.id}`} className="line-clamp-2 min-h-[2.6rem] text-sm font-semibold leading-snug text-[#0B1B3A] hover:underline">{p.name}</Link>
        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <div>
            {p.on_sale && <div className="text-xs text-slate-400 line-through">{money(p.retail_price, currency)}</div>}
            <div className="font-display text-lg font-extrabold leading-none" style={{ color: p.on_sale ? EMBER : NAVY }}>{money(p.price, currency)}</div>
          </div>
          <button
            type="button"
            disabled={out}
            onClick={() => cart.add(p)}
            className="rounded-xl bg-[#0B1B3A] px-3.5 py-2 text-xs font-bold text-white transition hover:bg-[#E8472B] disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {out ? 'Sold out' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Spinner() {
  return <div className="py-24 text-center text-sm text-slate-500">Loading…</div>;
}
