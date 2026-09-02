const db = require('../db');

// Modules a permission can be granted for. Kept as a fixed list (rather than
// deriving it from route files) so the Users page always shows the same set
// regardless of which routes exist — and so a typo'd module name in a route
// file fails closed (default-deny) instead of silently creating a new,
// ungrantable permission slot.
const MODULES = [
  'clients',
  'products',
  'quotes',
  'invoices',
  'expenses',
  'recurring_invoices',
  'licenses',
  'financials',
  'activity',
  'settings',
  'users',
  'import',
  'campaigns',
  'email_center',
  'website',
];

// Both admin tiers bypass the per-module grant system entirely — super_admin
// is a strict superset of admin (everything admin can do, plus exclusive
// control over admin/super_admin *accounts* themselves, enforced in
// routes/users.js — see "Roles and permissions" in CLAUDE.md), never a
// narrower or parallel role. Centralized here so every other admin-role
// check in the app (hasPermission/effectivePermissions below,
// middleware/auth.js's requireAdmin, every frontend `role === 'admin'`
// check) reads from the same single place rather than re-deriving which
// role strings count as "admin-tier."
function isAdminRole(role) {
  return role === 'admin' || role === 'super_admin';
}

// isAdminRole() answers "is this account admin-tier" (used for account-
// management purposes — who a super_admin can/can't touch, who counts
// toward the last-active-admin guard — see routes/users.js). This answers
// the narrower, separate question hasPermission()/effectivePermissions()
// actually care about: does this specific account currently bypass the
// per-module grant system. `super_admin` always does — the tier super_admin
// exists precisely to be un-restrictable, so a super_admin's own account
// can never be flagged `restricted` (routes/users.js refuses to store it).
// A plain `admin` bypasses by default too, UNLESS a super_admin has
// explicitly flagged that specific account `restricted` (see "Super admin
// and the Finance permission preset" in CLAUDE.md) — once restricted, an
// admin is gated by real `user_permissions` grants exactly like `staff`,
// though it keeps its admin-tier *account* protections (still only a
// super_admin can edit/delete/reset it, still counts toward
// activeAdminCount) unchanged, since restricting business-data access is a
// completely separate question from who controls the account itself.
function isUnrestrictedAdmin(user) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  return user.role === 'admin' && !user.restricted;
}

// Default-deny: a module with no row is { can_view: false, can_manage:
// false }, never falls back to "allowed". An unrestricted admin-tier
// account never consults this table — hasPermission() short-circuits to
// true for them — so there's nothing to keep in sync when a new module is
// added; only staff (and any restricted admin) grants need seeding.
function getPermissions(userId) {
  const rows = db.prepare('SELECT module, can_view, can_manage FROM user_permissions WHERE user_id = ?').all(userId);
  const map = {};
  for (const m of MODULES) map[m] = { can_view: false, can_manage: false };
  for (const row of rows) {
    if (row.module in map) {
      map[row.module] = { can_view: Boolean(row.can_view), can_manage: Boolean(row.can_manage) };
    }
  }
  return map;
}

// level: 'view' | 'manage'. 'manage' also implies 'view' passes (someone who
// can edit clients can obviously also see them), but not the reverse.
function hasPermission(user, module, level = 'view') {
  if (!user) return false;
  if (isUnrestrictedAdmin(user)) return true;
  const entry = getPermissions(user.id)[module];
  if (!entry) return false;
  return level === 'manage' ? entry.can_manage : entry.can_view || entry.can_manage;
}

// permissionsMap: { [module]: { can_view, can_manage } }. Replaces the given
// modules' grants; modules not present in the map are left untouched (the
// caller sends the full form state, so in practice this always covers every
// module — but it's not destructive of others if it doesn't).
function setPermissions(userId, permissionsMap) {
  const upsert = db.prepare(`
    INSERT INTO user_permissions (user_id, module, can_view, can_manage)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, module) DO UPDATE SET can_view = excluded.can_view, can_manage = excluded.can_manage
  `);
  const run = db.transaction((entries) => {
    for (const [module, perm] of entries) {
      if (!MODULES.includes(module)) continue;
      const canManage = Boolean(perm && perm.can_manage);
      // Storing view=true whenever manage=true keeps the raw data consistent
      // with the "manage implies view" rule enforced in hasPermission(),
      // rather than relying on every future reader to re-derive it.
      const canView = canManage || Boolean(perm && perm.can_view);
      upsert.run(userId, module, canView ? 1 : 0, canManage ? 1 : 0);
    }
  });
  run(Object.entries(permissionsMap || {}));
}

// What the frontend actually wants: a single resolved map it can read
// directly without re-implementing the "an unrestricted admin bypasses
// everything" rule itself. An unrestricted admin-tier account gets every
// module at { can_view: true, can_manage: true }; staff and any restricted
// admin get their real grants from getPermissions().
function effectivePermissions(user) {
  if (!user) return {};
  if (isUnrestrictedAdmin(user)) {
    const map = {};
    for (const m of MODULES) map[m] = { can_view: true, can_manage: true };
    return map;
  }
  return getPermissions(user.id);
}

module.exports = {
  MODULES,
  isAdminRole,
  isUnrestrictedAdmin,
  getPermissions,
  hasPermission,
  setPermissions,
  effectivePermissions,
};
