import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import PortalAuthCard from './PortalAuthCard';

// The backend (routes/clientPortal.js's POST /accept-invite) returns this
// exact string whether the token was never valid, has genuinely passed its
// 7-day expiry, or — the most common real-world cause, since the token is
// cleared the moment accept-invite succeeds — has already been used to set
// a password once already. That last case reads as confusing/wrong to a
// client re-clicking an old email ("but the email said 7 days!"), so this
// page adds a pointer to "Forgot password" specifically for this message
// rather than the generic catch-all below — reset-password sets
// password_hash the same unconditional way accept-invite does, so it's a
// working fallback regardless of which of the three cases actually
// happened, without the backend needing to distinguish them.
const EXPIRED_MESSAGE = 'This invite link is invalid or has expired';

// The client-portal counterpart to pages/ResetPassword.jsx — same token-
// from-query-string + set-a-new-password shape, but for a first-time
// invite (see routes/clients.js's POST /:id/portal-invite) rather than a
// self-serve reset. On success it lands back at login with a banner, same
// as ResetPassword.jsx does.
export default function PortalAcceptInvite() {
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
      await api.portal.acceptInvite({ token, password });
      // Lands on the shared "/login" (see pages/Login.jsx), same as
      // pages/ResetPassword.jsx's own post-reset redirect — that page's
      // notice banner already reads location.state?.message.
      navigate('/login', { state: { message: 'Password set. You can now log in.' } });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <PortalAuthCard title="Invite link missing">
        <p className="mt-4 text-sm text-red-600 dark:text-red-400">This invite link is missing its token.</p>
      </PortalAuthCard>
    );
  }

  return (
    <PortalAuthCard title="Set up your portal access" subtitle="Choose a password to activate your account.">
      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Password
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

        {error && (
          <div>
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            {error === EXPIRED_MESSAGE && (
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                If you've already set a password with this link before, it's already been used — try{' '}
                <Link to="/login" className="font-medium text-lagoon-600 hover:text-lagoon-500">
                  logging in
                </Link>{' '}
                instead, or use{' '}
                <Link to="/portal/forgot-password" className="font-medium text-lagoon-600 hover:text-lagoon-500">
                  Forgot password
                </Link>{' '}
                to set a new one.
              </p>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="mt-1 min-h-11 rounded-md bg-lagoon-600 px-4 text-sm font-semibold text-white hover:bg-lagoon-500 disabled:opacity-60"
        >
          {submitting ? 'Setting password…' : 'Set password and continue'}
        </button>
      </form>
    </PortalAuthCard>
  );
}
