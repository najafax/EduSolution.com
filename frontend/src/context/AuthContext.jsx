import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../lib/api';

const AuthContext = createContext(null);
const TOKEN_KEY = 'edusolution_token';

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState(null);
  const [permissions, setPermissions] = useState({});
  const [loading, setLoading] = useState(Boolean(token));

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .me(token)
      .then(({ user, permissions }) => {
        setUser(user);
        setPermissions(permissions || {});
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setUser(null);
        setPermissions({});
      })
      .finally(() => setLoading(false));
  }, [token]);

  function login(nextToken, nextUser, nextPermissions) {
    localStorage.setItem(TOKEN_KEY, nextToken);
    setToken(nextToken);
    setUser(nextUser);
    setPermissions(nextPermissions || {});
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    setPermissions({});
  }

  // For pages that edit the current user's own profile — updates the
  // in-memory user without a full /me round-trip.
  function updateUser(nextUser) {
    setUser(nextUser);
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
    <AuthContext.Provider value={{ token, user, permissions, loading, login, logout, updateUser, can }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
