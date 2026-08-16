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

// Builds a `?a=1&b=2` query string from a params object, skipping
// null/undefined/empty-string values — shared by every paginated/searchable
// list endpoint so each one doesn't hand-roll its own conditional string.
function qs(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, value);
  }
  const str = search.toString();
  return str ? `?${str}` : '';
}

// CSV (and similar) exports: force a real download via a throwaway <a>,
// rather than opening in a tab like PDFs do.
async function downloadFile(path, token, filename) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to download file');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const api = {
  login: (payload) => request('/auth/login', { method: 'POST', body: payload }),
  me: (token) => request('/auth/me', { token }),
  forgotPassword: (email) => request('/auth/forgot-password', { method: 'POST', body: { email } }),
  resetPassword: (token, password) => request('/auth/reset-password', { method: 'POST', body: { token, password } }),
  updateMe: (payload, token) => request('/auth/me', { method: 'PUT', body: payload, token }),
  changePassword: (payload, token) => request('/auth/change-password', { method: 'POST', body: payload, token }),
  updatePreferences: (payload, token) => request('/auth/preferences', { method: 'PUT', body: payload, token }),

  settings: {
    get: (token) => request('/settings', { token }),
    update: (payload, token) => request('/settings', { method: 'PUT', body: payload, token }),
  },

  clients: {
    list: (token, { q, page } = {}) => request(`/clients${qs({ q, page })}`, { token }),
    get: (id, token) => request(`/clients/${id}`, { token }),
    create: (payload, token) => request('/clients', { method: 'POST', body: payload, token }),
    update: (id, payload, token) => request(`/clients/${id}`, { method: 'PUT', body: payload, token }),
    remove: (id, token) => request(`/clients/${id}`, { method: 'DELETE', token }),
    exportCsv: (token) => downloadFile('/clients/export.csv', token, 'clients.csv'),
  },

  products: {
    list: (token, { q, page } = {}) => request(`/products${qs({ q, page })}`, { token }),
    create: (payload, token) => request('/products', { method: 'POST', body: payload, token }),
    update: (id, payload, token) => request(`/products/${id}`, { method: 'PUT', body: payload, token }),
    remove: (id, token) => request(`/products/${id}`, { method: 'DELETE', token }),
  },

  quotes: {
    list: (token, { status, q, page } = {}) => request(`/quotes${qs({ status, q, page })}`, { token }),
    get: (id, token) => request(`/quotes/${id}`, { token }),
    create: (payload, token) => request('/quotes', { method: 'POST', body: payload, token }),
    update: (id, payload, token) => request(`/quotes/${id}`, { method: 'PUT', body: payload, token }),
    remove: (id, token) => request(`/quotes/${id}`, { method: 'DELETE', token }),
    sendPreview: (id, token) => request(`/quotes/${id}/send-preview`, { token }),
    send: (id, payload, token) => request(`/quotes/${id}/send`, { method: 'POST', body: payload, token }),
    convertToInvoice: (id, payload, token) =>
      request(`/quotes/${id}/convert-to-invoice`, { method: 'POST', body: payload, token }),
    duplicate: (id, token) => request(`/quotes/${id}/duplicate`, { method: 'POST', token }),
    openPdf: (id, token) => openPdf(`/quotes/${id}/pdf`, token),
    exportCsv: (token) => downloadFile('/quotes/export.csv', token, 'quotes.csv'),
  },

  invoices: {
    list: (token, { status, q, page } = {}) => request(`/invoices${qs({ status, q, page })}`, { token }),
    get: (id, token) => request(`/invoices/${id}`, { token }),
    create: (payload, token) => request('/invoices', { method: 'POST', body: payload, token }),
    update: (id, payload, token) => request(`/invoices/${id}`, { method: 'PUT', body: payload, token }),
    remove: (id, token) => request(`/invoices/${id}`, { method: 'DELETE', token }),
    sendPreview: (id, token) => request(`/invoices/${id}/send-preview`, { token }),
    send: (id, payload, token) => request(`/invoices/${id}/send`, { method: 'POST', body: payload, token }),
    remindPreview: (id, token) => request(`/invoices/${id}/remind-preview`, { token }),
    remind: (id, payload, token) => request(`/invoices/${id}/remind`, { method: 'POST', body: payload, token }),
    duplicate: (id, token) => request(`/invoices/${id}/duplicate`, { method: 'POST', token }),
    void: (id, token) => request(`/invoices/${id}/void`, { method: 'POST', token }),
    recordPayment: (id, payload, token) =>
      request(`/invoices/${id}/payments`, { method: 'POST', body: payload, token }),
    receiptPreview: (id, paymentId, token) =>
      request(`/invoices/${id}/payments/${paymentId}/receipt-preview`, { token }),
    sendReceipt: (id, paymentId, payload, token) =>
      request(`/invoices/${id}/payments/${paymentId}/send-receipt`, { method: 'POST', body: payload, token }),
    openPdf: (id, token) => openPdf(`/invoices/${id}/pdf`, token),
    openReceiptPdf: (id, paymentId, token) => openPdf(`/invoices/${id}/payments/${paymentId}/pdf`, token),
    exportCsv: (token) => downloadFile('/invoices/export.csv', token, 'invoices.csv'),
  },

  expenses: {
    list: (token, { q, page } = {}) => request(`/expenses${qs({ q, page })}`, { token }),
    create: (payload, token) => request('/expenses', { method: 'POST', body: payload, token }),
    update: (id, payload, token) => request(`/expenses/${id}`, { method: 'PUT', body: payload, token }),
    remove: (id, token) => request(`/expenses/${id}`, { method: 'DELETE', token }),
    exportCsv: (token) => downloadFile('/expenses/export.csv', token, 'expenses.csv'),
  },

  recurringInvoices: {
    list: (token, { q, page } = {}) => request(`/recurring-invoices${qs({ q, page })}`, { token }),
    get: (id, token) => request(`/recurring-invoices/${id}`, { token }),
    create: (payload, token) => request('/recurring-invoices', { method: 'POST', body: payload, token }),
    update: (id, payload, token) => request(`/recurring-invoices/${id}`, { method: 'PUT', body: payload, token }),
    remove: (id, token) => request(`/recurring-invoices/${id}`, { method: 'DELETE', token }),
  },

  licenses: {
    list: (token, { q, status, page } = {}) => request(`/licenses${qs({ q, status, page })}`, { token }),
    summary: (token) => request('/licenses/summary', { token }),
    get: (id, token) => request(`/licenses/${id}`, { token }),
    create: (payload, token) => request('/licenses', { method: 'POST', body: payload, token }),
    update: (id, payload, token) => request(`/licenses/${id}`, { method: 'PUT', body: payload, token }),
    remove: (id, token) => request(`/licenses/${id}`, { method: 'DELETE', token }),
    renew: (id, token) => request(`/licenses/${id}/renew`, { method: 'POST', token }),
    remindPreview: (id, token) => request(`/licenses/${id}/remind-preview`, { token }),
    remind: (id, payload, token) => request(`/licenses/${id}/remind`, { method: 'POST', body: payload, token }),
    exportCsv: (token) => downloadFile('/licenses/export.csv', token, 'licenses.csv'),
  },

  activity: {
    list: (token, page = 1) => request(`/activity?page=${page}`, { token }),
  },

  search: {
    query: (token, q) => request(`/search?q=${encodeURIComponent(q)}`, { token }),
  },

  financials: {
    summary: (token) => request('/financials/summary', { token }),
  },

  import: {
    run: (type, csv, commit, token) => request(`/import/${type}`, { method: 'POST', body: { csv, commit }, token }),
  },

  dataReset: {
    run: (confirm, categories, token) => request('/data-reset', { method: 'POST', body: { confirm, categories }, token }),
  },

  reports: {
    salesPdf: (from, to, token) => openPdf(`/reports/sales/pdf${qs({ from, to })}`, token),
    taxPdf: (from, to, token) => openPdf(`/reports/tax/pdf${qs({ from, to })}`, token),
    expensesPdf: (from, to, token) => openPdf(`/reports/expenses/pdf${qs({ from, to })}`, token),
    profitLossPdf: (from, to, token) => openPdf(`/reports/profit-loss/pdf${qs({ from, to })}`, token),
  },

  emailCenter: {
    templates: (token) => request('/email-center/templates', { token }),
    updateTemplate: (type, payload, token) =>
      request(`/email-center/templates/${type}`, { method: 'PUT', body: payload, token }),
    resetTemplate: (type, token) => request(`/email-center/templates/${type}/reset`, { method: 'POST', token }),
    log: (token, page = 1) => request(`/email-center/log?page=${page}`, { token }),
  },

  users: {
    list: (token, { q, page } = {}) => request(`/users${qs({ q, page })}`, { token }),
    get: (id, token) => request(`/users/${id}`, { token }),
    create: (payload, token) => request('/users', { method: 'POST', body: payload, token }),
    update: (id, payload, token) => request(`/users/${id}`, { method: 'PUT', body: payload, token }),
    resetPassword: (id, password, token) =>
      request(`/users/${id}/reset-password`, { method: 'POST', body: { password }, token }),
    remove: (id, token) => request(`/users/${id}`, { method: 'DELETE', token }),
    modules: (token) => request('/users/meta/modules', { token }),
  },

  // Unauthenticated — client-facing quote/invoice links, no bearer token.
  public: {
    getQuote: (publicToken) => request(`/public/quotes/${publicToken}`),
    respondQuote: (publicToken, response) =>
      request(`/public/quotes/${publicToken}/respond`, { method: 'POST', body: { response } }),
    getInvoice: (publicToken) => request(`/public/invoices/${publicToken}`),
    openQuotePdf: (publicToken) => openPdf(`/public/quotes/${publicToken}/pdf`),
    openInvoicePdf: (publicToken) => openPdf(`/public/invoices/${publicToken}/pdf`),
  },
};
