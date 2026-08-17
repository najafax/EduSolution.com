import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import FloatingActionButton from '../components/FloatingActionButton';
import SearchInput from '../components/SearchInput';
import Pagination from '../components/Pagination';
import Modal from '../components/Modal';
import MobileListAccordion from '../components/MobileListAccordion';
import { useConfirm } from '../lib/useConfirm';

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
  const [pageInfo, setPageInfo] = useState(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
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
  const { confirm, confirmDialog } = useConfirm();

  function load() {
    if (!canView) return;
    setLoading(true);
    Promise.all([api.users.list(token, { q: search, page }), api.users.modules(token)])
      .then(([{ users, ...rest }, { modules }]) => {
        setUsers(users);
        setPageInfo(rest.totalPages ? rest : null);
        setModules(modules);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [token, canView, search, page]);
  useEffect(() => {
    setPage(1);
  }, [search]);

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
    if (!(await confirm({ title: `Delete ${user.name}?`, message: 'This cannot be undone.', confirmLabel: 'Delete' }))) return;
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
      <div className="px-4 py-10 sm:px-6 lg:px-8">
        <p className="text-sm text-slate-500 dark:text-slate-400">You don't have permission to view this page.</p>
      </div>
    );
  }

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Users</h1>
        {canManage && (
          <button
            onClick={startCreate}
            className="min-h-11 rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500"
          >
            New user
          </button>
        )}
      </div>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        Everyone with an account can see and edit shared business data unless restricted below. Admins always have
        full access.
      </p>

      <div className="mt-4 max-w-sm">
        <SearchInput value={search} onChange={setSearch} placeholder="Search users…" />
      </div>

      {error && !showForm && resetTargetId === null && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <Modal open={showForm} onClose={() => setShowForm(false)} title={editingId ? 'Edit user' : 'New user'} maxWidthClass="max-w-3xl">
        <form onSubmit={handleSubmit}>
          {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Name</span>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Email</span>
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              />
            </label>
            {!editingId && (
              <label className="block">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Password</span>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                />
              </label>
            )}
            <label className="block">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Role</span>
              <select
                value={form.role}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
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
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Active</span>
              </label>
            )}
          </div>

          {form.role === 'staff' && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Module permissions</h3>
              <div className="mt-1.5 max-h-56 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-700">
                <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
                  <thead>
                    <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                      <th className="px-4 py-1.5">Module</th>
                      <th className="px-4 py-1.5 text-center">View</th>
                      <th className="px-4 py-1.5 text-center">Manage</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {modules.map((m) => (
                      <tr key={m}>
                        <td className="px-4 py-1.5 text-slate-900 dark:text-white">{moduleLabel(m)}</td>
                        <td className="px-4 py-1.5 text-center">
                          <input
                            type="checkbox"
                            checked={Boolean(permissions[m]?.can_view)}
                            onChange={() => togglePermission(m, 'view')}
                            className="h-4 w-4 rounded border-slate-300"
                          />
                        </td>
                        <td className="px-4 py-1.5 text-center">
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
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Manage access also grants view access.</p>
            </div>
          )}

          <div className="mt-4 flex gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="min-h-11 rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500 disabled:opacity-60"
            >
              {submitting ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={resetTargetId !== null}
        onClose={() => {
          setResetTargetId(null);
          setResetPassword('');
        }}
        title="Reset password"
      >
        <form onSubmit={handleResetPassword} className="flex flex-col gap-3">
          {error && <p className="text-sm text-red-600">{error}</p>}
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">New password</span>
            <input
              type="password"
              required
              minLength={8}
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
              className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none"
            />
          </label>
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={resetSubmitting}
              className="min-h-11 rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500 disabled:opacity-60"
            >
              {resetSubmitting ? 'Saving…' : 'Set password'}
            </button>
            <button
              type="button"
              onClick={() => {
                setResetTargetId(null);
                setResetPassword('');
              }}
              className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      <div className="mt-6 rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        {loading ? (
          <p className="p-6 text-sm text-slate-500 dark:text-slate-400">Loading…</p>
        ) : users.length === 0 ? (
          <p className="p-6 text-sm text-slate-500 dark:text-slate-400">{search ? `No users match "${search}".` : 'No users yet.'}</p>
        ) : (
          <>
            <div className="hidden overflow-x-auto sm:block">
              <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Email</th>
                    <th className="px-4 py-3">Role</th>
                    <th className="px-4 py-3">Status</th>
                    {canManage && <th className="px-4 py-3" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900 dark:text-white">
                        {u.name}
                        {u.id === currentUser.id && <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">(you)</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-400">{u.email}</td>
                      <td className="whitespace-nowrap px-4 py-3 capitalize text-slate-600 dark:text-slate-400">{u.role}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            u.active
                              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
                              : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                          }`}
                        >
                          {u.active ? 'Active' : 'Deactivated'}
                        </span>
                      </td>
                      {canManage && (
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <button onClick={() => startEdit(u)} className="mr-3 text-lagoon-600 hover:text-lagoon-500">
                            Edit
                          </button>
                          <button
                            onClick={() => setResetTargetId(u.id)}
                            className="mr-3 text-lagoon-600 hover:text-lagoon-500"
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
            </div>

            <div className="flex flex-col gap-2.5 sm:hidden">
              {users.map((u) => (
                <MobileListAccordion
                  key={u.id}
                  name="users-list"
                  summary={
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-slate-900 dark:text-white">
                          {u.name}
                          {u.id === currentUser.id && <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">(you)</span>}
                        </p>
                        <p className="truncate text-slate-500 dark:text-slate-400">{u.email}</p>
                      </div>
                      <span
                        className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          u.active
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
                            : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                        }`}
                      >
                        {u.active ? 'Active' : 'Deactivated'}
                      </span>
                    </div>
                  }
                >
                  <div className="flex justify-between">
                    <dt className="text-slate-500 dark:text-slate-400">Role</dt>
                    <dd className="capitalize text-slate-900 dark:text-white">{u.role}</dd>
                  </div>
                  {canManage && (
                    <div className="flex flex-wrap gap-4 pt-1">
                      <button onClick={() => startEdit(u)} className="text-lagoon-600 hover:text-lagoon-500">
                        Edit
                      </button>
                      <button onClick={() => setResetTargetId(u.id)} className="text-lagoon-600 hover:text-lagoon-500">
                        Reset password
                      </button>
                      {u.id !== currentUser.id && (
                        <button onClick={() => handleDelete(u)} className="text-red-600 hover:text-red-500">
                          Delete
                        </button>
                      )}
                    </div>
                  )}
                </MobileListAccordion>
              ))}
            </div>
          </>
        )}
      </div>

      {pageInfo && <Pagination page={pageInfo.page} totalPages={pageInfo.totalPages} onChange={setPage} />}

      {canManage && !showForm && <FloatingActionButton onClick={startCreate} label="New user" />}

      {confirmDialog}
    </div>
  );
}
