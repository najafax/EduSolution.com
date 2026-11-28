import { useEffect, useState } from 'react';
import { api } from '../lib/api';

const SHOP = 'https://shop.edusolutionsmv.com';
const API = `${import.meta.env.VITE_API_URL || ''}/api/public/shop`;
const BG = {
  ember: 'from-[#F0592F] via-[#E8472B] to-[#B8260E]',
  ocean: 'from-[#2E86F5] via-[#0B5FD6] to-[#07357D]',
  forest: 'from-[#1FA46D] via-[#0F7B4E] to-[#07442B]',
  ink: 'from-[#2A3350] via-[#161C30] to-[#0A0D18]',
};

function parts(endsAt, now) {
  const ms = new Date(endsAt).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const s = Math.floor(ms / 1000);
  return [[Math.floor(s / 86400), 'd'], [Math.floor((s % 86400) / 3600), 'h'], [Math.floor((s % 3600) / 60), 'm'], [s % 60, 's']];
}

// Large flash-sale card on the public homepage, under the hero. Same data as
// the top strip (Shop → Flash banners), plus up to three on-sale products.
// Renders nothing when there is no live banner or the shop is unreachable.
export default function FlashHeroBanner() {
  const [promo, setPromo] = useState(null);
  const [items, setItems] = useState([]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    api.publicPromotions().then((r) => setPromo((r.promotions || [])[0] || null)).catch(() => {});
    api.publicShopSale().then((r) => setItems((r.products || []).slice(0, 3))).catch(() => {});
  }, []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!promo) return null;
  const timer = promo.ends_at ? parts(promo.ends_at, now) : null;
  return (
    <section className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
      <div className={`relative overflow-hidden rounded-3xl bg-gradient-to-br ${BG[promo.theme] || BG.ember} text-white shadow-lg`}>
        {promo.has_image && <img src={`${API}/promotions/${promo.id}/image`} alt="" className="absolute inset-y-0 right-0 hidden h-full w-1/2 object-cover opacity-40 [mask-image:linear-gradient(to_left,black,transparent)] md:block" />}
        <div className="relative grid gap-8 p-6 sm:p-10 lg:grid-cols-[1.1fr_1fr] lg:items-center">
          <div>
            <span className="inline-block rounded-full bg-white px-3 py-1 font-display text-xs font-extrabold tracking-widest text-slate-900">{promo.badge}</span>
            <h2 className="mt-3 font-display text-3xl font-extrabold leading-tight sm:text-5xl">{promo.title}</h2>
            {promo.subtitle && <p className="mt-2 text-base text-white/85 sm:text-lg">{promo.subtitle}</p>}
            <div className="mt-6 flex flex-wrap items-center gap-5">
              <a href={`${SHOP}${promo.link_path}`} className="rounded-xl bg-white px-6 py-3.5 font-display text-sm font-extrabold text-slate-900 hover:bg-slate-100">{promo.cta_label} →</a>
              {timer && (
                <div>
                  <div className="mb-1 text-[11px] font-bold uppercase tracking-widest text-white/70">Ends in</div>
                  <div className="flex gap-1.5">
                    {timer.map(([v, l]) => (
                      <span key={l} className="min-w-[2.6rem] rounded-lg bg-black/30 px-2 py-1 text-center font-display text-lg font-extrabold tabular-nums leading-none">
                        {String(v).padStart(2, '0')}<span className="ml-0.5 text-[10px] font-semibold uppercase opacity-70">{l}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          {items.length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              {items.map((p) => (
                <a key={p.id} href={`${SHOP}/product/${p.id}`} className="flex flex-col overflow-hidden rounded-2xl bg-white p-2.5 text-slate-900 shadow-md transition hover:-translate-y-0.5">
                  <div className="relative aspect-square overflow-hidden rounded-xl bg-slate-100">
                    {p.images?.[0]
                      ? <img src={`${API}/images/${p.images[0]}`} alt={p.name} loading="lazy" className="h-full w-full object-contain" />
                      : <div className="grid h-full place-items-center px-1 text-center font-display text-sm font-extrabold uppercase text-slate-400">{p.brand}</div>}
                    <span className="absolute left-1.5 top-1.5 rounded-full bg-[#E8472B] px-1.5 py-0.5 text-[10px] font-extrabold text-white">-{p.discount_percent}%</span>
                  </div>
                  <div className="mt-2 line-clamp-2 min-h-[2rem] text-[11px] font-semibold leading-tight sm:text-xs">{p.name}</div>
                  <div className="mt-1 font-display text-sm font-extrabold text-[#E8472B]">{p.price.toLocaleString()}</div>
                  <div className="text-[10px] text-slate-400 line-through">{p.retail_price.toLocaleString()}</div>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
