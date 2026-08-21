import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../lib/api';

// The client-portal counterpart to AuthContext.jsx — same shape (persist a
// bearer token, validate it against /me on load, expose login/logout), but
// entirely separate state: a portal account is a client, not a staff user,
// so mixing the two into one context/localStorage key would risk a client
// session accidentally reading staff-only data (or vice versa). See
// middleware/clientAuth.js's own `type: 'client'` discriminator for the
// backend half of this same separation.
const PortalAuthContext = createContext(null);
const TOKEN_KEY = 'edusolution_portal_token';
// The staff app's own token key (see AuthContext.jsx) — cleared on portal
// login for the same reason AuthContext.jsx clears this key on staff
// login: the two sessions are stored under separate keys so neither auth
// check ever reads the other's token, but that alone still lets a
// still-valid staff session in the same browser (an admin who was also
// testing the portal, a shared/kiosk machine nobody logged out of) keep
// working right alongside a fresh portal login — someone logging into the
// portal here would then find that just changing the URL to the main app
// "worked", even though it's really the untouched staff session doing
// that, not anything the portal login granted. Logging in here ends any
// lingering staff session in this browser rather than merely not
// requesting one.
const STAFF_TOKEN_KEY = 'edusolution_token';

export function PortalAuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [account, setAccount] = useState(null);
  // Fetched once here (rather than per-page) so every portal page — the
  // dashboard, both list pages — can show a currency symbol/business name
  // without each re-fetching it separately. Falls back to '$' wherever it's
  // read, same as every staff page's own `.catch(() => {})` fallback for
  // api.settings.get() — see CLAUDE.md.
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(Boolean(token));

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    Promise.all([api.portal.me(token), api.portal.getSettings(token).catch(() => ({ settings: null }))])
      .then(([{ account }, { settings }]) => {
        // Confirmed this portal session is genuinely valid — purge any
        // staff token riding along in the same browser (see
        // STAFF_TOKEN_KEY above), same reasoning as AuthContext.jsx's own
        // mirror-image purge: a dual session shouldn't linger just
        // because nobody happened to log in fresh again.
        localStorage.removeItem(STAFF_TOKEN_KEY);
        setAccount(account);
        setSettings(settings);
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setAccount(null);
        setSettings(null);
      })
      .finally(() => setLoading(false));
  }, [token]);

  function login(nextToken, nextAccount) {
    localStorage.removeItem(STAFF_TOKEN_KEY);
    localStorage.setItem(TOKEN_KEY, nextToken);
    setToken(nextToken);
    setAccount(nextAccount);
    api.portal
      .getSettings(nextToken)
      .then(({ settings }) => setSettings(settings))
      .catch(() => {});
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setAccount(null);
    setSettings(null);
  }

  return (
    <PortalAuthContext.Provider value={{ token, account, settings, loading, login, logout }}>{children}</PortalAuthContext.Provider>
  );
}

export function usePortalAuth() {
  const ctx = useContext(PortalAuthContext);
  if (!ctx) throw new Error('usePortalAuth must be used within a PortalAuthProvider');
  return ctx;
}
