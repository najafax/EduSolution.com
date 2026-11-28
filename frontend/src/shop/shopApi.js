// Public storefront API (no login). Same API host as the staff app.
export const API = `${import.meta.env.VITE_API_URL || ''}/api/public/shop`;

async function get(path) {
  const res = await fetch(`${API}${path}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

export const shopApi = {
  config: () => get('/config'),
  products: (params = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v !== '' && v != null && qs.set(k, v));
    return get(`/products?${qs}`);
  },
  product: (id) => get(`/products/${id}`),
  order: (token) => get(`/orders/${token}`),
  createOrder: async (body) => {
    const res = await fetch(`${API}/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'We could not place your order. Please try again.');
    return data;
  },
};

export const imgUrl = (id) => `${API}/images/${id}`;
export const promoImgUrl = (id) => `${API}/promotions/${id}/image`;
export const heroImgUrl = () => `${API}/hero-image`;

export const money = (n, cur = 'MVR') => `${cur} ${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
