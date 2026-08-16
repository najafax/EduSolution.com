import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';

export default function Settings() {
  const { token, can } = useAuth();
  const canManageSettings = can('settings', 'manage');
  const canManageImport = can('import', 'manage');
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
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Business settings</h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
        This information appears on every quote, invoice, and receipt PDF.
      </p>

      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <fieldset disabled={!canManageSettings} className="contents">
          <ImageField
            label="Logo"
            value={form.logo_image}
            onChange={(v) => setForm((f) => ({ ...f, logo_image: v }))}
            onError={setError}
            hint="Printed at the top-left of every quote/invoice/receipt PDF, next to the business name."
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Business name" value={form.business_name} onChange={(v) => setForm((f) => ({ ...f, business_name: v }))} />
            <Field label="Email" type="email" value={form.email} onChange={(v) => setForm((f) => ({ ...f, email: v }))} />
            <Field label="Phone" value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v }))} />
            <Field label="Tax ID (TIN)" value={form.tax_id} onChange={(v) => setForm((f) => ({ ...f, tax_id: v }))} />
          </div>
          <Field label="Address" value={form.address} onChange={(v) => setForm((f) => ({ ...f, address: v }))} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Currency symbol" value={form.currency_symbol} onChange={(v) => setForm((f) => ({ ...f, currency_symbol: v }))} />
            <label className="block">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">PDF template</span>
              <select
                value={form.pdf_template}
                onChange={(e) => setForm((f) => ({ ...f, pdf_template: e.target.value }))}
                className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none disabled:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:disabled:bg-slate-800"
              >
                <option value="modern">Modern — logo, colors, signature/stamp images</option>
                <option value="minimal">Minimal — plain black &amp; white, text-only signature</option>
              </select>
            </label>
          </div>
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Bank / payment details</span>
            <textarea
              value={form.bank_details}
              onChange={(e) => setForm((f) => ({ ...f, bank_details: e.target.value }))}
              rows={2}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none disabled:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:disabled:bg-slate-800"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Session timeout (minutes)</span>
              <input
                type="number"
                min="1"
                max="480"
                step="1"
                value={form.session_timeout_minutes}
                onChange={(e) => setForm((f) => ({ ...f, session_timeout_minutes: e.target.value }))}
                className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none disabled:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:disabled:bg-slate-800"
              />
            </label>
            <Field
              label="Authorized signatory's name"
              value={form.signatory_name}
              onChange={(v) => setForm((f) => ({ ...f, signatory_name: v }))}
            />
          </div>
          <span className="block text-xs text-slate-500 dark:text-slate-400">
            Session timeout: everyone is warned and then logged out after that many minutes of inactivity. PDF template applies to every quote/invoice/receipt generated from now on.
          </span>

          <div className="grid gap-3 sm:grid-cols-2">
            <ImageField
              label="Authorized signature"
              value={form.signature_image}
              onChange={(v) => setForm((f) => ({ ...f, signature_image: v }))}
              onError={setError}
              hint="Printed on quote/invoice PDFs above an “Authorized Signature” line."
            />
            <ImageField
              label="Company stamp"
              value={form.stamp_image}
              onChange={(v) => setForm((f) => ({ ...f, stamp_image: v }))}
              onError={setError}
              hint="Printed on quote/invoice PDFs next to the signature."
            />
          </div>
        </fieldset>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        {success && <p className="text-sm text-emerald-600 dark:text-emerald-400">Saved.</p>}

        {canManageSettings && (
          <button
            type="submit"
            disabled={submitting}
            className="min-h-11 self-start rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500 disabled:opacity-60"
          >
            {submitting ? 'Saving…' : 'Save'}
          </button>
        )}
      </form>

      {canManageImport && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Historical data</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Bring in existing clients, expenses, or invoices (with payment history) from a CSV file.
          </p>
          <Link
            to="/import"
            className="mt-3 inline-flex min-h-11 items-center rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Import historical data →
          </Link>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, type = 'text' }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
      />
    </label>
  );
}

// Matches routes/settings.js's own limits — PNG/JPEG only (all PDFKit
// supports), capped at 400KB so a business rarely uploads either of these
// again and every future GET/PUT /api/settings response doesn't balloon.
const MAX_IMAGE_BYTES = 400 * 1024;
const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg'];

function ImageField({ label, value, onChange, onError, hint }) {
  function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    onError('');
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      onError(`${label} must be a PNG or JPEG image`);
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      onError(`${label} must be smaller than 400KB`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onChange(reader.result);
    reader.onerror = () => onError(`Could not read the selected file for ${label}`);
    reader.readAsDataURL(file);
  }

  return (
    <div className="block">
      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
      {value ? (
        <div className="mt-1 flex items-center gap-3">
          <img src={value} alt={label} className="h-16 max-w-[160px] rounded-md border border-slate-200 object-contain dark:border-slate-700" />
          <button
            type="button"
            onClick={() => onChange('')}
            className="min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Remove
          </button>
        </div>
      ) : (
        <input
          type="file"
          accept="image/png,image/jpeg"
          onChange={handleFile}
          className="mt-1 block w-full text-sm text-slate-600 file:mr-3 file:min-h-11 file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-50 dark:text-slate-400 dark:file:border-slate-600 dark:file:bg-slate-800 dark:file:text-slate-200 dark:hover:file:bg-slate-700"
        />
      )}
      {hint && <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{hint}</span>}
    </div>
  );
}
