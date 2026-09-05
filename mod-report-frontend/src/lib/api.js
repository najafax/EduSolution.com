// In dev, Vite proxies /api to the backend (see vite.config.js). In
// production the frontend and backend are on different origins, so
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

// PDFs aren't JSON, so they need their own fetch (still with the auth
// header) and get opened as an in-browser blob URL rather than a plain
// <a href>.
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
  login: (payload) => request('/auth/login', { method: 'POST', body: payload }),
  me: (token) => request('/auth/me', { token }),

  modReports: {
    meta: (token) => request('/mod-reports/meta', { token }),
    list: (token, page = 1) => request(`/mod-reports?page=${page}`, { token }),
    get: (id, token) => request(`/mod-reports/${id}`, { token }),
    create: (payload, token) => request('/mod-reports', { method: 'POST', body: payload, token }),
    update: (id, payload, token) => request(`/mod-reports/${id}`, { method: 'PUT', body: payload, token }),
    remove: (id, token) => request(`/mod-reports/${id}`, { method: 'DELETE', token }),
    openPdf: (id, token) => openPdf(`/mod-reports/${id}/pdf`, token),
    getSettings: (token) => request('/mod-reports/settings', { token }),
    updateSettings: (payload, token) => request('/mod-reports/settings', { method: 'PUT', body: payload, token }),
    regeneratePublicLink: (token) => request('/mod-reports/settings/regenerate-token', { method: 'POST', token }),
    removePublicLink: (token) => request('/mod-reports/settings/token', { method: 'DELETE', token }),
  },

  // Unauthenticated — the public submission link, no bearer token.
  public: {
    modReportMeta: (publicToken) => request(`/public/mod-reports/${publicToken}/meta`),
    submitModReport: (publicToken, payload) => request(`/public/mod-reports/${publicToken}`, { method: 'POST', body: payload }),
  },
};
