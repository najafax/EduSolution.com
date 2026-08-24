import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../lib/api';
import { useConfirm } from '../../lib/useConfirm';
import ImportResultsTable from '../../components/ImportResultsTable';

const TYPES = [
  { value: 'clients', label: 'Clients', columns: 'name*, email*, phone, address, notes' },
  {
    value: 'expenses',
    label: 'Expenses',
    columns:
      'category*, description*, amount*, expense_date*, payee, notes, exchange_rate (required for currency exchange), payee_account_number, usd_destination',
  },
  {
    value: 'invoices',
    label: 'Invoices (+ payments)',
    columns:
      'client_email or client_name (at least one)*, number, issue_date*, due_date, description, amount*, tax_rate, amount_paid, paid_date, payment_method, status, notes',
  },
  {
    value: 'quotes',
    label: 'Quotes',
    columns:
      'client_email or client_name (at least one)*, number, issue_date*, expiry_date, description, amount*, tax_rate, status, notes',
  },
  {
    value: 'licenses',
    label: 'Licenses',
    columns:
      'client_email or client_name (at least one)*, name*, billing_cycle, amount, start_date*, expiry_date, status, url, notes',
    note: "Multiple rows with the same client and license name are treated as one license's renewal history, not separate licenses — the row with the latest start_date becomes the current record, and every earlier row becomes a past renewal.",
  },
  {
    value: 'products',
    label: 'Products',
    columns: 'name*, description, unit_price*, tax_rate, visible_in_portal',
    note: 'A row matching an existing product by name (case-insensitive) updates it in place instead of creating a duplicate — safe to re-import an edited export.',
  },
  {
    value: 'currency-exchange',
    label: 'Currency exchange',
    columns: 'description*, amount*, expense_date*, exchange_rate*, payee, payee_account_number, usd_destination, notes',
    note: "Every row is imported as an expense with category \"currency exchange\" — there's no category column, since this type is only for that one category. Same as importing under the general Expenses type with every row's category already set.",
  },
];

const TEMPLATES = {
  clients: 'name,email,phone,address,notes\nAcme School,jane@example.com,+960 7000000,"Male, Maldives",Sample notes\n',
  expenses:
    'category,description,amount,expense_date,payee,notes,exchange_rate,payee_account_number,usd_destination\n' +
    'rent,Office rent for March,15000,2026-03-01,,,,,\n' +
    'shareholder payments,Q1 dividend,5000,2026-03-15,Jane Doe,,,,\n' +
    'currency exchange,MVR to USD for EduPage renewal,15420,2026-03-20,,,15.42,7730000123456,EduPage license renewal\n',
  invoices:
    'client_email,client_name,number,issue_date,due_date,description,amount,tax_rate,amount_paid,paid_date,payment_method,status,notes\n' +
    'jane@example.com,,,2024-01-15,2024-01-29,Website design,2000,0,2000,2024-01-20,bank_transfer,,Fully paid example\n' +
    ',Acme School,,2024-02-01,2024-02-15,Consulting,1500,10,0,,,,Matched by client_name instead of email\n',
  quotes:
    'client_email,client_name,number,issue_date,expiry_date,description,amount,tax_rate,status,notes\n' +
    'jane@example.com,,,2024-01-15,2024-02-14,Website design proposal,2000,0,sent,Sent quote example\n' +
    ',Acme School,,2024-02-01,,Consulting package,1500,10,,Matched by client_name, status left blank (defaults to draft)\n',
  licenses:
    'client_email,client_name,name,billing_cycle,amount,start_date,expiry_date,status,url,notes\n' +
    'jane@example.com,,LMS Pro Annual License,yearly,1100,2024-08-16,2025-08-16,active,,First year — earlier row, becomes renewal history\n' +
    'jane@example.com,,LMS Pro Annual License,yearly,1200,2025-08-16,2026-08-16,active,https://lms.example.com/activate,Second year — latest start_date, becomes the current record\n' +
    ',Acme School,API Access License,monthly,50,2026-06-01,,active,,Matched by client_name; expiry_date left blank (defaults to start_date + 1 billing cycle)\n',
  products:
    'name,description,unit_price,tax_rate,visible_in_portal\n' +
    'LMS Pro Annual License,Learning management system — annual plan,1200,0,true\n' +
    'Consulting Hour,General consulting, billed hourly,75,0,false\n',
  'currency-exchange':
    'description,amount,expense_date,exchange_rate,payee,payee_account_number,usd_destination,notes\n' +
    'MVR to USD for EduPage renewal,15420,2026-03-20,15.42,,7730000123456,EduPage license renewal,\n' +
    'MVR to USD for hosting bill,3200,2026-04-02,15.55,,7730000123456,Annual hosting invoice,\n',
};

function downloadTemplate(type) {
  const blob = new Blob([TEMPLATES[type]], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${type}-import-template.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const CONFIRM_PHRASE = 'DELETE';

// Matches backend/src/routes/dataReset.js's CATEGORIES exactly — the
// server is the source of truth for which tables each key actually clears,
// this is just the checkbox list. "clients" forces quotes/invoices/
// recurring on too (see `forces` below) since those NOT NULL-reference
// client_id and the backend clears them regardless of whether they're
// individually ticked — forcing them here just keeps the UI honest about
// what will actually happen.
const RESET_CATEGORIES = [
  {
    key: 'clients',
    label: 'Clients',
    hint: 'Also deletes every quote, invoice, payment, recurring invoice, and license tied to them.',
    forces: ['quotes', 'invoices', 'recurring', 'licenses'],
  },
  { key: 'quotes', label: 'Quotes' },
  { key: 'invoices', label: 'Invoices & payments' },
  { key: 'recurring', label: 'Recurring invoice templates' },
  { key: 'licenses', label: 'Licenses' },
  { key: 'expenses', label: 'Expenses' },
  { key: 'capital_contributions', label: 'Capital contributions' },
  { key: 'products', label: 'Product catalog' },
  { key: 'activity', label: 'Activity log' },
];

const CLIENTS_FORCES = RESET_CATEGORIES.find((c) => c.key === 'clients').forces;

// Admin-only (checked by the caller, not just the import:manage permission
// every other section of this page is gated on — see routes/dataReset.js's
// requireAdmin) — bulk-deletes whichever categories are ticked, e.g. to
// clear out test data before importing real historical records. Login and
// business settings are never touched by the backend route regardless of
// what's selected here.
function DangerZone({ token }) {
  const [selected, setSelected] = useState(() => new Set());
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const { confirm, confirmDialog } = useConfirm();

  const canConfirm = confirmText === CONFIRM_PHRASE && selected.size > 0;

  function toggle(key) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
        const category = RESET_CATEGORIES.find((c) => c.key === key);
        category?.forces?.forEach((f) => next.add(f));
      }
      return next;
    });
  }

  async function handleClear() {
    if (!canConfirm) return;
    if (
      !(await confirm({
        title: 'Permanently delete this data?',
        message: 'This cannot be undone.',
        confirmLabel: 'Delete',
      }))
    )
      return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const res = await api.dataReset.run(CONFIRM_PHRASE, [...selected], token);
      setResult(res);
      setConfirmText('');
      setSelected(new Set());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-10 rounded-lg border border-red-300 bg-red-50 p-6 dark:border-red-800 dark:bg-red-950/40">
      <h2 className="text-sm font-semibold text-red-900 dark:text-red-300">Danger zone</h2>
      <p className="mt-1 text-sm text-red-800 dark:text-red-400">
        Tick the data you want permanently deleted — useful for clearing out test data before importing real
        historical records. Your login and business settings are never affected. This cannot be undone.
      </p>

      <div className="mt-4 flex flex-col gap-1">
        {RESET_CATEGORIES.map((c) => {
          const forcedOn = c.key !== 'clients' && selected.has('clients') && CLIENTS_FORCES.includes(c.key);
          return (
            <label key={c.key} className="flex min-h-11 items-start gap-2 py-1">
              <input
                type="checkbox"
                checked={selected.has(c.key)}
                onChange={() => toggle(c.key)}
                disabled={forcedOn}
                className="mt-3.5 h-4 w-4 shrink-0 rounded border-red-300 disabled:opacity-60"
              />
              <span className="flex flex-col justify-center text-sm text-red-800 dark:text-red-400">
                {c.label}
                {c.hint && <span className="text-xs text-red-600 dark:text-red-500">{c.hint}</span>}
                {forcedOn && <span className="text-xs text-red-600 dark:text-red-500">Included automatically with Clients.</span>}
              </span>
            </label>
          );
        })}
      </div>

      <label className="mt-4 block max-w-xs">
        <span className="text-sm font-medium text-red-900 dark:text-red-300">
          Type {CONFIRM_PHRASE} to confirm
        </span>
        <input
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={CONFIRM_PHRASE}
          className="mt-1 min-h-11 w-full rounded-md border border-red-300 px-3 py-2 text-base focus:border-red-500 focus:outline-none dark:border-red-700 dark:bg-slate-900 dark:text-white"
        />
      </label>

      {error && <p className="mt-3 text-sm text-red-700 dark:text-red-400">{error}</p>}
      {result && (
        <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-400">
          Cleared:{' '}
          {Object.entries(result.cleared)
            .filter(([, count]) => count > 0)
            .map(([t, count]) => `${count} ${t.replace(/_/g, ' ')}`)
            .join(', ') || 'nothing — everything was already empty'}
          .
        </p>
      )}

      <button
        onClick={handleClear}
        disabled={!canConfirm || busy}
        className="mt-4 min-h-11 rounded-md bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
      >
        {busy ? 'Clearing…' : `Clear selected data${selected.size ? ` (${selected.size})` : ''}`}
      </button>

      {confirmDialog}
    </div>
  );
}

export default function Import() {
  const { token, can, user } = useAuth();
  const canManage = can('import', 'manage');
  const [type, setType] = useState('clients');
  const [fileName, setFileName] = useState('');
  const [csvText, setCsvText] = useState('');
  const [preview, setPreview] = useState(null);
  const [committed, setCommitted] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function reset() {
    setPreview(null);
    setCommitted(null);
    setError('');
  }

  function handleTypeChange(next) {
    setType(next);
    setFileName('');
    setCsvText('');
    reset();
  }

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    reset();
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result || ''));
    reader.readAsText(file);
  }

  async function handlePreview() {
    if (!csvText) return;
    setBusy(true);
    setError('');
    setCommitted(null);
    try {
      const result = await api.import.run(type, csvText, false, token);
      setPreview(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm() {
    setBusy(true);
    setError('');
    try {
      const result = await api.import.run(type, csvText, true, token);
      setCommitted(result);
      setPreview(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const current = TYPES.find((t) => t.value === type);

  if (!canManage) {
    return <div className="px-4 py-10 text-sm text-slate-500 dark:text-slate-400 sm:px-6 lg:px-8">You don't have permission to view this page.</div>;
  }

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Import historical data</h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
        Bring in existing clients, expenses, invoices (with payment history), quotes, licenses, or products from a
        CSV file. Preview first to catch errors — nothing is saved until you confirm.
      </p>
      {(type === 'invoices' || type === 'quotes' || type === 'licenses') && (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          Import clients first if you haven't already — each {type === 'invoices' ? 'invoice' : type === 'quotes' ? 'quote' : 'license'} row is
          matched to a client by email, or by exact client name if client_email is left blank.
        </p>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        {TYPES.map((t) => (
          <button
            key={t.value}
            onClick={() => handleTypeChange(t.value)}
            className={`min-h-11 rounded-md px-4 text-sm font-medium ${
              type === t.value
                ? 'bg-lagoon-600 text-white'
                : 'border border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Expected columns</p>
        <p className="mt-1 break-words font-mono text-xs text-slate-600 dark:text-slate-400">{current.columns}</p>
        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">* required</p>
        {current.note && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{current.note}</p>}
        <button
          onClick={() => downloadTemplate(type)}
          className="mt-3 min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Download {current.label} template
        </button>

        <div className="mt-6">
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">CSV file</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={handleFile}
              className="mt-1 block w-full text-sm text-slate-600 file:mr-4 file:min-h-11 file:rounded-md file:border-0 file:bg-lagoon-50 file:px-4 file:text-sm file:font-medium file:text-lagoon-700 hover:file:bg-lagoon-100 dark:text-slate-400 dark:file:bg-lagoon-950 dark:file:text-lagoon-400 dark:hover:file:bg-lagoon-900"
            />
          </label>
          {fileName && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Selected: {fileName}</p>}
        </div>

        {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="mt-4">
          <button
            onClick={handlePreview}
            disabled={!csvText || busy}
            className="min-h-11 rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500 disabled:opacity-60"
          >
            {busy ? 'Working…' : 'Preview'}
          </button>
        </div>
      </div>

      {preview && (
        <div className="mt-6 rounded-lg border border-amber-300 bg-white shadow-sm dark:border-amber-700 dark:bg-slate-900">
          <p className="rounded-t-lg border-b border-amber-300 bg-amber-50 px-6 py-2 text-sm font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300">
            Preview only — nothing has been saved yet. Click "Confirm import" below to actually import these rows.
          </p>
          <div className="flex flex-wrap items-center justify-between gap-3 p-6">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              {preview.validCount} of {preview.total} row(s) ready to import
              {preview.errorCount > 0 && <span className="text-red-600 dark:text-red-400"> ({preview.errorCount} with errors)</span>}
            </h2>
            {preview.validCount > 0 && (
              <button
                onClick={handleConfirm}
                disabled={busy}
                className="min-h-11 rounded-md bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
              >
                {busy ? 'Importing…' : `Confirm import (${preview.validCount})`}
              </button>
            )}
          </div>
          <div className="px-6 pb-6">
            <ImportResultsTable results={preview.results} />
          </div>
        </div>
      )}

      {committed && (
        <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-6 dark:border-emerald-800 dark:bg-emerald-950">
          <h2 className="text-sm font-semibold text-emerald-900 dark:text-emerald-300">
            Imported {committed.imported} of {committed.total} row(s)
            {committed.errorCount > 0 && ` — ${committed.errorCount} skipped`}
          </h2>
          <ImportResultsTable results={committed.results} />
        </div>
      )}

      {user?.role === 'admin' && <DangerZone token={token} />}
    </div>
  );
}
