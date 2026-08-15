import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const { message } = await api.forgotPassword(email);
      setMessage(message);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-12 sm:px-6 sm:py-20">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Reset your password</h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
        Enter your email and we'll send you a link to reset your password.
      </p>

      {message ? (
        <p className="mt-8 rounded-md bg-emerald-50 p-4 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">{message}</p>
      ) : (
        <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-indigo-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            />
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 min-h-11 rounded-md bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {submitting ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}

      <p className="mt-6 text-sm text-slate-600 dark:text-slate-400">
        <Link to="/login" className="font-medium text-indigo-600 hover:text-indigo-500">
          Back to log in
        </Link>
      </p>
    </div>
  );
}
