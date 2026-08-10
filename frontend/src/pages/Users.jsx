import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import FloatingActionButton from '../components/FloatingActionButton';

const EMPTY_FORM = { name: '', email: '', password: '', role: 'staff', active: true };

function moduleLabel(module) {
  return module.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function emptyPermissions(modules) {
  const map = {};
  for (const m of modules) map[m] = { can_view: false, can_manage: false };
  return map;
}

export default function Users() {
  const { user: currentUser, token, can } = useAuth();
  const canView = can('users', 'view');
  const canManage = can('users', 'manage');

  const [users, setUsers] = useState([]);
  const [modules, setModules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [permissions, setPermissionsState] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const [resetTargetId, setResetTargetId] = useState(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetSubmitting, setResetSubmitting] = useState(false);

  function load() {
    if (!canView) return;
    setLoading(true);
    Promise.all([api.users.list(token), api.users.modules(token)])
      .then(([{ users }, { modules }]) => {
        setUsers(users);
        setModules(modules);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [token, canView]);

  function startCreate() {
    setForm(EMPTY_FORM);
    setPermissionsState(emptyPermissions(modules));
    setEditingId(null);
    setShowForm(true);
    setError('');
  }

  async function startEdit(user) {
    setError('');
    try {
      const { user: full, permissions: perms } = await api.users.get(user.id, token);
      setForm({ name: full.name, email: full.email, password: '', role: full.role, active: full.active });
      setPermissionsState(perms);
      setEditingId(full.id);
      setShowForm(true);
    } catch (err) {
      setError(err.message);
    }
  }

  function togglePermission(module, level) {
    setPermissionsState((prev) => {
      const entry = prev[module] || { can_view: false, can_manage: false };
      if (level === 'manage') {
        const nextManage = !entry.can_manage;
        return { ...prev, [module]: { can_manage: nextManage, can_view: nextManage || entry.can_view } };
      }
      const nextView = !entry.can_view;
      return { ...prev, [module]: { can_view: nextView, can_manage: nextView ? entry.can_manage : false } };
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const payload = {
        name: form.name,
        email: form.email,
        role: form.role,
        active: form.active,
        permissions: form.role === 'admin' ? undefined : permissions,
      };
      if (editingId) {
        await api.users.update(editingId, payload, token);
      } else {
        await api.users.create({ ...payload, password: form.password }, token);
      }
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(user) {
    if (!confirm(`Delete ${user.name}? This cannot be undone.`)) return;
    setError('');
    try {
      await api.users.remove(user.id, token);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleResetPassword(e) {
    e.preventDefault();
    setError('');
    setResetSubmitting(true);
    try {
      await api.users.resetPassword(resetTargetId, resetPassword, token);
      setResetTargetId(null);
      setResetPassword('');
    } catch (err) {
      setError(err.message);
    } finally {
      setResetSubmitting(false);
    }
  }

  if (!canView) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <p className="text-sm text-slate-500">You don't have permission to view this page.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">Users</h1>
        {canManage && (
          <button
            onClick={startCreate}
            className="min-h-11 rounded-md bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-500"
          >
            New user
          </button>
        )}
      </div>
      <p className="mt-1 text-sm text-slate-600">
        Everyone with an account can see and edit shared business data unless restricted below. Admins always have
        full access.
      </p>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {showForm && (
        <form onSubmit={handleSubmit} className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">{editingId ? 'Edit user' : 'New user'}</h2>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Name</span>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-indigo-500 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Email</span>
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-indigo-500 focus:outline-none"
              />
            </label>
            {!editingId && (
              <label className="block">
                <span className="text-sm font-medium text-slate-700">Password</span>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-indigo-500 focus:outline-none"
                />
              </label>
            )}
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Role</span>
              <select
                value={form.role}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-indigo-500 focus:outline-none"
              >
                <option value="staff">Staff</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            {editingId && editingId !== currentUser.id && (
              <label className="flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                  className="h-4 w-4 rounded border-slate-300"
                />
                <span className="text-sm font-medium text-slate-700">Active</span>
              </label>
            )}
          </div>

          {form.role === 'staff' && (
            <div className="mt-6">
              <h3 className="text-sm font-semibold text-slate-900">Module permissions</h3>
              <div className="mt-2 overflow-x-auto rounded-md border border-slate-200">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead>
                    <tr className="text-left text-xs font-medium uppercase text-slate-500">
                      <th className="px-4 py-2">Module</th>
                      <th className="px-4 py-2 text-center">View</th>
                      <th className="px-4 py-2 text-center">Manage</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {modules.map((m) => (
                      <tr key={m}>
                        <td className="px-4 py-2 text-slate-900">{moduleLabel(m)}</td>
                        <td className="px-4 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={Boolean(permissions[m]?.can_view)}
                            onChange={() => togglePermission(m, 'view')}
                            className="h-4 w-4 rounded border-slate-300"
                          />
                        </td>
                        <td className="px-4 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={Boolean(permissions[m]?.can_manage)}
                            onChange={() => togglePermission(m, 'manage')}
                            className="h-4 w-4 rounded border-slate-300"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-1 text-xs text-slate-500">Manage access also grants view access.</p>
            </div>
          )}

          <div className="mt-6 flex gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="min-h-11 rounded-md bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {submitting ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {resetTargetId && (
        <form
          onSubmit={handleResetPassword}
          className="mt-6 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
        >
          <label className="block">
            <span className="text-sm font-medium text-slate-700">New password</span>
            <input
              type="password"
              required
              minLength={8}
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
              className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-indigo-500 focus:outline-none"
            />
          </label>
          <button
            type="submit"
            disabled={resetSubmitting}
            className="min-h-11 rounded-md bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {resetSubmitting ? 'Saving…' : 'Set password'}
          </button>
          <button
            type="button"
            onClick={() => {
              setResetTargetId(null);
              setResetPassword('');
            }}
            className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
        </form>
      )}

      <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <p className="p-6 text-sm text-slate-500">Loading…</p>
        ) : users.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">No users yet.</p>
        ) : (
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead>
              <tr className="text-left text-xs font-medium uppercase text-slate-500">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Status</th>
                {canManage && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900">
                    {u.name}
                    {u.id === currentUser.id && <span className="ml-2 text-xs text-slate-400">(you)</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{u.email}</td>
                  <td className="whitespace-nowrap px-4 py-3 capitalize text-slate-600">{u.role}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        u.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {u.active ? 'Active' : 'Deactivated'}
                    </span>
                  </td>
                  {canManage && (
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <button onClick={() => startEdit(u)} className="mr-3 text-indigo-600 hover:text-indigo-500">
                        Edit
                      </button>
                      <button
                        onClick={() => setResetTargetId(u.id)}
                        className="mr-3 text-indigo-600 hover:text-indigo-500"
                      >
                        Reset password
                      </button>
                      {u.id !== currentUser.id && (
                        <button onClick={() => handleDelete(u)} className="text-red-600 hover:text-red-500">
                          Delete
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {canManage && !showForm && <FloatingActionButton onClick={startCreate} label="New user" />}
    </div>
  );
}
