import { useState } from 'react';
import { usePortalAuth } from '../../context/PortalAuthContext';
import { api } from '../../lib/api';

// The portal's own self-service account page — closes a real gap: before
// this, a logged-in client had no way to change their password except by
// going through the forgot-password email flow, and no page confirming
// which account/email they're actually logged in as. Deliberately scoped
// to just that: unlike MyAccount.jsx (staff), there's no profile-edit form
// here — a portal account's email is its login identity, and letting a
// client freely change it would need its own verification/conflict-check
// flow (does it collide with another portal account? does it still match
// clients.email?) that's out of scope for what was actually asked for
// here. No notification-preference toggles either — the portal has no
// equivalent of notify_overdue/notify_quote_responses; those are staff-side
// digest opt-ins with nothing to mirror on the client's side.
export default function PortalMyAccount() {
  const { account, token, updateToken } = usePortalAuth();

  const [form, setForm] = useState({ currentPassword: '', newPassword: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSubmitting(true);
    try {
      const { token: nextToken } = await api.portal.changePassword(form, token);
      updateToken(nextToken);
      setForm({ currentPassword: '', newPassword: '' });
      setSuccess('Password changed.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white">My account</h1>

      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Account</h2>
        <dl className="mt-3 space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-500 dark:text-slate-400">Company</dt>
            <dd className="text-slate-900 dark:text-white">{account?.clientName}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500 dark:text-slate-400">Login email</dt>
            <dd className="text-slate-900 dark:text-white">{account?.email}</dd>
          </div>
        </dl>
      </div>

      <form onSubmit={handleSubmit} className="mt-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Change password</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Current password</span>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={form.currentPassword}
              onChange={(e) => setForm((f) => ({ ...f, currentPassword: e.target.value }))}
              className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">New password</span>
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={form.newPassword}
              onChange={(e) => setForm((f) => ({ ...f, newPassword: e.target.value }))}
              className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            />
          </label>
        </div>
        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
        {success && <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">{success}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="mt-3 min-h-11 rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500 disabled:opacity-60"
        >
          {submitting ? 'Saving…' : 'Change password'}
        </button>
      </form>
    </div>
  );
}
