import { useEffect, useState } from 'react';
import { api } from '../lib/api';

const SHOP = 'https://shop.edusolutionsmv.com';
const BG = {
  ember: 'from-[#F0592F] to-[#B8260E]',
  ocean: 'from-[#2E86F5] to-[#07357D]',
  forest: 'from-[#1FA46D] to-[#07442B]',
  ink: 'from-[#2A3350] to-[#0A0D18]',
};

function left(endsAt, now) {
  const ms = new Date(endsAt).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h left` : `${h}h ${String(m).padStart(2, '0')}m ${String(s % 60).padStart(2, '0')}s left`;
}

// Flash-sale strip at the very top of the public marketing site. Content is
// managed in Shop → Flash banners; clicking goes to shop.edusolutionsmv.com.
// Silent on any failure so the marketing site never depends on the shop.
export default function FlashBanner() {
  const [promos, setPromos] = useState([]);
  const [i, setI] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [hidden, setHidden] = useState(() => {
    try { return sessionStorage.getItem('flash_banner_closed') === '1'; } catch { return false; }
  });
  useEffect(() => {
    api.publicPromotions().then((r) => setPromos(r.promotions || [])).catch(() => {});
  }, []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (promos.length < 2) return undefined;
    const t = setInterval(() => setI((x) => (x + 1) % promos.length), 6000);
    return () => clearInterval(t);
  }, [promos.length]);

  if (hidden || promos.length === 0) return null;
  const p = promos[i % promos.length];
  const timer = p.ends_at ? left(p.ends_at, now) : '';
  return (
    <div className={`relative bg-gradient-to-r ${BG[p.theme] || BG.ember} text-white`}>
      <a href={`${SHOP}${p.link_path}`} className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-10 py-2.5 text-center text-sm">
        <span className="rounded-full bg-white px-2.5 py-0.5 text-[11px] font-extrabold tracking-widest text-slate-900">{p.badge}</span>
        <span className="font-display font-extrabold">{p.title}</span>
        {p.subtitle && <span className="hidden text-white/85 md:inline">{p.subtitle}</span>}
        {timer && <span className="rounded-md bg-black/25 px-2 py-0.5 font-semibold tabular-nums">{timer}</span>}
        <span className="font-bold underline underline-offset-4">{p.cta_label} →</span>
      </a>
      <button
        type="button"
        aria-label="Close banner"
        onClick={() => { setHidden(true); try { sessionStorage.setItem('flash_banner_closed', '1'); } catch { /* ignore */ } }}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 text-xl leading-none text-white/80 hover:text-white"
      >
        ×
      </button>
    </div>
  );
}
