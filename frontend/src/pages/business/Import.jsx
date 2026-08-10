import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../lib/api';

const TYPES = [
  { value: 'clients', label: 'Clients', columns: 'name*, email*, phone, address, notes' },
  { value: 'expenses', label: 'Expenses', columns: 'category*, description*, amount*, expense_date*, notes' },
  {
    value: 'invoices',
    label: 'Invoices (+ payments)',
    columns:
      'client_email*, number, issue_date*, due_date, description, amount*, tax_rate, amount_paid, paid_date, payment_method, status, notes',
  },
];

const TEMPLATES = {
  clients: 'name,email,phone,address,notes\nAcme School,jane@example.com,+960 7000000,"Male, Maldives",Sample notes\n',
  expenses: 'category,description,amount,expense_date,notes\nrent,Office rent for March,15000,2026-03-01,\n',
  invoices:
    'client_email,number,issue_date,due_date,description,amount,tax_rate,amount_paid,paid_date,payment_method,status,notes\n' +
    'jane@example.com,,2024-01-15,2024-01-29,Website design,2000,0,2000,2024-01-20,bank_transfer,,Fully paid example\n' +
    'jane@example.com,,2024-02-01,2024-02-15,Consulting,1500,10,0,,,,Not yet paid — leave amount_paid/paid_date blank\n',
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

function ResultsTable({ results }) {
  return (
    <div className="mt-4 max-h-96 overflow-y-auto rounded-md border border-slate-200">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="sticky top-0 bg-slate-50">
          <tr className="text-left text-xs font-medium uppercase text-slate-500">
            <th className="px-4 py-2">Row</th>
            <th className="px-4 py-2">Status</th>
            <th className="px-4 py-2">Item</th>
            <th className="px-4 py-2">Message</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {results.map((r) => (
            <tr key={r.row}>
              <td className="whitespace-nowrap px-4 py-2 text-slate-500">{r.row}</td>
              <td className="whitespace-nowrap px-4 py-2">
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                    r.status === 'ok' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                  }`}
                >
                  {r.status === 'ok' ? 'OK' : 'Error'}
                </span>
              </td>
              <td className="whitespace-nowrap px-4 py-2 text-slate-700">{r.preview}</td>
              <td className="px-4 py-2 text-slate-600">{r.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Import() {
  const { token, can } = useAuth();
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
    return <div className="mx-auto max-w-4xl px-4 py-10 text-sm text-slate-500 sm:px-6">You don't have permission to view this page.</div>;
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-bold text-slate-900">Import historical data</h1>
      <p className="mt-2 text-sm text-slate-600">
        Bring in existing clients, expenses, or invoices (with payment history) from a CSV file. Preview
        first to catch errors — nothing is saved until you confirm.
      </p>
      {type === 'invoices' && (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Import clients first if you haven't already — each invoice row is matched to a client by email.
        </p>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        {TYPES.map((t) => (
          <button
            key={t.value}
            onClick={() => handleTypeChange(t.value)}
            className={`min-h-11 rounded-md px-4 text-sm font-medium ${
              type === t.value ? 'bg-indigo-600 text-white' : 'border border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-medium text-slate-700">Expected columns</p>
        <p className="mt-1 break-words font-mono text-xs text-slate-600">{current.columns}</p>
        <p className="mt-1 text-xs text-slate-400">* required</p>
        <button
          onClick={() => downloadTemplate(type)}
          className="mt-3 min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Download {current.label} template
        </button>

        <div className="mt-6">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">CSV file</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={handleFile}
              className="mt-1 block w-full text-sm text-slate-600 file:mr-4 file:min-h-11 file:rounded-md file:border-0 file:bg-indigo-50 file:px-4 file:text-sm file:font-medium file:text-indigo-700 hover:file:bg-indigo-100"
            />
          </label>
          {fileName && <p className="mt-1 text-xs text-slate-500">Selected: {fileName}</p>}
        </div>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <div className="mt-4">
          <button
            onClick={handlePreview}
            disabled={!csvText || busy}
            className="min-h-11 rounded-md bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {busy ? 'Working…' : 'Preview'}
          </button>
        </div>
      </div>

      {preview && (
        <div className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-900">
              Preview: {preview.validCount} of {preview.total} row(s) ready to import
              {preview.errorCount > 0 && <span className="text-red-600"> ({preview.errorCount} with errors)</span>}
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
          <ResultsTable results={preview.results} />
        </div>
      )}

      {committed && (
        <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-6">
          <h2 className="text-sm font-semibold text-emerald-900">
            Imported {committed.imported} of {committed.total} row(s)
            {committed.errorCount > 0 && ` — ${committed.errorCount} skipped`}
          </h2>
          <ResultsTable results={committed.results} />
        </div>
      )}
    </div>
  );
}
