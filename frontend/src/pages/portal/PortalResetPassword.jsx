import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import PortalAuthCard from './PortalAuthCard';

export default function PortalResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setSubmitting(true);
    try {
      await api.portal.resetPassword(token, password);
      // Lands on the shared "/login" (see pages/Login.jsx), same as
      // pages/ResetPassword.jsx's own post-reset redirect — that page's
      // notice banner already reads location.state?.message.
      navigate('/login', { state: { message: 'Password updated. You can now log in.' } });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <PortalAuthCard title="Reset link missing">
        <p className="mt-4 text-sm text-red-600 dark:text-red-400">This reset link is missing its token.</p>
      </PortalAuthCard>
    );
  }

  return (
    <PortalAuthCard title="Choose a new password">
      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            New password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
          />
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">At least 8 characters.</p>
        </div>
        <div>
          <label htmlFor="confirm" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Confirm password
          </label>
          <input
            id="confirm"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
          />
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="mt-1 min-h-11 rounded-md bg-lagoon-600 px-4 text-sm font-semibold text-white hover:bg-lagoon-500 disabled:opacity-60"
        >
          {submitting ? 'Updating…' : 'Update password'}
        </button>
      </form>
    </PortalAuthCard>
  );
}
