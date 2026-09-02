import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { IDLE_LOGOUT_MESSAGE_KEY } from '../components/IdleTimeoutMonitor';

// This one form now signs in either kind of account this app has — a
// staff user or a client with portal access (see context/PortalAuthContext.jsx)
// — since they're deliberately separate auth systems (separate tables,
// separate JWTs, mutually-exclusive localStorage sessions; see that
// context's own notes) with no shared login table to query once. The
// portal's own dedicated `/portal/login` page is retired in favor of this
// one (see PortalApp.jsx), matching what the public marketing site's own
// header link already assumed: it's always pointed logged-out visitors —
// staff and clients alike — at this same `/login` (see MarketingLayout.jsx).
// `PORTAL_TOKEN_KEY` mirrors PortalAuthContext.jsx's own constant — this
// page isn't rendered inside a `PortalAuthProvider` (that only wraps
// `/portal/*`, see PortalApp.jsx), so a successful portal login here writes
// straight to the same localStorage key that provider reads from on mount,
// rather than going through its `login()` method.
const PORTAL_TOKEN_KEY = 'edusolution_portal_token';
// Both `POST /api/auth/login` and `POST /api/portal/login` return this
// exact string for "no such account" or "wrong password" — never anything
// more specific, so a nonexistent/mistyped email can't be distinguished
// from a real one with the wrong password (account enumeration). Used
// below as the one signal that means "this wasn't a staff account after
// all, worth trying the portal instead" — any other message (e.g. "This
// account has been deactivated") means the credentials genuinely matched
// a real staff account, so there's nothing a portal lookup could usefully
// add and it's shown immediately instead of trying to log in twice.
const GENERIC_LOGIN_ERROR = 'Invalid email or password';

function LoginForm() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [notice] = useState(() => {
    const idleMessage = sessionStorage.getItem(IDLE_LOGOUT_MESSAGE_KEY);
    if (idleMessage) {
      sessionStorage.removeItem(IDLE_LOGOUT_MESSAGE_KEY);
      return idleMessage;
    }
    return location.state?.message || '';
  });

  function handleChange(e) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const { token, user, permissions, sessionTimeoutMinutes } = await api.login(form);
      login(token, user, permissions, sessionTimeoutMinutes);
      navigate('/dashboard');
    } catch (staffErr) {
      if (staffErr.message !== GENERIC_LOGIN_ERROR) {
        setError(staffErr.message);
      } else {
        try {
          const { token } = await api.portal.login(form);
          localStorage.setItem(PORTAL_TOKEN_KEY, token);
          navigate('/portal/dashboard');
        } catch (portalErr) {
          setError(portalErr.message);
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  // Focus rings use a soft outer glow (box-shadow) layered under the
  // existing border-color change, rather than border-color alone — the
  // same premium-input treatment Stripe/Linear-style forms use, a bit more
  // considered than a flat 1px color swap.
  const inputClass =
    'mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 px-3.5 py-2 text-base shadow-sm transition-shadow focus:border-lagoon-500 focus:shadow-[0_0_0_3px_rgba(14,124,134,0.15)] focus:outline-none dark:border-slate-600 dark:bg-slate-950 dark:text-white dark:focus:shadow-[0_0_0_3px_rgba(63,169,166,0.2)]';

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-xl sm:p-9 dark:border-slate-700 dark:bg-slate-900">
      <h2 className="text-xl font-bold text-ink dark:text-white">Log in</h2>
      <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
        Staff and client portal accounts both sign in here — accounts are created by an administrator, so contact
        yours if you need access.
      </p>

      {notice && (
        <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
          {notice}
        </p>
      )}

      <form onSubmit={handleSubmit} className="mt-7 flex flex-col gap-5">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={form.email}
            onChange={handleChange}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={form.password}
            onChange={handleChange}
            className={inputClass}
          />
          <p className="mt-1.5 text-right">
            <Link to="/forgot-password" className="text-xs font-medium text-lagoon-600 hover:text-lagoon-500">
              Forgot password?
            </Link>
          </p>
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="mt-1 min-h-11 rounded-lg bg-lagoon-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-lagoon-600/25 transition-shadow hover:bg-lagoon-500 hover:shadow-xl hover:shadow-lagoon-600/30 disabled:opacity-60 disabled:shadow-none"
        >
          {submitting ? 'Logging in…' : 'Log in'}
        </button>
      </form>
    </div>
  );
}

export default function Login() {
  const { token, loading } = useAuth();

  // The public marketing site (see pages/marketing/) now covers everything
  // Login used to double as — the landing page, the EduPage partner panel,
  // the mission statement — so this page is just the sign-in form itself.
  // Every real visitor here is either signing in or already signed in
  // (there's no public signup, see routes/auth.js), so an already-
  // authenticated visit — a stale bookmark, following a link from the
  // marketing site's own "Login" nav item — should just continue to the
  // dashboard rather than show a form with nothing left to do. Same
  // loading/token pattern as ProtectedRoute.jsx, mirrored here instead of
  // shared since the redirect target and "what to show while deciding"
  // differ.
  if (loading) {
    return <div className="flex justify-center py-24 text-slate-500 dark:text-slate-400">Loading…</div>;
  }
  if (token) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-16 sm:px-6">
      <div className="w-full max-w-sm">
        <LoginForm />
      </div>
    </div>
  );
}
