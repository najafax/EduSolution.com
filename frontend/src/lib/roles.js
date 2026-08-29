// Mirrors the backend's isAdminRole() in backend/src/lib/permissions.js —
// the single place both the frontend and backend agree on which
// `users.role` strings count as "admin-tier". super_admin is a strict
// superset of admin (see that file's own comment), never a narrower or
// parallel role, so every existing `role === 'admin'` check in the app
// should read from here instead of re-deriving the rule.
export function isAdminRole(role) {
  return role === 'admin' || role === 'super_admin';
}

// Human-readable label for a stored role value — avoids "Super_admin"
// (raw `capitalize` CSS on the underscored DB value) anywhere a role is
// displayed.
export function roleLabel(role) {
  if (role === 'super_admin') return 'Super Admin';
  if (role === 'admin') return 'Administrator';
  return 'Staff';
}
