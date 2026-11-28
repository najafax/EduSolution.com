import { createContext, useContext, useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { shopApi, imgUrl, money } from './shopApi.js';
import { CartProvider, useCart } from './cart.jsx';
import { ProductImage, Spinner, whatsappLink, EMBER } from './ui.jsx';
import { Home, Catalogue, ProductPage, Terms } from './pages.jsx';
import { Checkout, OrderPage } from './checkout.jsx';

const ShopContext = createContext(null);
export const useShop = () => useContext(ShopContext);

function CartDrawer() {
  const cart = useCart();
  const { settings } = useShop();
  const nav = useNavigate();
  if (!cart.open) return null;
  const cur = settings.currency;
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-label="Your cart">
      <button type="button" aria-label="Close cart" className="absolute inset-0 bg-[#0B1B3A]/60 backdrop-blur-sm" onClick={() => cart.setOpen(false)} />
      <div className="relative flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="font-display text-xl font-extrabold text-[#0B1B3A]">Your cart ({cart.count})</h2>
          <button type="button" onClick={() => cart.setOpen(false)} className="rounded-lg px-2 py-1 text-2xl leading-none text-slate-500 hover:bg-slate-100" aria-label="Close">×</button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {cart.lines.length === 0 && <p className="py-16 text-center text-sm text-slate-500">Your cart is empty. Find something you like and add it.</p>}
          {cart.lines.map((l) => (
            <div key={l.id} className="flex gap-3 rounded-xl border border-slate-100 p-2.5">
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-white">
                <ProductImage product={{ images: l.image ? [l.image] : [], name: l.name }} className="h-full w-full" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm font-semibold text-[#0B1B3A]">{l.name}</p>
                <p className="text-xs text-slate-500">{money(l.price, cur)}</p>
                <div className="mt-1 flex items-center gap-2">
                  <button type="button" className="h-6 w-6 rounded-md border border-slate-200 text-sm" onClick={() => cart.setQty(l.id, l.qty - 1)} aria-label="Less">−</button>
                  <span className="w-5 text-center text-sm font-bold">{l.qty}</span>
                  <button type="button" className="h-6 w-6 rounded-md border border-slate-200 text-sm" onClick={() => cart.setQty(l.id, l.qty + 1)} aria-label="More">+</button>
                  <button type="button" className="ml-auto text-xs text-slate-400 hover:text-red-600" onClick={() => cart.remove(l.id)}>Remove</button>
                </div>
              </div>
            </div>
          ))}
        </div>
        {cart.lines.length > 0 && (
          <div className="border-t border-slate-100 px-5 py-4">
            <div className="mb-3 flex items-baseline justify-between">
              <span className="text-sm text-slate-600">Subtotal</span>
              <span className="font-display text-2xl font-extrabold text-[#0B1B3A]">{money(cart.total, cur)}</span>
            </div>
            <p className="mb-3 text-xs text-slate-500">Delivery to your island or boat is arranged after you order.</p>
            <button
              type="button"
              onClick={() => { cart.setOpen(false); nav('/checkout'); }}
              className="w-full rounded-xl py-3.5 font-display text-base font-extrabold text-white transition hover:brightness-110"
              style={{ background: EMBER }}
            >
              Checkout
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Header() {
  const { settings, categories } = useShop();
  const cart = useCart();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const wa = whatsappLink(settings.whatsapp);
  return (
    <header className="sticky top-0 z-40 bg-white/95 shadow-sm backdrop-blur">
      {settings.announcement && (
        <div className="bg-[#0B1B3A] px-4 py-1.5 text-center text-xs font-semibold tracking-wide text-white">{settings.announcement}</div>
      )}
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:gap-6">
        <Link to="/" className="shrink-0 font-display text-xl font-extrabold tracking-tight text-[#0B1B3A] sm:text-2xl">
          {settings.shop_name}<span style={{ color: EMBER }}>.</span>
        </Link>
        <form
          className="hidden flex-1 sm:block"
          onSubmit={(e) => { e.preventDefault(); nav(`/products?q=${encodeURIComponent(q)}`); }}
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            type="search"
            placeholder="Search air conditioners, TVs, fridges…"
            className="w-full rounded-full border border-slate-200 bg-[#F6F1E9]/60 px-5 py-2.5 text-base outline-none focus:border-[#0B1B3A]"
          />
        </form>
        <div className="ml-auto flex items-center gap-2 sm:ml-0">
          {wa && (
            <a href={wa} target="_blank" rel="noreferrer" className="hidden rounded-full border border-emerald-600 px-4 py-2 text-sm font-bold text-emerald-700 hover:bg-emerald-50 md:block">
              WhatsApp us
            </a>
          )}
          <button
            type="button"
            onClick={() => cart.setOpen(true)}
            className="relative flex items-center gap-2 rounded-full bg-[#0B1B3A] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#16295a]"
            aria-label="Open cart"
          >
            Cart
            <span className="grid h-5 min-w-[1.25rem] place-items-center rounded-full px-1 text-xs font-extrabold text-white" style={{ background: EMBER }}>{cart.count}</span>
          </button>
        </div>
      </div>
      <form className="px-4 pb-3 sm:hidden" onSubmit={(e) => { e.preventDefault(); nav(`/products?q=${encodeURIComponent(q)}`); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} type="search" placeholder="Search products" className="w-full rounded-full border border-slate-200 bg-[#F6F1E9]/60 px-5 py-2.5 text-base outline-none" />
      </form>
      <nav className="border-t border-slate-100">
        <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 py-2 text-sm font-semibold [scrollbar-width:none]">
          <NavLink to="/sale" className="shrink-0 rounded-full px-3.5 py-1.5 font-extrabold text-white" style={{ background: EMBER }}>% Sale</NavLink>
          {categories.map((c) => (
            <NavLink
              key={c.slug}
              to={`/category/${c.slug}`}
              className={({ isActive }) => `shrink-0 rounded-full px-3.5 py-1.5 transition ${isActive ? 'bg-[#0B1B3A] text-white' : 'text-[#0B1B3A] hover:bg-slate-100'}`}
            >
              {c.name}
            </NavLink>
          ))}
        </div>
      </nav>
    </header>
  );
}

function Footer() {
  const { settings } = useShop();
  const wa = whatsappLink(settings.whatsapp);
  return (
    <footer className="mt-20 bg-[#0B1B3A] text-white">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:grid-cols-3">
        <div>
          <div className="font-display text-2xl font-extrabold">{settings.shop_name}<span style={{ color: EMBER }}>.</span></div>
          <p className="mt-3 max-w-xs text-sm text-white/70">{settings.tagline}</p>
        </div>
        <div className="text-sm text-white/80">
          <div className="mb-3 font-display text-sm font-extrabold uppercase tracking-widest text-white">Delivery & warranty</div>
          <p>{settings.delivery_note}</p>
          {settings.warranty_note && <p className="mt-2">{settings.warranty_note}</p>}
          <Link to="/terms" className="mt-3 inline-block underline underline-offset-4">Terms of sale</Link>
        </div>
        <div className="text-sm text-white/80">
          <div className="mb-3 font-display text-sm font-extrabold uppercase tracking-widest text-white">Talk to us</div>
          {settings.phone && <p>Call <a className="font-semibold text-white" href={`tel:${settings.phone}`}>{settings.phone}</a></p>}
          {wa && <p className="mt-1"><a className="font-semibold text-white underline underline-offset-4" href={wa} target="_blank" rel="noreferrer">Chat on WhatsApp</a></p>}
          {settings.email && <p className="mt-1"><a className="font-semibold text-white" href={`mailto:${settings.email}`}>{settings.email}</a></p>}
        </div>
      </div>
      <div className="border-t border-white/10 py-4 text-center text-xs text-white/50">© {new Date().getFullYear()} Edu Solutions Pvt Ltd. All rights reserved.</div>
    </footer>
  );
}

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

export default function ShopApp() {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    shopApi.config().then(setState).catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (state) document.title = `${state.settings.shop_name} — ${state.settings.tagline || 'Appliances delivered to your island'}`;
  }, [state]);

  if (error) return <div className="p-16 text-center text-slate-600">The shop could not load: {error}</div>;
  if (!state) return <Spinner />;
  return (
    <ShopContext.Provider value={state}>
      <CartProvider>
        <div className="min-h-screen bg-[#F6F1E9] font-sans text-slate-800">
          <ScrollTop />
          <Header />
          <main>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/products" element={<Catalogue />} />
              <Route path="/category/:slug" element={<Catalogue />} />
              <Route path="/sale" element={<Catalogue sale />} />
              <Route path="/product/:id" element={<ProductPage />} />
              <Route path="/checkout" element={<Checkout />} />
              <Route path="/order/:token" element={<OrderPage />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="*" element={<Home />} />
            </Routes>
          </main>
          <Footer />
          <CartDrawer />
        </div>
      </CartProvider>
    </ShopContext.Provider>
  );
}

export { imgUrl };
