import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { ToastProvider } from './context/ToastContext.jsx'
import { ThemeProvider } from './context/ThemeContext.jsx'

// Every routed page is its own lazily-loaded chunk with a content hash in
// its filename (see App.jsx's "Route-level code-splitting" note) — great
// for load time, but it means a tab left open across a deploy is still
// holding index.html's OLD chunk map. Clicking into a page whose chunk
// changed (or was renamed) since that page loaded 404s the dynamic
// import — components/ErrorBoundary.jsx catches the resulting render
// crash so it no longer blanks the whole app, but reloading is still the
// actual fix (the stale chunk map itself doesn't go away on its own). Vite
// fires `vite:preloadError` on the window in exactly this case; reloading
// once fetches the current index.html/chunk map and resolves it
// transparently. A plain per-session guard (not sessionStorage) stops a
// genuinely broken deploy from reload-looping the tab forever.
let reloadedForStaleChunk = false;
window.addEventListener('vite:preloadError', () => {
  if (reloadedForStaleChunk) return;
  reloadedForStaleChunk = true;
  window.location.reload();
});

// `vite:preloadError` only catches a stale chunk *map* — it does nothing
// for a tab that's simply been left open across a deploy without ever
// clicking into a route whose chunk changed. This app is an installable
// PWA (vite.config.js's VitePWA()), which by default (injectRegister:
// 'auto') falls back to the plugin's own bare auto-injected registration
// script the moment the build doesn't statically import
// `virtual:pwa-register` anywhere — and that bare script is nothing more
// than `navigator.serviceWorker.register('/sw.js')`, with none of the
// "reload once the new service worker takes over" logic the smarter
// `virtual:pwa-register` module provides. `registerType: 'autoUpdate'`
// only controls how the *generated service worker itself* behaves
// (skipWaiting/clientsClaim, so a new version activates immediately once
// found) — it does nothing to make the browser actually go looking for
// that new version promptly. Per the Service Worker spec, browsers only
// guarantee checking for a changed sw.js on navigation (or roughly once
// every 24 hours in the background otherwise), which a long-lived
// dashboard tab that's never fully reloaded may not do for a very long
// time — exactly the "why does the deployed app still show old UI"
// symptom this was written to fix. Importing registerSW() (see the top of
// this file — vite-plugin-pwa detects that import at build time and uses
// it instead of injecting the bare script) both wires up the real
// reload-on-update behavior and lets us poll registration.update()
// periodically below, so an already-open tab picks up a new deploy within
// the hour rather than waiting on whatever interval the browser would
// otherwise pick on its own.
const SW_UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

registerSW({
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;
    setInterval(() => {
      registration.update().catch(() => {});
    }, SW_UPDATE_CHECK_INTERVAL_MS);
  },
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
