import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';

export default function MyAccount() {
  const { user, token, updateUser, updateToken } = useAuth();

  const [profileForm, setProfileForm] = useState({ name: user?.name || '', email: user?.email || '' });
  const [profileError, setProfileError] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');
  const [profileSubmitting, setProfileSubmitting] = useState(false);

  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '' });
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);

  const [notifyOverdue, setNotifyOverdue] = useState(Boolean(user?.notifyOverdue));
  const [prefsError, setPrefsError] = useState('');
  const [prefsSuccess, setPrefsSuccess] = useState('');
  const [prefsSubmitting, setPrefsSubmitting] = useState(false);

  async function handleProfileSubmit(e) {
    e.preventDefault();
    setProfileError('');
    setProfileSuccess('');
    setProfileSubmitting(true);
    try {
      const { user: nextUser } = await api.updateMe(profileForm, token);
      updateUser(nextUser);
      setProfileSuccess('Profile updated.');
    } catch (err) {
      setProfileError(err.message);
    } finally {
      setProfileSubmitting(false);
    }
  }

  async function handlePasswordSubmit(e) {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');
    setPasswordSubmitting(true);
    try {
      const { token: nextToken } = await api.changePassword(passwordForm, token);
      updateToken(nextToken);
      setPasswordForm({ currentPassword: '', newPassword: '' });
      setPasswordSuccess('Password changed.');
    } catch (err) {
      setPasswordError(err.message);
    } finally {
      setPasswordSubmitting(false);
    }
  }

  async function handlePrefsSubmit(e) {
    e.preventDefault();
    setPrefsError('');
    setPrefsSuccess('');
    setPrefsSubmitting(true);
    try {
      await api.updatePreferences({ notifyOverdue }, token);
      updateUser({ ...user, notifyOverdue });
      setPrefsSuccess('Preferences saved.');
    } catch (err) {
      setPrefsError(err.message);
    } finally {
      setPrefsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-bold text-slate-900">My account</h1>
      <p className="mt-1 text-sm text-slate-600">
        {user?.role === 'admin' ? 'Administrator' : 'Staff'} account. Contact an admin to change your role or module
        permissions.
      </p>

      <form onSubmit={handleProfileSubmit} className="mt-8 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Profile</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Name</span>
            <input
              type="text"
              required
              value={profileForm.name}
              onChange={(e) => setProfileForm((f) => ({ ...f, name: e.target.value }))}
              className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-indigo-500 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Email</span>
            <input
              type="email"
              required
              value={profileForm.email}
              onChange={(e) => setProfileForm((f) => ({ ...f, email: e.target.value }))}
              className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-indigo-500 focus:outline-none"
            />
          </label>
        </div>
        {profileError && <p className="mt-3 text-sm text-red-600">{profileError}</p>}
        {profileSuccess && <p className="mt-3 text-sm text-emerald-600">{profileSuccess}</p>}
        <button
          type="submit"
          disabled={profileSubmitting}
          className="mt-4 min-h-11 rounded-md bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          {profileSubmitting ? 'Saving…' : 'Save profile'}
        </button>
      </form>

      <form onSubmit={handlePasswordSubmit} className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Change password</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Current password</span>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={passwordForm.currentPassword}
              onChange={(e) => setPasswordForm((f) => ({ ...f, currentPassword: e.target.value }))}
              className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-indigo-500 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">New password</span>
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={passwordForm.newPassword}
              onChange={(e) => setPasswordForm((f) => ({ ...f, newPassword: e.target.value }))}
              className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-indigo-500 focus:outline-none"
            />
          </label>
        </div>
        {passwordError && <p className="mt-3 text-sm text-red-600">{passwordError}</p>}
        {passwordSuccess && <p className="mt-3 text-sm text-emerald-600">{passwordSuccess}</p>}
        <button
          type="submit"
          disabled={passwordSubmitting}
          className="mt-4 min-h-11 rounded-md bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          {passwordSubmitting ? 'Saving…' : 'Change password'}
        </button>
      </form>

      <form onSubmit={handlePrefsSubmit} className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Notifications</h2>
        <label className="mt-4 flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            checked={notifyOverdue}
            onChange={(e) => setNotifyOverdue(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          <span className="text-sm text-slate-700">Email me a daily digest when overdue reminders are sent</span>
        </label>
        {prefsError && <p className="mt-3 text-sm text-red-600">{prefsError}</p>}
        {prefsSuccess && <p className="mt-3 text-sm text-emerald-600">{prefsSuccess}</p>}
        <button
          type="submit"
          disabled={prefsSubmitting}
          className="mt-4 min-h-11 rounded-md bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          {prefsSubmitting ? 'Saving…' : 'Save preferences'}
        </button>
      </form>
    </div>
  );
}
