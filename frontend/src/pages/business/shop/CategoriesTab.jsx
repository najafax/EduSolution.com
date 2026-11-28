import { useState } from 'react';
import { api } from '../../../lib/api';
import { useToast } from '../../../context/ToastContext';
import { useConfirm } from '../../../lib/useConfirm';
import Modal from '../../../components/Modal';
import { INPUT, BTN, BTN2, Field } from './common';

export default function CategoriesTab({ token, canManage, categories, reload }) {
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [editing, setEditing] = useState(undefined);
  const [f, setF] = useState({ name: '', description: '', display_order: 0, visible: true });
  const [error, setError] = useState('');
  function open(c) { setError(''); setEditing(c || null); setF(c ? { name: c.name, description: c.description || '', display_order: c.display_order, visible: Boolean(c.visible) } : { name: '', description: '', display_order: categories.length, visible: true }); }
  async function save(e) {
    e.preventDefault(); setError('');
    try { if (editing) await api.shop.updateCategory(editing.id, f, token); else await api.shop.createCategory(f, token); setEditing(undefined); reload(); toast('Category saved', { type: 'success' }); } catch (err) { setError(err.message); }
  }
  async function del(c) {
    if (!(await confirm({ title: 'Delete category?', message: c.name, confirmLabel: 'Delete' }))) return;
    try { await api.shop.removeCategory(c.id, token); reload(); } catch (err) { toast(err.message, { type: 'error' }); }
  }
  return (
    <div className="space-y-4">
      {canManage && <button type="button" className={BTN} onClick={() => open(null)}>+ New category</button>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {categories.map((c) => (
          <div key={c.id} className="rounded-2xl bg-white p-4 shadow-sm dark:border dark:border-slate-700 dark:bg-slate-800">
            <div className="font-display text-lg font-extrabold text-slate-900 dark:text-white">{c.name}{!c.visible && <span className="ml-2 text-xs font-semibold text-slate-500">hidden</span>}</div>
            <div className="text-xs text-slate-500">{c.product_count} products · order {c.display_order}</div>
            {canManage && <div className="mt-2 flex gap-3 text-sm font-semibold"><button type="button" className="text-lagoon-700 dark:text-lagoon-300" onClick={() => open(c)}>Edit</button><button type="button" className="text-red-600" onClick={() => del(c)}>Delete</button></div>}
          </div>
        ))}
      </div>
      <Modal open={editing !== undefined} onClose={() => setEditing(undefined)} title={editing ? 'Edit category' : 'New category'}>
        <form onSubmit={save} className="space-y-3">
          <Field label="Name"><input required className={INPUT} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Short description"><input className={INPUT} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <Field label="Order (lower shows first)"><input type="number" className={INPUT} value={f.display_order} onChange={(e) => setF({ ...f, display_order: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.visible} onChange={(e) => setF({ ...f, visible: e.target.checked })} /> Visible in the shop</label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2"><button type="button" className={BTN2} onClick={() => setEditing(undefined)}>Cancel</button><button className={BTN}>Save</button></div>
        </form>
      </Modal>
      {confirmDialog}
    </div>
  );
}
