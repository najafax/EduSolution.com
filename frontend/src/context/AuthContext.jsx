import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../lib/api';

const AuthContext = createContext(null);
const TOKEN_KEY = 'edusolution_token';

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState(null);
  const [permissions, setPermissions] = useState({});
  // Minutes of inactivity before the idle-logout warning fires (see
  // components/IdleTimeoutMonitor.jsx) — null until the first /me or login
  // response loads it, so the monitor knows not to start counting yet.
  const [sessionTimeoutMinutes, setSessionTimeoutMinutes] = useState(null);
  const [loading, setLoading] = useState(Boolean(token));

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .me(token)
      .then(({ user, permissions, sessionTimeoutMinutes }) => {
        setUser(user);
        setPermissions(permissions || {});
        setSessionTimeoutMinutes(sessionTimeoutMinutes ?? null);
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setUser(null);
        setPermissions({});
        setSessionTimeoutMinutes(null);
      })
      .finally(() => setLoading(false));
  }, [token]);

  function login(nextToken, nextUser, nextPermissions, nextSessionTimeoutMinutes) {
    localStorage.setItem(TOKEN_KEY, nextToken);
    setToken(nextToken);
    setUser(nextUser);
    setPermissions(nextPermissions || {});
    setSessionTimeoutMinutes(nextSessionTimeoutMinutes ?? null);
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    setPermissions({});
    setSessionTimeoutMinutes(null);
  }

  // For pages that edit the current user's own profile — updates the
  // in-memory user without a full /me round-trip.
  function updateUser(nextUser) {
    setUser(nextUser);
  }

  // Changing your own password invalidates every token issued before the
  // change (see backend middleware/auth.js), including the one this session
  // is currently using — swap in the fresh token the endpoint returns so the
  // user isn't logged out by their own password change.
  function updateToken(nextToken) {
    localStorage.setItem(TOKEN_KEY, nextToken);
    setToken(nextToken);
  }

  // 'view' | 'manage'. Admins carry an all-true permissions map from the
  // backend (see lib/permissions.js effectivePermissions), so this needs no
  // separate admin special-case here — the map already reflects it.
  function can(module, level = 'view') {
    const entry = permissions[module];
    if (!entry) return false;
    return level === 'manage' ? entry.can_manage : entry.can_view || entry.can_manage;
  }

  return (
    <AuthContext.Provider
      value={{ token, user, permissions, sessionTimeoutMinutes, loading, login, logout, updateUser, updateToken, can }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
