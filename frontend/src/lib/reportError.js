// Sends browser errors to the backend (POST /api/client-errors) so crashes are
// seen as they happen. Best effort: never throws, never loops, and caps how
// many reports one page load can send.
let sent = 0;
const MAX_PER_PAGE_LOAD = 10;
const recent = new Set();

export function reportError(error, extra = {}) {
  try {
    if (sent >= MAX_PER_PAGE_LOAD) return;
    const message = String(error?.message || error || 'Unknown error').slice(0, 500);
    if (/ResizeObserver loop|Script error\.?$/i.test(message)) return;
    const key = message + (extra.where || '');
    if (recent.has(key)) return;
    recent.add(key);
    sent += 1;
    const token = localStorage.getItem('edusolution_token');
    fetch('/api/client-errors', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({
        message,
        stack: String(error?.stack || extra.componentStack || '').slice(0, 4000),
        url: window.location.pathname,
      }),
    }).catch(() => {});
  } catch {
    // reporting must never break the app
  }
}

export function installGlobalErrorReporting() {
  window.addEventListener('error', (e) => reportError(e.error || e.message, { where: 'window' }));
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason, { where: 'promise' }));
}
