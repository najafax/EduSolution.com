import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const CartContext = createContext(null);
const KEY = 'edusolution_shop_cart';

function load() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// Cart lines keep a snapshot (name, price, picture) for display only; the
// server prices every order from its own live catalogue.
export function CartProvider({ children }) {
  const [lines, setLines] = useState(load);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(lines));
    } catch {
      /* private mode: cart just won't persist */
    }
  }, [lines]);

  const value = useMemo(() => ({
    lines,
    open,
    setOpen,
    count: lines.reduce((s, l) => s + l.qty, 0),
    total: lines.reduce((s, l) => s + l.qty * l.price, 0),
    add(p, qty = 1) {
      setLines((cur) => {
        const found = cur.find((l) => l.id === p.id);
        if (found) return cur.map((l) => (l.id === p.id ? { ...l, qty: Math.min(20, l.qty + qty), price: p.price } : l));
        return [...cur, { id: p.id, name: p.name, sku: p.sku, price: p.price, image: p.images?.[0] ?? null, qty }];
      });
      setOpen(true);
    },
    setQty: (id, qty) => setLines((cur) => (qty < 1 ? cur.filter((l) => l.id !== id) : cur.map((l) => (l.id === id ? { ...l, qty: Math.min(20, qty) } : l)))),
    remove: (id) => setLines((cur) => cur.filter((l) => l.id !== id)),
    refresh: (fresh) => setLines((cur) => cur.filter((l) => fresh[l.id]).map((l) => ({ ...l, price: fresh[l.id].price, name: fresh[l.id].name }))),
    clear: () => setLines([]),
  }), [lines, open]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export const useCart = () => useContext(CartContext);
