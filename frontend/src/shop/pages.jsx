import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { shopApi, imgUrl, promoImgUrl, heroImgUrl, money } from './shopApi.js';
import { useCart } from './cart.jsx';
import { useShop } from './ShopApp.jsx';
import { Countdown, ProductCard, ProductImage, Spinner, StockPill, THEMES, EMBER, whatsappLink } from './ui.jsx';

function useProducts(params) {
  const key = JSON.stringify(params);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setError('');
    shopApi.products(params).then((d) => live && setData(d)).catch((e) => live && setError(e.message));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { data, error };
}

function Grid({ products, currency }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 xl:grid-cols-4">
      {products.map((p) => <ProductCard key={p.id} p={p} currency={currency} />)}
    </div>
  );
}

function SectionTitle({ kicker, title, to, linkLabel = 'See all' }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        {kicker && <div className="text-xs font-extrabold uppercase tracking-[0.2em]" style={{ color: EMBER }}>{kicker}</div>}
        <h2 className="font-display text-2xl font-extrabold tracking-tight text-[#0B1B3A] sm:text-3xl">{title}</h2>
      </div>
      {to && <Link to={to} className="shrink-0 text-sm font-bold text-[#0B1B3A] underline underline-offset-4">{linkLabel} →</Link>}
    </div>
  );
}

function PromoBanner({ promo }) {
  return (
    <Link
      to={promo.link_path}
      className={`relative block overflow-hidden rounded-3xl bg-gradient-to-br ${THEMES[promo.theme] || THEMES.ember} p-6 text-white shadow-lg sm:p-9`}
    >
      {promo.has_image && <img src={promoImgUrl(promo.id)} alt="" className="absolute inset-y-0 right-0 h-full w-1/2 object-cover opacity-60 [mask-image:linear-gradient(to_left,black,transparent)]" />}
      <div className="relative max-w-xl">
        <span className="inline-block rounded-full bg-white px-3 py-1 font-display text-xs font-extrabold tracking-widest text-[#0B1B3A]">{promo.badge}</span>
        <h2 className="mt-3 font-display text-3xl font-extrabold leading-tight sm:text-5xl">{promo.title}</h2>
        {promo.subtitle && <p className="mt-2 text-base text-white/85 sm:text-lg">{promo.subtitle}</p>}
        <div className="mt-5 flex flex-wrap items-center gap-4">
          <span className="rounded-xl bg-white px-5 py-3 font-display text-sm font-extrabold text-[#0B1B3A]">{promo.cta_label} →</span>
          {promo.ends_at && (
            <div>
              <div className="mb-1 text-[11px] font-bold uppercase tracking-widest text-white/70">Ends in</div>
              <Countdown endsAt={promo.ends_at} />
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

export function Home() {
  const { settings, categories, promotions } = useShop();
  const cur = settings.currency;
  const sale = useProducts({ sale: '1', sort: 'featured' });
  const featured = useProducts({ featured: '1' });
  const fresh = useProducts({ sort: 'newest' });
  const saleList = sale.data?.products.slice(0, 8) || [];
  const featuredList = featured.data?.products.slice(0, 8) || [];
  const freshList = fresh.data?.products.slice(0, 8) || [];

  return (
    <div>
      <section className="mx-auto max-w-7xl px-4 pt-6">
        <div className="relative overflow-hidden rounded-3xl bg-[#0B1B3A] text-white">
          {settings.has_hero_image && <img src={heroImgUrl()} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" />}
          <div className="absolute -right-20 -top-24 h-72 w-72 rounded-full blur-3xl" style={{ background: `${EMBER}55` }} />
          <div className="relative grid gap-6 px-6 py-14 sm:px-12 sm:py-20 lg:max-w-3xl">
            <span className="w-fit rounded-full border border-white/30 px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] text-white/80">Appliances · Delivered to your island</span>
            <h1 className="font-display text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl">{settings.hero_title}</h1>
            {settings.hero_subtitle && <p className="max-w-xl text-base text-white/80 sm:text-lg">{settings.hero_subtitle}</p>}
            <div className="flex flex-wrap gap-3">
              <Link to="/products" className="rounded-xl px-6 py-3.5 font-display text-sm font-extrabold text-white" style={{ background: EMBER }}>Shop all products</Link>
              <Link to="/sale" className="rounded-xl border border-white/40 px-6 py-3.5 font-display text-sm font-extrabold text-white hover:bg-white/10">See today's deals</Link>
            </div>
          </div>
        </div>
      </section>

      {promotions.length > 0 && (
        <section className="mx-auto mt-6 grid max-w-7xl gap-4 px-4">
          {promotions.slice(0, 2).map((p) => <PromoBanner key={p.id} promo={p} />)}
        </section>
      )}

      <section className="mx-auto mt-6 grid max-w-7xl grid-cols-2 gap-3 px-4 sm:grid-cols-4">
        {[
          ['Boat & island delivery', 'We deliver to the boat or island you choose'],
          ['Genuine warranty', settings.warranty_note || 'Brand warranty on every appliance'],
          ['Pay your way', settings.card_enabled ? 'Cash, bank transfer or card' : 'Cash on delivery or bank transfer'],
          ['Real people', 'Call or WhatsApp us, any time you need help'],
        ].map(([t, d]) => (
          <div key={t} className="rounded-2xl bg-white px-4 py-4 shadow-sm">
            <div className="font-display text-sm font-extrabold text-[#0B1B3A]">{t}</div>
            <div className="mt-1 text-xs leading-relaxed text-slate-500">{d}</div>
          </div>
        ))}
      </section>

      <section className="mx-auto mt-14 max-w-7xl px-4">
        <SectionTitle kicker="Browse" title="Shop by category" />
        <div className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-4">
          {categories.map((c) => (
            <Link key={c.slug} to={`/category/${c.slug}`} className="group relative overflow-hidden rounded-2xl bg-white p-4 shadow-sm transition hover:shadow-lg">
              <div className="aspect-[4/3] overflow-hidden rounded-xl bg-[#F6F1E9]">
                {c.image_id ? <img src={imgUrl(c.image_id)} alt="" loading="lazy" className="h-full w-full object-contain p-2 transition group-hover:scale-105" /> : <div className="grid h-full place-items-center font-display text-3xl font-extrabold text-[#0B1B3A]/20">{c.name[0]}</div>}
              </div>
              <div className="mt-3 font-display text-base font-extrabold text-[#0B1B3A]">{c.name}</div>
              <div className="text-xs text-slate-500">{c.product_count} products</div>
            </Link>
          ))}
        </div>
      </section>

      {saleList.length > 0 && (
        <section className="mx-auto mt-14 max-w-7xl px-4">
          <SectionTitle kicker="Limited time" title="On sale now" to="/sale" />
          <Grid products={saleList} currency={cur} />
        </section>
      )}
      {featuredList.length > 0 && (
        <section className="mx-auto mt-14 max-w-7xl px-4">
          <SectionTitle kicker="Our picks" title="Featured" to="/products?featured=1" />
          <Grid products={featuredList} currency={cur} />
        </section>
      )}
      {freshList.length > 0 && (
        <section className="mx-auto mt-14 max-w-7xl px-4">
          <SectionTitle kicker="Just in" title="New arrivals" to="/products?sort=newest" />
          <Grid products={freshList} currency={cur} />
        </section>
      )}
    </div>
  );
}

const SORTS = [
  ['featured', 'Featured'],
  ['price_asc', 'Price: low to high'],
  ['price_desc', 'Price: high to low'],
  ['newest', 'Newest'],
  ['name', 'Name A–Z'],
];

export function Catalogue({ sale = false }) {
  const { slug } = useParams();
  const { settings, categories } = useShop();
  const [sp, setSp] = useSearchParams();
  const q = sp.get('q') || '';
  const brand = sp.get('brand') || '';
  const sort = sp.get('sort') || 'featured';
  const page = Number(sp.get('page') || 1);
  const featured = sp.get('featured') || '';
  const { data, error } = useProducts({ q, brand, sort, page, category: slug || '', sale: sale ? '1' : '', featured });
  const category = categories.find((c) => c.slug === slug);
  const set = (k, v) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v); else n.delete(k);
    if (k !== 'page') n.delete('page');
    setSp(n);
  };
  const title = sale ? 'Sale' : category ? category.name : q ? `Results for “${q}”` : 'All products';

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6">
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-[#0B1B3A] sm:text-4xl">{title}</h1>
        {category?.description && <p className="mt-1 text-sm text-slate-500">{category.description}</p>}
      </div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        {data?.brands?.length > 1 && (
          <select value={brand} onChange={(e) => set('brand', e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-base">
            <option value="">All brands</option>
            {data.brands.map((b) => { const name = typeof b === 'string' ? b : b.brand; return <option key={name} value={name}>{name}</option>; })}
          </select>
        )}
        <select value={sort} onChange={(e) => set('sort', e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-base">
          {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {q && <button type="button" onClick={() => set('q', '')} className="rounded-full bg-white px-3 py-1.5 text-sm shadow-sm">“{q}” ×</button>}
        {data && <span className="ml-auto text-sm text-slate-500">{data.total} products</span>}
      </div>
      {error && <p className="py-10 text-center text-slate-600">{error}</p>}
      {!data && !error && <Spinner />}
      {data && data.products.length === 0 && <p className="rounded-2xl bg-white py-16 text-center text-slate-500">Nothing matched. Try a different search or <Link to="/products" className="font-bold underline">see everything</Link>.</p>}
      {data && data.products.length > 0 && <Grid products={data.products} currency={settings.currency} />}
      {data && data.totalPages > 1 && (
        <div className="mt-10 flex items-center justify-center gap-3">
          <button type="button" disabled={page <= 1} onClick={() => set('page', String(page - 1))} className="rounded-xl bg-white px-4 py-2 text-sm font-bold shadow-sm disabled:opacity-40">← Previous</button>
          <span className="text-sm text-slate-500">Page {data.page} of {data.totalPages}</span>
          <button type="button" disabled={page >= data.totalPages} onClick={() => set('page', String(page + 1))} className="rounded-xl bg-white px-4 py-2 text-sm font-bold shadow-sm disabled:opacity-40">Next →</button>
        </div>
      )}
    </div>
  );
}

export function ProductPage() {
  const { id } = useParams();
  const { settings } = useShop();
  const cart = useCart();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [img, setImg] = useState(0);
  const [qty, setQty] = useState(1);
  useEffect(() => {
    setData(null); setError(''); setImg(0); setQty(1);
    shopApi.product(id).then(setData).catch((e) => setError(e.message));
  }, [id]);
  useEffect(() => {
    if (data) document.title = `${data.product.name} — ${settings.shop_name}`;
  }, [data, settings.shop_name]);

  if (error) return <div className="mx-auto max-w-xl px-4 py-24 text-center"><p className="text-slate-600">{error}</p><Link to="/products" className="mt-4 inline-block font-bold underline">Back to the shop</Link></div>;
  if (!data) return <Spinner />;
  const p = data.product;
  const cur = settings.currency;
  const out = p.stock_status === 'out';
  const wa = whatsappLink(settings.whatsapp, `Hi, I have a question about ${p.name} (${p.sku}).`);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <nav className="mb-5 text-xs text-slate-500">
        <Link to="/" className="hover:underline">Home</Link> / {p.category_slug && <><Link to={`/category/${p.category_slug}`} className="hover:underline">{p.category_name}</Link> / </>}<span className="text-slate-700">{p.name}</span>
      </nav>
      <div className="grid gap-8 lg:grid-cols-2">
        <div>
          <div className="relative aspect-square overflow-hidden rounded-3xl bg-white p-6 shadow-sm">
            <ProductImage product={p} index={img} className="h-full w-full" />
            {p.on_sale && <span className="absolute left-5 top-5 rounded-full px-3 py-1.5 font-display text-sm font-extrabold text-white" style={{ background: EMBER }}>-{p.discount_percent}%</span>}
          </div>
          {p.images.length > 1 && (
            <div className="mt-3 flex gap-2 overflow-x-auto">
              {p.images.map((iid, i) => (
                <button key={iid} type="button" onClick={() => setImg(i)} className={`h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-white p-1 ring-2 ${i === img ? 'ring-[#0B1B3A]' : 'ring-transparent'}`}>
                  <img src={imgUrl(iid)} alt="" className="h-full w-full object-contain" />
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          <div className="text-xs font-extrabold uppercase tracking-[0.2em] text-slate-500">{p.brand}{p.group_label ? ` · ${p.group_label}` : ''}</div>
          <h1 className="mt-1 font-display text-3xl font-extrabold leading-tight tracking-tight text-[#0B1B3A] sm:text-4xl">{p.name}</h1>
          <div className="mt-1 text-sm text-slate-500">SKU {p.sku}{p.model ? ` · Model ${p.model}` : ''}{p.size ? ` · ${p.size}` : ''}</div>
          <div className="mt-5 flex flex-wrap items-end gap-3">
            <div className="font-display text-4xl font-extrabold" style={{ color: p.on_sale ? EMBER : '#0B1B3A' }}>{money(p.price, cur)}</div>
            {p.on_sale && <div className="pb-1 text-lg text-slate-400 line-through">{money(p.retail_price, cur)}</div>}
          </div>
          {p.on_sale && p.sale_ends_at && (
            <div className="mt-3 inline-flex flex-col rounded-2xl bg-[#0B1B3A] px-4 py-3 text-white">
              <span className="mb-1 text-[11px] font-bold uppercase tracking-widest text-white/60">Sale ends in</span>
              <Countdown endsAt={p.sale_ends_at} />
            </div>
          )}
          <div className="mt-4"><StockPill status={p.stock_status} /></div>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <div className="flex items-center rounded-xl border border-slate-200 bg-white">
              <button type="button" className="h-12 w-11 text-xl" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Less">−</button>
              <span className="w-8 text-center font-bold">{qty}</span>
              <button type="button" className="h-12 w-11 text-xl" onClick={() => setQty((q) => Math.min(20, q + 1))} aria-label="More">+</button>
            </div>
            <button type="button" disabled={out} onClick={() => cart.add(p, qty)} className="h-12 flex-1 rounded-xl px-6 font-display text-base font-extrabold text-white transition hover:brightness-110 disabled:bg-slate-300" style={{ background: out ? undefined : EMBER }}>
              {out ? 'Out of stock' : 'Add to cart'}
            </button>
            <button type="button" disabled={out} onClick={() => { cart.add(p, qty); cart.setOpen(false); nav('/checkout'); }} className="h-12 rounded-xl bg-[#0B1B3A] px-6 font-display text-base font-extrabold text-white disabled:bg-slate-300">Buy now</button>
          </div>
          {wa && <a href={wa} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm font-bold text-emerald-700 underline underline-offset-4">Ask a question on WhatsApp</a>}
          {p.highlights.length > 0 && (
            <ul className="mt-7 space-y-2 text-sm text-slate-700">
              {p.highlights.map((h) => <li key={h} className="flex gap-2"><span style={{ color: EMBER }}>●</span>{h}</li>)}
            </ul>
          )}
          {p.description && <p className="mt-6 whitespace-pre-line text-sm leading-relaxed text-slate-700">{p.description}</p>}
          <div className="mt-7 grid gap-3 rounded-2xl bg-white p-4 text-sm text-slate-600 shadow-sm">
            <div><b className="text-[#0B1B3A]">Delivery.</b> {settings.delivery_note}</div>
            <div><b className="text-[#0B1B3A]">Warranty.</b> {p.warranty_note || settings.warranty_note || 'Covered by the manufacturer warranty.'}</div>
          </div>
        </div>
      </div>
      {data.related.length > 0 && (
        <section className="mt-16">
          <SectionTitle title="You might also like" />
          <Grid products={data.related} currency={cur} />
        </section>
      )}
    </div>
  );
}

export function Terms() {
  const { settings } = useShop();
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="font-display text-3xl font-extrabold text-[#0B1B3A]">Terms of sale</h1>
      <p className="mt-6 whitespace-pre-line text-sm leading-relaxed text-slate-700">{settings.terms || 'Orders are confirmed by our team before dispatch. Delivery charges, if any, are agreed with you before the order leaves us. Please contact us for anything you are unsure about.'}</p>
    </div>
  );
}
