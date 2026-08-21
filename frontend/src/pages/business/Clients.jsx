import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useUndoableDelete } from '../../lib/useUndoableDelete';
import { useConfirm } from '../../lib/useConfirm';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import SearchInput from '../../components/SearchInput';
import FloatingActionButton from '../../components/FloatingActionButton';
import Pagination from '../../components/Pagination';
import Modal from '../../components/Modal';
import { TableSkeleton } from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import MobileListAccordion from '../../components/MobileListAccordion';
import IconActionButton from '../../components/IconActionButton';
import EmailPreviewModal from '../../components/EmailPreviewModal';
import { UsersIcon, DownloadIcon, PlusIcon, PencilIcon, TrashIcon, SendIcon } from '../../components/icons';

const EMPTY_FORM = { name: '', email: '', phone: '', address: '', notes: '' };

// portal_status is computed server-side (routes/clients.js) from the
// client's client_portal_accounts row — 'none' renders no badge at all
// since it's the common, unremarkable case (most clients aren't on the
// portal), matching how MobileListAccordion's own accent stripes only
// mark out-of-the-ordinary rows elsewhere in the app.
const PORTAL_BADGE = {
  invited: { label: 'Invited', className: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  active: { label: 'Portal active', className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  deactivated: { label: 'Portal deactivated', className: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400' },
};

function PortalBadge({ status }) {
  const badge = PORTAL_BADGE[status];
  if (!badge) return null;
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}>{badge.label}</span>;
}

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
  const debouncedSearch = useDebouncedValue(search);
  const [emailModal, setEmailModal] = useState(null); // id of the client whose portal-invite preview is open, or null

  const { pendingIds, deleteWithUndo } = useUndoableDelete((id) => api.clients.remove(id, token));
  const visibleClients = clients.filter((c) => !pendingIds.has(c.id));
  const { confirm, confirmDialog } = useConfirm();

  function load() {
    // Only show the loading skeleton on the very first load — once there's
    // a list on screen, a refetch (search/page change) keeps the current
    // rows visible until the new ones arrive instead of flashing to a
    // fixed-row-count skeleton whose height matches neither the old nor new
    // result count, which read as the page visibly jumping.
    if (clients.length === 0) setLoading(true);
    api.clients
      .list(token, { q: debouncedSearch, page })
      .then(({ clients, ...rest }) => {
        setClients(clients);
        setPageInfo(rest.totalPages ? rest : null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [token, debouncedSearch, page]);
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

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

  async function handleDelete(client) {
    if (!(await confirm({ title: `Delete ${client.name}?`, confirmLabel: 'Delete' }))) return;
    deleteWithUndo([client.id], `"${client.name}" deleted.`);
  }

  async function handleExportCsv() {
    setError('');
    try {
      await api.clients.exportCsv(token);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleExportXlsx() {
    setError('');
    try {
      await api.clients.exportXlsx(token);
    } catch (err) {
      setError(err.message);
    }
  }

  // 'active'/'deactivated' clients get no invite action here — a live
  // portal login already exists, and reactivating a deactivated one is a
  // later phase (see CLAUDE.md's client portal rollout plan).
  function rowActions(client) {
    return (
      <>
        {canManage && (client.portal_status === 'none' || client.portal_status === 'invited') && (
          <IconActionButton
            icon={SendIcon}
            tone="lagoon"
            onClick={() => setEmailModal(client.id)}
            title={client.portal_status === 'invited' ? 'Resend portal invite' : 'Invite to portal'}
            label={client.portal_status === 'invited' ? 'Resend portal invite' : 'Invite client to portal'}
          />
        )}
        {canManage && <IconActionButton icon={PencilIcon} tone="slate" onClick={() => startEdit(client)} title="Edit" label="Edit client" />}
        {canManage && <IconActionButton icon={TrashIcon} tone="red" onClick={() => handleDelete(client)} title="Delete" label="Delete client" />}
      </>
    );
  }

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Clients</h1>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleExportCsv}
            className="flex min-h-11 items-center gap-1.5 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <DownloadIcon width={16} height={16} />
            Export CSV
          </button>
          <button
            onClick={handleExportXlsx}
            className="hidden min-h-11 items-center gap-1.5 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800 sm:flex"
          >
            <DownloadIcon width={16} height={16} />
            Export Excel
          </button>
          {canManage && (
            <button
              onClick={startCreate}
              className="flex min-h-11 items-center gap-1.5 rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500"
            >
              <PlusIcon width={16} height={16} />
              New client
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 sm:max-w-sm">
        <SearchInput value={search} onChange={setSearch} placeholder="Search clients…" />
      </div>

      {error && !showForm && <p className="mt-4 text-sm text-red-600">{error}</p>}

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
              className="min-h-11 rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500 disabled:opacity-60"
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

      <div className="mt-6 rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        {loading ? (
          <div className="overflow-x-auto">
            <TableSkeleton rows={5} cols={canManage ? ['w-32', 'w-40', 'w-24', 'w-16'] : ['w-32', 'w-40', 'w-24']} />
          </div>
        ) : visibleClients.length === 0 ? (
          <EmptyState
            icon={<UsersIcon />}
            title={search ? `No clients match "${search}".` : 'No clients yet.'}
            message={!search && canManage ? 'Add your first client to start creating quotes and invoices.' : undefined}
            action={!search && canManage ? { label: 'New client', onClick: startCreate } : undefined}
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto sm:block">
              <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                    <th className="px-4 py-3">Client</th>
                    <th className="px-4 py-3">Email</th>
                    <th className="px-4 py-3">Phone</th>
                    {canManage && <th className="px-4 py-3" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {visibleClients.map((client) => (
                    <tr key={client.id}>
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900 dark:text-white">{client.name}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-400">
                        <div className="flex items-center gap-2">
                          {client.email}
                          <PortalBadge status={client.portal_status} />
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-400">{client.phone || '—'}</td>
                      {canManage && (
                        <td className="whitespace-nowrap px-4 py-3">
                          <div className="flex justify-end gap-1.5">{rowActions(client)}</div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-2.5 sm:hidden">
              {visibleClients.map((client) => (
                <MobileListAccordion
                  key={client.id}
                  name="clients-list"
                  summary={
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-slate-900 dark:text-white">{client.name}</p>
                        <p className="truncate text-slate-500 dark:text-slate-400">{client.email}</p>
                      </div>
                      <PortalBadge status={client.portal_status} />
                    </div>
                  }
                >
                  <div className="flex justify-between">
                    <dt className="text-slate-500 dark:text-slate-400">Phone</dt>
                    <dd className="text-slate-900 dark:text-white">{client.phone || '—'}</dd>
                  </div>
                  {canManage && <div className="flex flex-wrap gap-1.5 pt-1">{rowActions(client)}</div>}
                </MobileListAccordion>
              ))}
            </div>
          </>
        )}
      </div>

      {pageInfo && <Pagination page={pageInfo.page} totalPages={pageInfo.totalPages} onChange={setPage} />}

      {canManage && !showForm && <FloatingActionButton onClick={startCreate} label="New client" />}

      <EmailPreviewModal
        open={emailModal !== null}
        onClose={() => setEmailModal(null)}
        title="Review invite email before sending"
        loadPreview={() => api.clients.portalInvitePreview(emailModal, token)}
        onSend={async ({ subject, message }) => {
          await api.clients.portalInvite(emailModal, { subject, message }, token);
          toast('Portal invite sent.', { type: 'success' });
          load();
        }}
        showAttachmentNote={false}
      />

      {confirmDialog}
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
        className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none"
      />
    </label>
  );
}
