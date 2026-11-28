import { useEffect, useState } from 'react';
import { api } from '../lib/api';

const SHOP = 'https://shop.edusolutionsmv.com';
export const AD_BG = {
  ember: 'from-[#F0592F] to-[#B8260E]',
  ocean: 'from-[#2E86F5] to-[#07357D]',
  forest: 'from-[#1FA46D] to-[#07442B]',
  ink: 'from-[#2A3350] to-[#0A0D18]',
};

// "Ends Sat 12 Dec, 11:59 pm" - the written end date shown next to every countdown.
export function endsLabel(endsAt) {
  const d = new Date(endsAt);
  if (!endsAt || Number.isNaN(d.getTime())) return '';
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true });
  return `Ends ${day}, ${time}`;
}

export function timeLeft(endsAt, now) {
  const ms = new Date(endsAt).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n) => String(n).padStart(2, '0');
  return d > 0 ? `${d}d ${pad(h)}h ${pad(m)}m ${pad(s % 60)}s` : `${pad(h)}:${pad(m)}:${pad(s % 60)}`;
}

// Thin flash-sale ticker across the top of the public marketing site. The
// message scrolls like a real ad strip (pauses on hover), the badge flashes
// and a shine sweeps across. Managed in Shop → Flash banners; silent on any
// failure so the marketing site never depends on the shop.
export default function FlashBanner() {
  const [promos, setPromos] = useState([]);
  const [i, setI] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [hidden, setHidden] = useState(() => {
    try { return sessionStorage.getItem('flash_banner_closed') === '1'; } catch { return false; }
  });
  useEffect(() => { api.publicPromotions().then((r) => setPromos(r.promotions || [])).catch(() => {}); }, []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (promos.length < 2) return undefined;
    const t = setInterval(() => setI((x) => (x + 1) % promos.length), 14000);
    return () => clearInterval(t);
  }, [promos.length]);

  if (hidden || promos.length === 0) return null;
  const p = promos[i % promos.length];
  const timer = p.ends_at ? timeLeft(p.ends_at, now) : '';
  const unit = (key) => (
    <span key={key} className="flex shrink-0 items-center gap-3 pr-10 text-[13px]">
      <span className="ad-flash rounded bg-white px-2 py-0.5 text-[10px] font-extrabold tracking-widest text-slate-900">⚡ {p.badge}</span>
      <b className="font-display font-extrabold">{p.title}</b>
      {p.subtitle && <span className="text-white/85">{p.subtitle}</span>}
      {timer && <span className="ad-tick rounded bg-black/30 px-1.5 py-0.5 font-bold tabular-nums">⏱ {timer} · {endsLabel(p.ends_at)}</span>}
      <span className="font-extrabold underline underline-offset-4">{p.cta_label} <span className="ad-arrow">→</span></span>
      <span className="text-white/40">✦</span>
    </span>
  );
  return (
    <div className={`ad-shimmer relative bg-gradient-to-r ${AD_BG[p.theme] || AD_BG.ember} text-white`}>
      <a href={`${SHOP}${p.link_path}`} className="block overflow-hidden py-1.5 pr-9" aria-label={`${p.badge}: ${p.title}`}>
        <div className="ad-marquee">
          {[0, 1, 2, 3].map((k) => unit(k))}
        </div>
      </a>
      <button
        type="button"
        aria-label="Close banner"
        onClick={() => { setHidden(true); try { sessionStorage.setItem('flash_banner_closed', '1'); } catch { /* ignore */ } }}
        className="absolute right-0 top-0 z-10 h-full bg-black/20 px-3 text-lg leading-none text-white/90 hover:bg-black/40"
      >
        ×
      </button>
    </div>
  );
}
