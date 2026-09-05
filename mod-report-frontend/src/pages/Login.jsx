import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const res = await api.login({ email, password });
      login(res.token, res.user);
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 dark:bg-slate-950">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">MOD Report</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Sign in to manage checklists.</p>

        {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

        <label className="mt-4 block text-sm font-medium text-slate-700 dark:text-slate-300">
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 h-11 w-full rounded-md border border-slate-300 px-3 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
        </label>
        <label className="mt-3 block text-sm font-medium text-slate-700 dark:text-slate-300">
          Password
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 h-11 w-full rounded-md border border-slate-300 px-3 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
        </label>

        <button
          type="submit"
          disabled={submitting}
          className="mt-5 h-11 w-full rounded-md bg-lagoon-600 text-sm font-medium text-white hover:bg-lagoon-500 disabled:opacity-60"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
