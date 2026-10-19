import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { resizeImage, dataUriByteLength } from '../../lib/imageResize';
import {
  ImageIcon,
  BuildingIcon,
  BankIcon,
  ShieldIcon,
  DatabaseIcon,
  ChevronRightIcon,
  SettingsIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
} from '../../components/icons';
import MeterBar from '../../components/MeterBar';

// Five sections, same real fields the single long form always had — just
// grouped and laid out two ways below (a mobile collapsible-card stack, a
// desktop section-rail + content panel), per the three mockup directions
// reviewed on the design canvas. Both layouts read from this one list so
// they can never drift on which sections exist or what order they're in.
const GROUPS = ['General', 'Finance', 'System'];
const OPEN_KEY = 'settings:open';
const SECTIONS = [
  { key: 'letterheads', group: 'General', title: 'Letterheads & branding', Icon: ImageIcon },
  { key: 'business', group: 'General', title: 'Business details', Icon: BuildingIcon },
  { key: 'financial', group: 'Finance', title: 'Financial', Icon: BankIcon },
  { key: 'security', group: 'System', title: 'Security & session', Icon: ShieldIcon },
  { key: 'data', group: 'System', title: 'Data', Icon: DatabaseIcon },
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

// How many hours ago an ISO backup timestamp was — mirrors
// backend/telegram-bot/bot.js's own TELEGRAM_BACKUP_STALE_HOURS staleness
// check (default 26h) so the Settings page's own "stale backup" alert
// below agrees with what the Telegram bot would also be alerting on.
const BACKUP_STALE_HOURS = 26;

function hoursSince(isoString) {
  if (!isoString) return null;
  const then = new Date(isoString).getTime();
  if (!Number.isFinite(then)) return null;
  return (Date.now() - then) / (1000 * 60 * 60);
}

function backupAgeLabel(isoString) {
  const hours = hoursSince(isoString);
  if (hours == null) return 'never';
  if (hours < 1) return 'less than an hour ago';
  if (hours < 48) return `${Math.round(hours)} hour${Math.round(hours) === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function useIsDesktop() {
  const query = '(min-width: 768px)';
  const [match, setMatch] = useState(() => (typeof window === 'undefined' ? true : window.matchMedia(query).matches));
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return match;
}

function loadOpen() {
  try {
    const raw = JSON.parse(localStorage.getItem(OPEN_KEY) ?? 'null');
    if (Array.isArray(raw)) return raw.filter((x) => SECTIONS.some((sec) => sec.key === x));
  } catch {
    /* storage unavailable: use the default */
  }
  return ['letterheads'];
}

export default function Settings() {
  const { token, can } = useAuth();
  const canManageSettings = can('settings', 'manage');
  const canManageImport = can('import', 'manage');
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const isDesktop = useIsDesktop();
  const [open, setOpen] = useState(loadOpen);
  const [active, setActive] = useState(null); // phone: the one section being edited

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
        return `${form.currency_symbol || '$'} · Starting balance ${Number(form.starting_balance || 0).toFixed(2)}${form.starting_balance_date ? ` as of ${form.starting_balance_date}` : ''}`;
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
                        ? 'bg-slate-900 dark:bg-lagoon-600 text-white'
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
            <Field
              label="Starting balance date (optional)"
              type="date"
              value={form.starting_balance_date || ''}
              onChange={(v) => setForm((f) => ({ ...f, starting_balance_date: v }))}
            />
            <span className="-mt-1 block text-xs text-slate-500 dark:text-slate-400">
              The starting balance is your account balance at the start of this date. Financials then adds every payment,
              contribution and return dated on or after it, and subtracts every expense, draw and distribution. Anything dated
              earlier is left out of the bank balance, so older history can't distort it. Leave blank to count everything recorded.
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

  function setOpenPersist(next) {
    setOpen(next);
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }
  const toggleSection = (key) => setOpenPersist(open.includes(key) ? open.filter((x) => x !== key) : [...open, key]);
  function jumpTo(key) {
    if (!open.includes(key)) setOpenPersist([...open, key]);
    setTimeout(() => document.getElementById(`settings-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }
  function choose(key) {
    setActive(key);
    window.scrollTo({ top: 0 });
  }
  const activeDef = SECTIONS.find((sec) => sec.key === active) || null;
  const showSave = canManageSettings && (isDesktop || activeDef);

  const feedback = (
    <div className="mt-4 flex flex-col gap-3">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {success && <p className="text-sm text-emerald-600 dark:text-emerald-400">Saved.</p>}
      {showSave && (
        <button
          type="submit"
          disabled={submitting}
          className="min-h-11 self-start rounded-md bg-slate-900 px-5 text-sm font-medium text-white hover:bg-slate-700 dark:bg-lagoon-600 dark:hover:bg-lagoon-500 disabled:opacity-60"
        >
          {submitting ? 'Saving…' : 'Save'}
        </button>
      )}
    </div>
  );

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <form onSubmit={handleSubmit}>
        <fieldset disabled={!canManageSettings} className="contents">
          {!isDesktop && activeDef ? (
            // Phone: one section at a time, with a back link to the menu.
            <div>
              <button
                type="button"
                onClick={() => choose(null)}
                className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-lagoon-700 dark:text-lagoon-400"
              >
                <ChevronRightIcon className="h-4 w-4 rotate-180" /> Settings
              </button>
              <h1 className="font-display text-2xl font-extrabold text-slate-900 dark:text-white">{activeDef.title}</h1>
              <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">{sectionSummary(activeDef.key)}</p>
              <div className="flex flex-col gap-3 rounded-3xl bg-white p-4 shadow-sm dark:border dark:border-slate-700 dark:bg-slate-900">
                {renderSectionFields(activeDef.key)}
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 pb-4">
                <SettingsIcon className="h-7 w-7 text-lagoon-600" />
                <div>
                  <h1 className="font-display text-2xl font-extrabold text-slate-900 dark:text-white">Business settings</h1>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {isDesktop ? 'Open a section to change it. This appears on every quote, invoice and receipt PDF.' : 'Manage your business details and PDFs.'}
                  </p>
                </div>
              </div>

              {isDesktop ? (
                <div className="flex items-start gap-8">
                  <div className="min-w-0 flex-1 space-y-4">
                    {SECTIONS.map(({ key, title, Icon }) => {
                      const isOpen = open.includes(key);
                      return (
                        <section
                          key={key}
                          id={`settings-${key}`}
                          className="scroll-mt-24 overflow-hidden rounded-3xl bg-white shadow-sm dark:border dark:border-slate-700 dark:bg-slate-900"
                        >
                          <button
                            type="button"
                            onClick={() => toggleSection(key)}
                            aria-expanded={isOpen}
                            className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50"
                          >
                            <span className="flex items-center gap-3">
                              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-lagoon-50 text-lagoon-700 dark:bg-lagoon-950 dark:text-lagoon-300">
                                <Icon width={18} height={18} />
                              </span>
                              <span>
                                <span className="block font-semibold text-slate-900 dark:text-white">{title}</span>
                                <span className="block text-xs text-slate-500 dark:text-slate-400">{sectionSummary(key)}</span>
                              </span>
                            </span>
                            <ChevronRightIcon className={`h-5 w-5 shrink-0 text-slate-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                          </button>
                          {isOpen && (
                            <div className="flex flex-col gap-3 border-t border-slate-100 px-5 pb-5 pt-4 dark:border-slate-700">
                              {renderSectionFields(key)}
                            </div>
                          )}
                        </section>
                      );
                    })}
                  </div>
                  <nav
                    aria-label="Jump to a section"
                    className="sticky top-24 hidden w-52 shrink-0 border-l-2 border-slate-200 pl-4 dark:border-slate-700 xl:block"
                  >
                    {SECTIONS.map(({ key, title }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => jumpTo(key)}
                        className={`block w-full py-1.5 text-left text-sm hover:text-slate-900 dark:hover:text-white ${
                          open.includes(key) ? 'font-medium text-lagoon-700 dark:text-lagoon-400' : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {title}
                      </button>
                    ))}
                  </nav>
                </div>
              ) : (
                <div>
                  {GROUPS.map((g) => (
                    <div key={g} className="mb-5">
                      <p className="mb-1.5 px-1 text-[11px] font-bold uppercase tracking-widest text-slate-400">{g}</p>
                      <div className="divide-y divide-slate-100 overflow-hidden rounded-3xl bg-white shadow-sm dark:divide-slate-700 dark:border dark:border-slate-700 dark:bg-slate-900">
                        {SECTIONS.filter((sec) => sec.group === g).map(({ key, title, Icon }) => (
                          <button
                            key={key}
                            type="button"
                            onClick={() => choose(key)}
                            className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-slate-50 dark:active:bg-slate-800"
                          >
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-lagoon-50 text-lagoon-700 dark:bg-lagoon-950 dark:text-lagoon-300">
                              <Icon width={17} height={17} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-medium text-slate-900 dark:text-white">{title}</span>
                              <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{sectionSummary(key)}</span>
                            </span>
                            <ChevronRightIcon className="h-4 w-4 shrink-0 text-slate-400" />
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </fieldset>
        {feedback}
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
  const walLabel = formatBytes(storage.walSizeBytes);
  const hasDisk = storage.diskFreeBytes != null && storage.diskTotalBytes > 0;
  const usedBytes = hasDisk ? storage.diskTotalBytes - storage.diskFreeBytes : 0;
  const usedPct = hasDisk ? (usedBytes / storage.diskTotalBytes) * 100 : 0;
  const diskTone = usedPct >= 90 ? 'red' : usedPct >= 75 ? 'amber' : 'lagoon';

  const backupHours = storage.backupConfigured ? hoursSince(storage.lastDailyBackupAt) : null;
  const backupStale = storage.backupConfigured && (backupHours == null || backupHours > BACKUP_STALE_HOURS);

  // Mirrors the Telegram ops bot's own alert thresholds (85%/90% disk,
  // 26h backup staleness — see backend/telegram-bot/bot.js) so the same
  // conditions that would page an admin on their phone also surface
  // directly on this page, rather than only ever being visible there.
  const alerts = [];
  if (hasDisk && usedPct >= 90) {
    alerts.push({ level: 'red', text: `Disk space critically low — ${usedPct.toFixed(0)}% used. Free up space soon to avoid write failures.` });
  } else if (hasDisk && usedPct >= 75) {
    alerts.push({ level: 'amber', text: `Disk space is getting full — ${usedPct.toFixed(0)}% used.` });
  }
  if (backupStale) {
    alerts.push({
      level: 'red',
      text:
        storage.lastDailyBackupAt == null
          ? 'No backup has ever completed for this database.'
          : `No backup has completed in over ${BACKUP_STALE_HOURS} hours (last one was ${backupAgeLabel(storage.lastDailyBackupAt)}).`,
    });
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Storage</h3>

      {alerts.map((a, i) => (
        <div
          key={i}
          className={`mt-2 flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${
            a.level === 'red'
              ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300'
              : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300'
          }`}
        >
          <AlertTriangleIcon width={14} height={14} className="mt-0.5 shrink-0" />
          <span>{a.text}</span>
        </div>
      ))}

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <div>
          <dt className="text-slate-500 dark:text-slate-400">Database file</dt>
          <dd className="font-medium text-slate-900 dark:text-white">{dbLabel}</dd>
        </div>
        {walLabel && (
          <div>
            <dt className="text-slate-500 dark:text-slate-400">Write-ahead log</dt>
            <dd className="font-medium text-slate-900 dark:text-white">{walLabel}</dd>
          </div>
        )}
        {hasDisk && (
          <>
            <div>
              <dt className="text-slate-500 dark:text-slate-400">Disk used</dt>
              <dd className="font-medium text-slate-900 dark:text-white">
                {formatBytes(usedBytes)} of {formatBytes(storage.diskTotalBytes)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500 dark:text-slate-400">Disk free</dt>
              <dd className="font-medium text-slate-900 dark:text-white">{formatBytes(storage.diskFreeBytes)}</dd>
            </div>
          </>
        )}
        <div>
          <dt className="text-slate-500 dark:text-slate-400">Backups</dt>
          <dd className="flex items-center gap-1 font-medium text-slate-900 dark:text-white">
            {!storage.backupConfigured ? (
              <span className="text-slate-500 dark:text-slate-400">Not configured</span>
            ) : (
              <>
                {!backupStale && <CheckCircleIcon width={13} height={13} className="shrink-0 text-emerald-600 dark:text-emerald-400" />}
                Last daily: {backupAgeLabel(storage.lastDailyBackupAt)}
              </>
            )}
          </dd>
        </div>
        {storage.backupConfigured && storage.lastWeeklyBackupAt && (
          <div>
            <dt className="text-slate-500 dark:text-slate-400">Last weekly backup</dt>
            <dd className="font-medium text-slate-900 dark:text-white">{backupAgeLabel(storage.lastWeeklyBackupAt)}</dd>
          </div>
        )}
      </dl>

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
