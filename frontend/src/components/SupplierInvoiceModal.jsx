import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import Modal from './Modal';
import SearchableSelect from './SearchableSelect';
import { PlusIcon, TrashIcon } from './icons';
import { todayStr } from '../lib/date';
import { resizeImage, dataUriByteLength } from '../lib/imageResize';

// Create / edit a supplier invoice: who billed you, the USD amount (always
// paid in full), an optional photo/PDF, and which client invoices it funds
// (several are fine; the amounts may add up to less than the bill, the rest
// shows as "not assigned"). A paid invoice can only have its links edited.
const INPUT =
  'mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:disabled:bg-slate-800';
const LABEL = 'text-sm font-medium text-slate-700 dark:text-slate-300';
const FILE_MAX_BYTES = 6 * 1024 * 1024;

const num = (v) => Number(v) || 0;
const usd = (n) => `$${Number(n || 0).toFixed(2)}`;

function fileToDataUri(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read that file'));
    reader.readAsDataURL(file);
  });
}

// `invoice` is an existing supplier invoice (edit) or null (new). `presetLink`
// ({ invoice_id, usd_amount }) pre-fills one link, used from the "waiting for
// a supplier invoice" list.
export default function SupplierInvoiceModal({ open, onClose, token, invoice, presetLink, onSaved }) {
  const paid = invoice?.status === 'paid';
  const [form, setForm] = useState({ supplier: '', number: '', invoice_date: '', due_date: '', usd_amount: '', notes: '' });
  const [links, setLinks] = useState([]);
  const [file, setFile] = useState(null); // { data, name } | null (new file)
  const [removeFile, setRemoveFile] = useState(false);
  const [clientInvoices, setClientInvoices] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    setFile(null);
    setRemoveFile(false);
    if (invoice) {
      setForm({
        supplier: invoice.supplier,
        number: invoice.number,
        invoice_date: invoice.invoice_date,
        due_date: invoice.due_date,
        usd_amount: String(invoice.usd_amount),
        notes: invoice.notes,
      });
      setLinks(invoice.links.map((l) => ({ invoice_id: String(l.invoice_id), usd_amount: String(l.usd_amount) })));
    } else {
      setForm({ supplier: '', number: '', invoice_date: todayStr(), due_date: '', usd_amount: presetLink ? String(presetLink.usd_amount) : '', notes: '' });
      setLinks(presetLink ? [{ invoice_id: String(presetLink.invoice_id), usd_amount: String(presetLink.usd_amount) }] : []);
    }
    api.invoices
      .list(token)
      .then((d) => setClientInvoices((d.invoices || []).filter((i) => i.status !== 'void' && i.status !== 'draft')))
      .catch(() => {});
    api.supplierInvoices
      .list(token)
      .then((d) => setSuppliers([...new Set(d.supplierInvoices.map((s) => s.supplier))]))
      .catch(() => {});
  }, [open, invoice, presetLink, token]);

  const options = useMemo(
    () => clientInvoices.map((i) => ({ value: String(i.id), label: i.number, sublabel: i.client_name })),
    [clientInvoices],
  );

  const total = num(form.usd_amount);
  const assigned = links.reduce((s, l) => s + num(l.usd_amount), 0);
  const unassigned = Math.max(total - assigned, 0);
  const over = assigned > total + 0.005;

  const setLink = (i, patch) => setLinks((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  function addLink() {
    // Offer what is still unassigned as the starting amount.
    setLinks((ls) => [...ls, { invoice_id: '', usd_amount: unassigned > 0 ? unassigned.toFixed(2) : '' }]);
  }

  async function pickFile(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setError('');
    try {
      const data = f.type === 'application/pdf' ? await fileToDataUri(f) : await resizeImage(f, { maxDimension: 1800, quality: 0.88 });
      if (dataUriByteLength(data) > FILE_MAX_BYTES) throw new Error('That file is too large (6MB maximum)');
      setFile({ data, name: f.name });
      setRemoveFile(false);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (over) return setError(`The client invoices add up to ${usd(assigned)}, which is more than this supplier invoice (${usd(total)}).`);
    if (links.some((l) => !l.invoice_id)) return setError('Choose a client invoice for each link, or remove the empty row.');
    const linkPayload = links.map((l) => ({ invoice_id: Number(l.invoice_id), usd_amount: num(l.usd_amount) }));
    setSaving(true);
    setError('');
    try {
      if (paid) {
        await api.supplierInvoices.setLinks(invoice.id, linkPayload, token);
      } else {
        const payload = { ...form, usd_amount: num(form.usd_amount), links: linkPayload };
        if (file) {
          payload.file_data = file.data;
          payload.file_name = file.name;
        } else if (removeFile) payload.file_data = null;
        if (invoice) await api.supplierInvoices.update(invoice.id, payload, token);
        else await api.supplierInvoices.create(payload, token);
      }
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const hasExistingFile = invoice?.has_file && !removeFile && !file;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={paid ? 'Client invoices this paid for' : invoice ? 'Edit supplier invoice' : 'New supplier invoice'}
      maxWidthClass="max-w-xl"
    >
      <form onSubmit={handleSubmit} className="grid gap-3">
        {paid && <p className="text-xs text-slate-500 dark:text-slate-400">This invoice is paid, so only the links to client invoices can change.</p>}
        <label className="block">
          <span className={LABEL}>Supplier</span>
          <input
            type="text"
            required
            disabled={paid}
            list="supplier-names"
            value={form.supplier}
            onChange={(e) => setForm((f) => ({ ...f, supplier: e.target.value }))}
            placeholder="e.g. Edupage"
            className={INPUT}
          />
          <datalist id="supplier-names">
            {suppliers.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={LABEL}>Their invoice no.</span>
            <input type="text" disabled={paid} value={form.number} onChange={(e) => setForm((f) => ({ ...f, number: e.target.value }))} className={INPUT} />
          </label>
          <label className="block">
            <span className={LABEL}>Amount to pay (USD)</span>
            <input
              type="number"
              min="0"
              step="0.01"
              required
              disabled={paid}
              value={form.usd_amount}
              onChange={(e) => setForm((f) => ({ ...f, usd_amount: e.target.value }))}
              className={INPUT}
            />
          </label>
          <label className="block">
            <span className={LABEL}>Invoice date</span>
            <input type="date" required disabled={paid} value={form.invoice_date} onChange={(e) => setForm((f) => ({ ...f, invoice_date: e.target.value }))} className={INPUT} />
          </label>
          <label className="block">
            <span className={LABEL}>Due date (optional)</span>
            <input type="date" disabled={paid} value={form.due_date} onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))} className={INPUT} />
          </label>
        </div>

        {!paid && (
          <div>
            <span className={LABEL}>Photo or PDF of the invoice (optional)</span>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
              <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={pickFile} className="text-sm text-slate-600 dark:text-slate-300" />
              {file && <span className="text-emerald-700 dark:text-emerald-400">{file.name} ready</span>}
              {hasExistingFile && (
                <>
                  <span className="text-slate-500">{invoice.file_name} attached</span>
                  <button type="button" onClick={() => setRemoveFile(true)} className="text-red-600 hover:underline dark:text-red-400">
                    Remove
                  </button>
                </>
              )}
              {removeFile && <span className="text-slate-500">File will be removed</span>}
            </div>
          </div>
        )}

        <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Which client invoices is this for?</p>
            <button type="button" onClick={addLink} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-white dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">
              <PlusIcon width={14} height={14} />
              Add
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Split the amount across as many sales as it covers. This gives the real cost of each sale. You can leave it empty and link it later.
          </p>
          {links.length > 0 && (
            <ul className="mt-3 grid gap-2">
              {links.map((l, i) => (
                <li key={i} className="grid grid-cols-[1fr_6.5rem_auto] items-end gap-2">
                  <div>
                    <SearchableSelect options={options} value={l.invoice_id} onChange={(v) => setLink(i, { invoice_id: v })} placeholder="Client invoice…" />
                  </div>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    aria-label="USD for this invoice"
                    value={l.usd_amount}
                    onChange={(e) => setLink(i, { usd_amount: e.target.value })}
                    className="min-h-11 w-full rounded-md border border-slate-300 px-2 py-2 text-base dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                  />
                  <button
                    type="button"
                    aria-label="Remove link"
                    onClick={() => setLinks((ls) => ls.filter((_, idx) => idx !== i))}
                    className="flex h-11 w-9 items-center justify-center rounded-md text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
                  >
                    <TrashIcon width={16} height={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {total > 0 && (
            <p className={`mt-2 text-xs ${over ? 'text-red-600 dark:text-red-400' : 'text-slate-600 dark:text-slate-300'}`}>
              {usd(assigned)} assigned of {usd(total)}
              {over ? ' — too much' : unassigned > 0 ? ` · ${usd(unassigned)} not assigned yet` : ' · fully assigned'}
            </p>
          )}
        </div>

        {!paid && (
          <label className="block">
            <span className={LABEL}>Notes</span>
            <input type="text" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className={INPUT} />
          </label>
        )}

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex gap-3">
          <button type="submit" disabled={saving} className="min-h-11 rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60 dark:bg-lagoon-600 dark:hover:bg-lagoon-500">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={onClose} className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
