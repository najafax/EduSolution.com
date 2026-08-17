import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { IDLE_LOGOUT_MESSAGE_KEY } from '../components/IdleTimeoutMonitor';

export default function Login() {
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
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-12 sm:px-6 sm:py-20">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Log in</h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
        Accounts are created by an administrator — contact yours if you need access.
      </p>

      {notice && <p className="mt-4 rounded-md bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">{notice}</p>}

      <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
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
            className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
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
            className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
          />
          <p className="mt-1 text-right">
            <Link to="/forgot-password" className="text-xs font-medium text-lagoon-600 hover:text-lagoon-500">
              Forgot password?
            </Link>
          </p>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="mt-2 min-h-11 rounded-md bg-lagoon-600 px-4 py-2 text-sm font-semibold text-white hover:bg-lagoon-500 disabled:opacity-60"
        >
          {submitting ? 'Logging in…' : 'Log in'}
        </button>
      </form>
    </div>
  );
}
