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
