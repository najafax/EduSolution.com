import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { isAdminRole } from '../lib/roles';

const AuthContext = createContext(null);
const TOKEN_KEY = 'edusolution_token';
// The client portal's own token key (see PortalAuthContext.jsx) — staff and
// portal sessions are deliberately kept in separate localStorage keys so
// neither auth check ever reads the other's token, but logging in here
// while a portal session happens to still be sitting in the same browser
// (e.g. an admin who was also testing the portal, or a shared/kiosk
// machine where a client never logged out) would otherwise let a
// still-valid portal session keep working alongside a fresh staff one.
// Since the backend already treats the two as mutually exclusive, this
// browser should too — logging in as staff ends any lingering portal
// session in this browser, not just prevents starting a new one.
const PORTAL_TOKEN_KEY = 'edusolution_portal_token';

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
        // Confirmed this staff session is genuinely valid — purge any
        // portal token riding along in the same browser (see
        // PORTAL_TOKEN_KEY above) rather than only doing this at login
        // time, so a dual session created before this check existed (or
        // by any other means) doesn't linger indefinitely just because
        // nobody happened to log in fresh again.
        localStorage.removeItem(PORTAL_TOKEN_KEY);
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
    localStorage.removeItem(PORTAL_TOKEN_KEY);
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

  // Both admin tiers ('admin' and 'super_admin') are "admin-tier" — see
  // lib/roles.js's isAdminRole(), which mirrors the backend's own, so every
  // frontend `user.role === 'admin'` check has one place to read from
  // instead of re-deriving which role strings count as admin-tier.
  // isSuperAdmin is the narrower check for the handful of places (Users.jsx's
  // admin-tier account controls) that specifically need the super_admin
  // tier itself, not just "some kind of admin."
  const isAdmin = isAdminRole(user?.role);
  const isSuperAdmin = user?.role === 'super_admin';

  return (
    <AuthContext.Provider
      value={{
        token,
        user,
        permissions,
        sessionTimeoutMinutes,
        loading,
        login,
        logout,
        updateUser,
        updateToken,
        can,
        isAdmin,
        isSuperAdmin,
      }}
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
