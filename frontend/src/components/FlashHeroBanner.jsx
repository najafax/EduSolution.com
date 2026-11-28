import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { AD_BG, timeLeft, endsLabel } from './FlashBanner';

const SHOP = 'https://shop.edusolutionsmv.com';
const API = `${import.meta.env.VITE_API_URL || ''}/api/public/shop`;

// Compact animated ad under the homepage hero: flashing badge, pulsing
// "up to X% off" burst, ticking countdown, and a product that changes every
// few seconds. Same banner data as the top strip (Shop → Flash banners).
// Renders nothing when there is no live banner or the shop is unreachable.
export default function FlashHeroBanner() {
  const [promo, setPromo] = useState(null);
  const [items, setItems] = useState([]);
  const [now, setNow] = useState(Date.now());
  const [n, setN] = useState(0);
  useEffect(() => {
    api.publicPromotions().then((r) => setPromo((r.promotions || [])[0] || null)).catch(() => {});
    api.publicShopSale().then((r) => setItems((r.products || []).slice(0, 8))).catch(() => {});
  }, []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (items.length < 2) return undefined;
    const t = setInterval(() => setN((x) => x + 1), 3500);
    return () => clearInterval(t);
  }, [items.length]);
  if (!promo) return null;

  const timer = promo.ends_at ? timeLeft(promo.ends_at, now) : '';
  const best = items.reduce((m, p) => Math.max(m, p.discount_percent || 0), 0);
  const shown = items.length ? [0, 1, 2].map((k) => items[(n + k) % items.length]).filter((p, idx, a) => a.indexOf(p) === idx) : [];
  return (
    <section className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
      <a
        href={`${SHOP}${promo.link_path}`}
        className={`ad-shimmer group relative block rounded-2xl bg-gradient-to-r ${AD_BG[promo.theme] || AD_BG.ember} p-3 text-white shadow-lg sm:p-4`}
      >
        <div className="relative flex flex-wrap items-center gap-x-5 gap-y-3 sm:flex-nowrap">
          {best > 0 && (
            <div className="ad-pulse grid h-16 w-16 shrink-0 place-items-center rounded-full bg-[#FFD43B] text-center font-display leading-none text-slate-900 sm:h-20 sm:w-20">
              <span><span className="block text-[9px] font-extrabold uppercase">up to</span><span className="block text-xl font-extrabold sm:text-2xl">{best}%</span><span className="block text-[9px] font-extrabold uppercase">off</span></span>
            </div>
          )}
          <div className="min-w-0 flex-1 basis-48">
            <span className="ad-flash inline-block rounded bg-white px-2 py-0.5 text-[10px] font-extrabold tracking-widest text-slate-900">⚡ {promo.badge}</span>
            <div className="mt-1 font-display text-lg font-extrabold leading-tight sm:text-2xl">{promo.title}</div>
            {promo.subtitle && <div className="hidden text-sm text-white/85 sm:block">{promo.subtitle}</div>}
            {timer && <div className="ad-tick mt-1 inline-block rounded bg-black/30 px-2 py-0.5 text-xs font-bold tabular-nums sm:text-sm">⏱ Ends in {timer} · {endsLabel(promo.ends_at)}</div>}
          </div>
          {shown.length > 0 && (
            <div className="hidden gap-2 sm:flex">
              {shown.map((p, idx) => (
                <div key={`${p.id}-${n}`} className="ad-pop w-24 shrink-0 rounded-xl bg-white p-1.5 text-slate-900 shadow-md" style={{ animationDelay: `${idx * 90}ms` }}>
                  <div className="relative h-14 overflow-hidden rounded-lg bg-slate-100">
                    {p.images?.[0] ? <img src={`${API}/images/${p.images[0]}`} alt="" className="h-full w-full object-contain" /> : <div className="grid h-full place-items-center text-[10px] font-extrabold uppercase text-slate-400">{p.brand}</div>}
                    <span className="absolute left-1 top-1 rounded-full bg-[#E8472B] px-1 text-[9px] font-extrabold text-white">-{p.discount_percent}%</span>
                  </div>
                  <div className="mt-1 line-clamp-1 text-[10px] font-semibold">{p.name}</div>
                  <div className="font-display text-xs font-extrabold text-[#E8472B]">{p.price.toLocaleString()}</div>
                </div>
              ))}
            </div>
          )}
          <span className="ad-pulse ml-auto shrink-0 rounded-xl bg-white px-4 py-2.5 font-display text-sm font-extrabold text-slate-900 sm:ml-0">
            {promo.cta_label} <span className="ad-arrow">→</span>
          </span>
        </div>
      </a>
    </section>
  );
}
