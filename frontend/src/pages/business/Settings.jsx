import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';

export default function Settings() {
  const { token } = useAuth();
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.settings
      .get(token)
      .then(({ settings }) => setForm(settings))
      .catch((err) => setError(err.message));
  }, [token]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess(false);
    setSubmitting(true);
    try {
      const { settings } = await api.settings.update(form, token);
      setForm(settings);
      setSuccess(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!form) {
    return <div className="mx-auto max-w-2xl px-4 py-10 text-sm text-slate-500 sm:px-6">{error || 'Loading…'}</div>;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-bold text-slate-900">Business settings</h1>
      <p className="mt-2 text-sm text-slate-600">
        This information appears on every quote, invoice, and receipt PDF.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <Field label="Business name" value={form.business_name} onChange={(v) => setForm((f) => ({ ...f, business_name: v }))} />
        <Field label="Email" type="email" value={form.email} onChange={(v) => setForm((f) => ({ ...f, email: v }))} />
        <Field label="Phone" value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v }))} />
        <Field label="Address" value={form.address} onChange={(v) => setForm((f) => ({ ...f, address: v }))} />
        <Field label="Tax ID" value={form.tax_id} onChange={(v) => setForm((f) => ({ ...f, tax_id: v }))} />
        <Field label="Currency symbol" value={form.currency_symbol} onChange={(v) => setForm((f) => ({ ...f, currency_symbol: v }))} />
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Bank / payment details</span>
          <textarea
            value={form.bank_details}
            onChange={(e) => setForm((f) => ({ ...f, bank_details: e.target.value }))}
            rows={3}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-indigo-500 focus:outline-none"
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {success && <p className="text-sm text-emerald-600">Saved.</p>}

        <button
          type="submit"
          disabled={submitting}
          className="min-h-11 self-start rounded-md bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          {submitting ? 'Saving…' : 'Save'}
        </button>
      </form>

      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Historical data</h2>
        <p className="mt-1 text-sm text-slate-600">
          Bring in existing clients, expenses, or invoices (with payment history) from a CSV file.
        </p>
        <Link
          to="/import"
          className="mt-3 inline-flex min-h-11 items-center rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Import historical data →
        </Link>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text' }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-indigo-500 focus:outline-none"
      />
    </label>
  );
}
