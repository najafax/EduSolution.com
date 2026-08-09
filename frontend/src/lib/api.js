// In dev, Vite proxies /api to the backend (see vite.config.js).
// In production the frontend and backend are on different origins, so
// VITE_API_URL must point at the deployed backend's base URL.
const BASE_URL = `${import.meta.env.VITE_API_URL || ''}/api`;

async function request(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return {};

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Something went wrong');
  }
  return data;
}

// PDFs aren't JSON, so they need their own fetch (still with the auth header)
// and get opened as an in-browser blob URL rather than a plain <a href>.
async function openPdf(path, token) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to load PDF');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const api = {
  signup: (payload) => request('/auth/signup', { method: 'POST', body: payload }),
  login: (payload) => request('/auth/login', { method: 'POST', body: payload }),
  me: (token) => request('/auth/me', { token }),

  settings: {
    get: (token) => request('/settings', { token }),
    update: (payload, token) => request('/settings', { method: 'PUT', body: payload, token }),
  },

  clients: {
    list: (token, q) => request(`/clients${q ? `?q=${encodeURIComponent(q)}` : ''}`, { token }),
    get: (id, token) => request(`/clients/${id}`, { token }),
    create: (payload, token) => request('/clients', { method: 'POST', body: payload, token }),
    update: (id, payload, token) => request(`/clients/${id}`, { method: 'PUT', body: payload, token }),
    remove: (id, token) => request(`/clients/${id}`, { method: 'DELETE', token }),
  },

  quotes: {
    list: (token, status) => request(`/quotes${status ? `?status=${status}` : ''}`, { token }),
    get: (id, token) => request(`/quotes/${id}`, { token }),
    create: (payload, token) => request('/quotes', { method: 'POST', body: payload, token }),
    update: (id, payload, token) => request(`/quotes/${id}`, { method: 'PUT', body: payload, token }),
    remove: (id, token) => request(`/quotes/${id}`, { method: 'DELETE', token }),
    send: (id, token) => request(`/quotes/${id}/send`, { method: 'POST', token }),
    convertToInvoice: (id, payload, token) =>
      request(`/quotes/${id}/convert-to-invoice`, { method: 'POST', body: payload, token }),
    openPdf: (id, token) => openPdf(`/quotes/${id}/pdf`, token),
  },

  invoices: {
    list: (token, status) => request(`/invoices${status ? `?status=${status}` : ''}`, { token }),
    get: (id, token) => request(`/invoices/${id}`, { token }),
    create: (payload, token) => request('/invoices', { method: 'POST', body: payload, token }),
    update: (id, payload, token) => request(`/invoices/${id}`, { method: 'PUT', body: payload, token }),
    remove: (id, token) => request(`/invoices/${id}`, { method: 'DELETE', token }),
    send: (id, token) => request(`/invoices/${id}/send`, { method: 'POST', token }),
    remind: (id, token) => request(`/invoices/${id}/remind`, { method: 'POST', token }),
    recordPayment: (id, payload, token) =>
      request(`/invoices/${id}/payments`, { method: 'POST', body: payload, token }),
    sendReceipt: (id, paymentId, token) =>
      request(`/invoices/${id}/payments/${paymentId}/send-receipt`, { method: 'POST', token }),
    openPdf: (id, token) => openPdf(`/invoices/${id}/pdf`, token),
    openReceiptPdf: (id, paymentId, token) => openPdf(`/invoices/${id}/payments/${paymentId}/pdf`, token),
  },

  financials: {
    summary: (token) => request('/financials/summary', { token }),
  },
};
