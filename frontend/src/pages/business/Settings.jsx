import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { resizeImage, dataUriByteLength } from '../../lib/imageResize';
import { ImageIcon, BuildingIcon, BankIcon, ShieldIcon, DatabaseIcon, ChevronRightIcon } from '../../components/icons';
import MeterBar from '../../components/MeterBar';

// Five sections, same real fields the single long form always had — just
// grouped and laid out two ways below (a mobile collapsible-card stack, a
// desktop section-rail + content panel), per the three mockup directions
// reviewed on the design canvas. Both layouts read from this one list so
// they can never drift on which sections exist or what order they're in.
const SECTIONS = [
  { key: 'letterheads', title: 'Letterheads & branding', Icon: ImageIcon },
  { key: 'business', title: 'Business details', Icon: BuildingIcon },
  { key: 'financial', title: 'Financial', Icon: BankIcon },
  { key: 'security', title: 'Security & session', Icon: ShieldIcon },
  { key: 'data', title: 'Data', Icon: DatabaseIcon },
];

function formatBytes(bytes) {
  if (bytes == null || !Number.isFinite(bytes)) return null;
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let i = -1;
  do {
    value /= 1024;
    i += 1;
  } while (value >= 1024 && i < units.length - 1);
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

export default function Settings() {
  const { token, can } = useAuth();
  const canManageSettings = can('settings', 'manage');
  const canManageImport = can('import', 'manage');
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activeSection, setActiveSection] = useState('letterheads');

  // Independent of the settings form itself — a failed/slow storage read
  // should never block the rest of the page, so it gets its own state and
  // its own best-effort fetch rather than riding on `form`'s own load.
  const [storage, setStorage] = useState(null);
  const [storageError, setStorageError] = useState('');

  useEffect(() => {
    api.settings
      .get(token)
      .then(({ settings }) => setForm(settings))
      .catch((err) => setError(err.message));
  }, [token]);

  useEffect(() => {
    api.settings
      .getStorage(token)
      .then(setStorage)
      .catch((err) => setStorageError(err.message));
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
    return <div className="mx-auto max-w-2xl px-4 py-10 text-sm text-slate-500 dark:text-slate-400 sm:px-6">{error || 'Loading…'}</div>;
  }

  function sectionSummary(key) {
    switch (key) {
      case 'letterheads': {
        const count = [form.logo_image, form.signature_image, form.stamp_image].filter(Boolean).length;
        return `${count} of 3 images attached · ${form.pdf_template === 'minimal' ? 'Minimal' : 'Modern'} template`;
      }
      case 'business':
        return form.business_name || 'Not set yet';
      case 'financial':
        return `${form.currency_symbol || '$'} · Starting balance ${Number(form.starting_balance || 0).toFixed(2)}`;
      case 'security':
        return `${form.session_timeout_minutes || 30} min timeout${form.signatory_name ? ` · ${form.signatory_name}` : ''}`;
      case 'data': {
        const dbLabel = storage && formatBytes(storage.dbSizeBytes);
        return dbLabel ? `Database ${dbLabel}` : 'Import & storage';
      }
      default:
        return '';
    }
  }

  function renderSectionFields(key) {
    switch (key) {
      case 'letterheads':
        return (
          <>
            <ImageField
              label="Logo"
              value={form.logo_image}
              onChange={(v) => setForm((f) => ({ ...f, logo_image: v }))}
              onError={setError}
              hint="Printed at the top-left of every quote/invoice/receipt PDF, next to the business name."
            />
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
            <div className="block">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">PDF template</span>
              <div className="mt-1 inline-flex overflow-hidden rounded-md border border-slate-300 dark:border-slate-600">
                {[
                  { value: 'modern', label: 'Modern' },
                  { value: 'minimal', label: 'Minimal' },
                ].map(({ value, label }, i) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, pdf_template: value }))}
                    className={`min-h-11 border-slate-300 px-4 text-sm font-medium transition dark:border-slate-600 ${i === 0 ? 'border-r' : ''} ${
                      form.pdf_template === value
                        ? 'bg-lagoon-600 text-white'
                        : 'bg-white text-slate-600 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                Modern prints the logo, lagoon accent colour, and signature/stamp images. Minimal is plain black &amp; white with a
                text‑only signature line.
              </span>
            </div>
          </>
        );

      case 'business':
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Business name" value={form.business_name} onChange={(v) => setForm((f) => ({ ...f, business_name: v }))} />
              <Field label="Email" type="email" value={form.email} onChange={(v) => setForm((f) => ({ ...f, email: v }))} />
              <Field label="Phone" value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v }))} />
              <Field label="Tax ID (TIN)" value={form.tax_id} onChange={(v) => setForm((f) => ({ ...f, tax_id: v }))} />
            </div>
            <Field label="Address" value={form.address} onChange={(v) => setForm((f) => ({ ...f, address: v }))} />
          </>
        );

      case 'financial':
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Currency symbol"
                value={form.currency_symbol}
                onChange={(v) => setForm((f) => ({ ...f, currency_symbol: v }))}
              />
              <label className="block">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Starting bank balance</span>
                <input
                  type="number"
                  step="0.01"
                  value={form.starting_balance}
                  onChange={(e) => setForm((f) => ({ ...f, starting_balance: e.target.value }))}
                  className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none disabled:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:disabled:bg-slate-800"
                />
              </label>
            </div>
            <span className="-mt-1 block text-xs text-slate-500 dark:text-slate-400">
              Your account balance on the day you started using this app. Financials adds every payment collected and subtracts
              every expense recorded since to show a running current balance.
            </span>
            <label className="block">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Bank / payment details</span>
              <textarea
                value={form.bank_details}
                onChange={(e) => setForm((f) => ({ ...f, bank_details: e.target.value }))}
                rows={3}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none disabled:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:disabled:bg-slate-800"
              />
            </label>
          </>
        );

      case 'security':
        return (
          <>
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
              Everyone is warned and then logged out after this many minutes of inactivity, regardless of role.
            </span>
          </>
        );

      case 'data':
        return (
          <div className="flex flex-col gap-4">
            {canManageImport && (
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Historical data</h3>
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
            <StorageReadout storage={storage} storageError={storageError} />
          </div>
        );

      default:
        return null;
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:max-w-4xl sm:px-6">
      <h1 className="font-display text-2xl font-extrabold text-slate-900 dark:text-white">Business settings</h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
        This information appears on every quote, invoice, and receipt PDF.
      </p>

      <form onSubmit={handleSubmit} className="mt-4">
        <fieldset disabled={!canManageSettings} className="contents">
          {/* Mobile — collapsible section cards */}
          <div className="flex flex-col gap-3 sm:hidden">
            {SECTIONS.map(({ key, title, Icon }) => (
              <details
                key={key}
                open={key === 'letterheads'}
                className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900"
              >
                <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 [&::-webkit-details-marker]:hidden">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-lagoon-50 text-lagoon-700 dark:bg-lagoon-950 dark:text-lagoon-300">
                    <Icon width={17} height={17} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-slate-900 dark:text-white">{title}</span>
                    <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{sectionSummary(key)}</span>
                  </span>
                  <ChevronRightIcon className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-90" />
                </summary>
                <div className="flex flex-col gap-3 border-t border-slate-200 px-4 pb-4 pt-3 dark:border-slate-700">
                  {renderSectionFields(key)}
                </div>
              </details>
            ))}
          </div>

          {/* Desktop — section rail + content panel */}
          <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:grid sm:grid-cols-[220px_1fr]">
            <nav className="flex flex-col gap-0.5 border-r border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
              {SECTIONS.map(({ key, title, Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveSection(key)}
                  className={`flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-left text-sm font-medium transition ${
                    activeSection === key
                      ? 'bg-lagoon-600 text-white'
                      : 'text-slate-600 hover:bg-slate-200/60 dark:text-slate-300 dark:hover:bg-slate-700/60'
                  }`}
                >
                  <Icon width={16} height={16} />
                  {title}
                </button>
              ))}
            </nav>
            <div className="flex flex-col gap-4 p-6">
              <div>
                <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                  {SECTIONS.find((s) => s.key === activeSection)?.title}
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{sectionSummary(activeSection)}</p>
              </div>
              {renderSectionFields(activeSection)}
            </div>
          </div>
        </fieldset>

        <div className="mt-4 flex flex-col gap-3">
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          {success && <p className="text-sm text-emerald-600 dark:text-emerald-400">Saved.</p>}
          {canManageSettings && (
            <button
              type="submit"
              disabled={submitting}
              className="min-h-11 self-start rounded-md bg-lagoon-600 px-5 text-sm font-medium text-white hover:bg-lagoon-500 disabled:opacity-60"
            >
              {submitting ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function StorageReadout({ storage, storageError }) {
  if (storageError) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Storage</h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Storage usage isn't available right now.</p>
      </div>
    );
  }
  if (!storage) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Storage</h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Loading…</p>
      </div>
    );
  }

  const dbLabel = formatBytes(storage.dbSizeBytes) || '—';
  const hasDisk = storage.diskFreeBytes != null && storage.diskTotalBytes > 0;
  const usedPct = hasDisk ? ((storage.diskTotalBytes - storage.diskFreeBytes) / storage.diskTotalBytes) * 100 : 0;
  const diskTone = usedPct >= 90 ? 'red' : usedPct >= 75 ? 'amber' : 'lagoon';

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Storage</h3>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        Database {dbLabel}
        {hasDisk && (
          <>
            {' '}
            · {formatBytes(storage.diskFreeBytes)} free of {formatBytes(storage.diskTotalBytes)}
          </>
        )}
      </p>
      {hasDisk && (
        <div className="mt-3">
          <MeterBar label="Disk used" pct={usedPct} color={diskTone} />
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
  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    onError('');
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      onError(`${label} must be a PNG or JPEG image`);
      return;
    }
    try {
      // A logo/signature/stamp is never printed larger than a few hundred
      // px in the PDF header (see lib/pdf.js), so a phone-photographed or
      // export-at-full-resolution source is downscaled well before it ever
      // risks tripping the 400KB cap below.
      const dataUri = await resizeImage(file, { maxDimension: 1000 });
      if (dataUriByteLength(dataUri) > MAX_IMAGE_BYTES) {
        onError(`${label} is still too large after resizing — please use a smaller or simpler image`);
        return;
      }
      onChange(dataUri);
    } catch (err) {
      onError(err.message || `Could not read the selected file for ${label}`);
    }
  }

  return (
    <div className="block">
      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
      {value ? (
        // Deliberately no <img> preview here — this renders as a plain file
        // attachment (icon + "uploaded" label) rather than showing the image
        // itself. The stored value/upload flow is unchanged: still a base64
        // data URI in the same field, still what lib/pdf.js prints on every
        // quote/invoice/receipt.
        <div className="mt-1 flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white text-slate-500 dark:bg-slate-900 dark:text-slate-400">
            <ImageIcon width={18} height={18} />
          </span>
          <span className="flex-1 text-sm text-slate-700 dark:text-slate-300">{label} attached</span>
          <label className="flex min-h-11 cursor-pointer items-center rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-white dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">
            Replace
            <input type="file" accept="image/png,image/jpeg" onChange={handleFile} className="hidden" />
          </label>
          <button
            type="button"
            onClick={() => onChange('')}
            className="min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-white dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
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
