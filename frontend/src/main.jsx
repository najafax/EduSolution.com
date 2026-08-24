import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
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
// import, and because nothing in this app wraps the lazy routes in an
// error boundary, that unhandled rejection unmounts the whole tree —
// a blank page with no way back short of a manual hard refresh. Vite
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
