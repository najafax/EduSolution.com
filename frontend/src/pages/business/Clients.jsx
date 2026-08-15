import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useUndoableDelete } from '../../lib/useUndoableDelete';
import SearchInput from '../../components/SearchInput';
import FloatingActionButton from '../../components/FloatingActionButton';
import Pagination from '../../components/Pagination';
import Modal from '../../components/Modal';
import { TableSkeleton } from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import BulkActionBar from '../../components/BulkActionBar';
import { UsersIcon } from '../../components/icons';

const EMPTY_FORM = { name: '', email: '', phone: '', address: '', notes: '' };

export default function Clients() {
  const { token, can } = useAuth();
  const { toast } = useToast();
  const canManage = can('clients', 'manage');
  const [clients, setClients] = useState([]);
  const [pageInfo, setPageInfo] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(() => new Set());

  const { pendingIds, deleteWithUndo } = useUndoableDelete((id) => api.clients.remove(id, token));
  const visibleClients = clients.filter((c) => !pendingIds.has(c.id));

  function load() {
    setLoading(true);
    api.clients
      .list(token, { q: search, page })
      .then(({ clients, ...rest }) => {
        setClients(clients);
        setPageInfo(rest.totalPages ? rest : null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [token, search, page]);
  useEffect(() => {
    setPage(1);
  }, [search]);
  useEffect(() => {
    setSelected(new Set());
  }, [clients]);

  function startCreate() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(true);
  }

  function startEdit(client) {
    setForm({
      name: client.name,
      email: client.email,
      phone: client.phone,
      address: client.address,
      notes: client.notes,
    });
    setEditingId(client.id);
    setShowForm(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (editingId) {
        await api.clients.update(editingId, form, token);
        toast('Client updated.', { type: 'success' });
      } else {
        await api.clients.create(form, token);
        toast('Client created.', { type: 'success' });
      }
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function handleDelete(client) {
    deleteWithUndo([client.id], `"${client.name}" deleted.`);
  }

  function handleBulkDelete() {
    const ids = [...selected];
    deleteWithUndo(ids, `${ids.length} client${ids.length === 1 ? '' : 's'} deleted.`);
    setSelected(new Set());
  }

  function toggleSelected(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => (prev.size === visibleClients.length ? new Set() : new Set(visibleClients.map((c) => c.id))));
  }

  async function handleExport() {
    setError('');
    try {
      await api.clients.exportCsv(token);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Clients</h1>
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Export CSV
          </button>
          {canManage && (
            <button
              onClick={startCreate}
              className="min-h-11 rounded-md bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-500"
            >
              New client
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 max-w-sm">
        <SearchInput value={search} onChange={setSearch} placeholder="Search clients…" />
      </div>

      {error && !showForm && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {canManage && (
        <BulkActionBar count={selected.size} onClear={() => setSelected(new Set())}>
          <button
            type="button"
            onClick={handleBulkDelete}
            className="min-h-9 rounded-md border border-red-300 px-3 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
          >
            Delete
          </button>
        </BulkActionBar>
      )}

      <Modal open={showForm} onClose={() => setShowForm(false)} title={editingId ? 'Edit client' : 'New client'} maxWidthClass="max-w-2xl">
        <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
          {error && (
            <p className="text-sm text-red-600 sm:col-span-2">{error}</p>
          )}
          <Field label="Client name" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} required />
          <Field label="Email" type="email" value={form.email} onChange={(v) => setForm((f) => ({ ...f, email: v }))} required />
          <Field label="Phone" value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v }))} />
          <div className="sm:col-span-2">
            <Field label="Address" value={form.address} onChange={(v) => setForm((f) => ({ ...f, address: v }))} />
          </div>
          <div className="sm:col-span-2">
            <Field label="Notes" value={form.notes} onChange={(v) => setForm((f) => ({ ...f, notes: v }))} />
          </div>
          <div className="flex gap-3 sm:col-span-2">
            <button
              type="submit"
              disabled={submitting}
              className="min-h-11 rounded-md bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {submitting ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        {loading ? (
          <TableSkeleton rows={5} cols={canManage ? ['w-8', 'w-32', 'w-40', 'w-24', 'w-16'] : ['w-32', 'w-40', 'w-24']} />
        ) : visibleClients.length === 0 ? (
          <EmptyState
            icon={<UsersIcon />}
            title={search ? `No clients match "${search}".` : 'No clients yet.'}
            message={!search && canManage ? 'Add your first client to start creating quotes and invoices.' : undefined}
            action={!search && canManage ? { label: 'New client', onClick: startCreate } : undefined}
          />
        ) : (
          <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
            <thead>
              <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                {canManage && (
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.size > 0 && selected.size === visibleClients.length}
                      onChange={toggleSelectAll}
                      aria-label="Select all clients"
                      className="h-4 w-4 rounded border-slate-300"
                    />
                  </th>
                )}
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Phone</th>
                {canManage && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {visibleClients.map((client) => (
                <tr key={client.id} className={selected.has(client.id) ? 'bg-indigo-50/50 dark:bg-indigo-950/30' : undefined}>
                  {canManage && (
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(client.id)}
                        onChange={() => toggleSelected(client.id)}
                        aria-label={`Select ${client.name}`}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                    </td>
                  )}
                  <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900 dark:text-white">{client.name}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-400">{client.email}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-400">{client.phone || '—'}</td>
                  {canManage && (
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <button onClick={() => startEdit(client)} className="mr-3 text-indigo-600 hover:text-indigo-500">
                        Edit
                      </button>
                      <button onClick={() => handleDelete(client)} className="text-red-600 hover:text-red-500">
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {pageInfo && <Pagination page={pageInfo.page} totalPages={pageInfo.totalPages} onChange={setPage} />}

      {canManage && !showForm && <FloatingActionButton onClick={startCreate} label="New client" />}
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', required = false }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input
        type={type}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-indigo-500 focus:outline-none"
      />
    </label>
  );
}
