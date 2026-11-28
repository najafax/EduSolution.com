import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { useToast } from '../../../context/ToastContext';
import { useConfirm } from '../../../lib/useConfirm';
import { useDebouncedValue } from '../../../lib/useDebouncedValue';
import Modal from '../../../components/Modal';
import Pagination from '../../../components/Pagination';
import SearchInput from '../../../components/SearchInput';
import { INPUT, AREA, BTN, BTN2, Field, prepareImage, toLocalInput, fromLocalInput } from './common';

const API = `${import.meta.env.VITE_API_URL || ''}/api/public/shop/images`;
const STOCK = [['in_stock', 'In stock'], ['low', 'Only a few left'], ['on_request', 'Available on request'], ['out', 'Out of stock']];
const FLAGS = [['', 'All'], ['sale', 'On sale'], ['featured', 'Featured'], ['no_picture', 'No picture'], ['hidden', 'Hidden'], ['out', 'Out of stock']];
const EMPTY = { sku: '', name: '', brand: '', model: '', size: '', category_id: '', group_label: '', description: '', highlights: '', warranty_note: '', retail_price: '', sale_price: '', sale_ends_at: '', stock_status: 'in_stock', featured: false, visible: true };

function ProductForm({ token, product, categories, onClose, onSaved }) {
  const { toast } = useToast();
  const [f, setF] = useState(product ? { ...EMPTY, ...product, category_id: product.category_id ?? '', sale_price: product.sale_price ?? '', sale_ends_at: toLocalInput(product.sale_ends_at), featured: Boolean(product.featured), visible: Boolean(product.visible) } : EMPTY);
  const [images, setImages] = useState(product?.images || []);
  const [id, setId] = useState(product?.id || null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  async function save(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const payload = { ...f, category_id: f.category_id === '' ? null : Number(f.category_id), sale_price: f.sale_price === '' ? null : Number(f.sale_price), sale_ends_at: fromLocalInput(f.sale_ends_at), retail_price: Number(f.retail_price) };
    try {
      const r = id ? await api.shop.updateProduct(id, payload, token) : await api.shop.createProduct(payload, token);
      setId(r.product.id);
      toast(id ? 'Product saved' : 'Product created. You can add pictures now.', { type: 'success' });
      onSaved();
      if (id) onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function upload(e) {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length || !id) return;
    setError('');
    setBusy(true);
    try {
      const uris = [];
      for (const file of files) uris.push(await prepareImage(file));
      const r = await api.shop.addImages(id, uris, token);
      setImages(r.images);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(imageId) {
    await api.shop.removeImage(id, imageId, token);
    setImages((l) => l.filter((i) => i.id !== imageId));
    onSaved();
  }
  async function makeFirst(imageId) {
    const order = [imageId, ...images.filter((i) => i.id !== imageId).map((i) => i.id)];
    await api.shop.orderImages(id, order, token);
    setImages(order.map((x) => images.find((i) => i.id === x)));
    onSaved();
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Product name" className="sm:col-span-2"><input required className={INPUT} value={f.name} onChange={set('name')} /></Field>
        <Field label="SKU"><input required className={INPUT} value={f.sku} onChange={set('sku')} /></Field>
        <Field label="Category">
          <select className={INPUT} value={f.category_id} onChange={set('category_id')}>
            <option value="">None</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Brand"><input className={INPUT} value={f.brand} onChange={set('brand')} /></Field>
        <Field label="Model"><input className={INPUT} value={f.model} onChange={set('model')} /></Field>
        <Field label="Size / capacity"><input className={INPUT} value={f.size} onChange={set('size')} placeholder='e.g. 55" or 1.5HP' /></Field>
        <Field label="Group label" hint="Shown above the name, e.g. Inverter"><input className={INPUT} value={f.group_label} onChange={set('group_label')} /></Field>
        <Field label="Retail price"><input required type="number" min="0" step="0.01" className={INPUT} value={f.retail_price} onChange={set('retail_price')} /></Field>
        <Field label="Stock">
          <select className={INPUT} value={f.stock_status} onChange={set('stock_status')}>{STOCK.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </Field>
        <Field label="Sale price" hint="Leave blank for no sale. Must be lower than retail."><input type="number" min="0" step="0.01" className={INPUT} value={f.sale_price} onChange={set('sale_price')} /></Field>
        <Field label="Sale ends" hint="Optional. The countdown on the shop runs to this time."><input type="datetime-local" className={INPUT} value={f.sale_ends_at} onChange={set('sale_ends_at')} /></Field>
      </div>
      <Field label="Highlights" hint="One per line. Shown as bullet points."><textarea rows={4} className={AREA} value={f.highlights} onChange={set('highlights')} /></Field>
      <Field label="Description"><textarea rows={4} className={AREA} value={f.description} onChange={set('description')} /></Field>
      <Field label="Warranty note (optional)"><input className={INPUT} value={f.warranty_note} onChange={set('warranty_note')} /></Field>
      <div className="flex flex-wrap gap-6 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.featured} onChange={set('featured')} /> Featured on the home page</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.visible} onChange={set('visible')} /> Visible in the shop</label>
      </div>

      <div className="rounded-2xl border border-dashed border-slate-300 p-4 dark:border-slate-600">
        <div className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">Pictures</div>
        {!id ? <p className="text-sm text-slate-500">Save the product first, then add pictures.</p> : (
          <>
            <div className="flex flex-wrap gap-3">
              {images.map((im, i) => (
                <div key={im.id} className="relative h-24 w-24 overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
                  <img src={`${API}/${im.id}`} alt="" className="h-full w-full object-contain" />
                  {i === 0 && <span className="absolute left-1 top-1 rounded bg-slate-900 px-1.5 text-[10px] font-bold text-white">Main</span>}
                  <div className="absolute inset-x-0 bottom-0 flex justify-between bg-white/90 px-1 text-[11px]">
                    {i > 0 ? <button type="button" onClick={() => makeFirst(im.id)} className="font-semibold text-lagoon-700">Main</button> : <span />}
                    <button type="button" onClick={() => remove(im.id)} className="font-semibold text-red-600">Delete</button>
                  </div>
                </div>
              ))}
              {images.length < 8 && (
                <label className="grid h-24 w-24 cursor-pointer place-items-center rounded-xl border border-slate-300 text-center text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300">
                  + Add
                  <input type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden" onChange={upload} />
                </label>
              )}
            </div>
            <p className="mt-2 text-xs text-slate-500">Pictures are shrunk automatically. The first one is the main picture.</p>
          </>
        )}
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" className={BTN2} onClick={onClose}>{id && !product ? 'Done' : 'Cancel'}</button>
        <button disabled={busy} className={BTN}>{busy ? 'Saving…' : id ? 'Save product' : 'Create product'}</button>
      </div>
    </form>
  );
}

export default function ProductsTab({ token, canManage, categories, refreshStats }) {
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [q, setQ] = useState('');
  const dq = useDebouncedValue(q);
  const [category, setCategory] = useState('');
  const [flag, setFlag] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(undefined); // undefined closed, null new, object edit
  const [picked, setPicked] = useState(new Set());
  const [bulk, setBulk] = useState({ action: '', percent: 10, ends_at: '', stock_status: 'in_stock' });

  function load() {
    api.shop.products(token, { q: dq, category, flag, page }).then(setData).catch((e) => setError(e.message));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [token, dq, category, flag, page]);
  useEffect(() => setPage(1), [dq, category, flag]);

  async function open(p) {
    if (!p) return setEditing(null);
    const r = await api.shop.product(p.id, token);
    setEditing(r.product);
  }
  async function del(p) {
    if (!(await confirm({ title: 'Delete product?', message: `${p.name} will be removed from the shop.`, confirmLabel: 'Delete' }))) return;
    const r = await api.shop.removeProduct(p.id, token);
    toast(r.message || 'Product deleted', { type: 'success' });
    load(); refreshStats();
  }
  async function runBulk() {
    const ids = [...picked];
    const payload = { action: bulk.action, ids, percent: Number(bulk.percent), ends_at: fromLocalInput(bulk.ends_at), stock_status: bulk.stock_status };
    try {
      const r = await api.shop.bulk(payload, token);
      toast(`${r.updated} products updated`, { type: 'success' });
      setPicked(new Set()); setBulk((b) => ({ ...b, action: '' }));
      load(); refreshStats();
    } catch (e) { toast(e.message, { type: 'error' }); }
  }
  async function starter() {
    if (!(await confirm({ title: 'Load starter catalogue?', message: 'Adds the appliances from the dealer list (retail prices only). Existing products keep their pictures and descriptions.', confirmLabel: 'Load', danger: false }))) return;
    const r = await api.shop.loadStarter(token);
    toast(`${r.created} added, ${r.updated} updated`, { type: 'success' });
    load(); refreshStats();
  }

  const toggle = (id) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[14rem] flex-1 sm:max-w-sm"><SearchInput value={q} onChange={setQ} placeholder="Search name, SKU, brand…" /></div>
        <select className={`${INPUT} !mt-0 sm:w-48`} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option><option value="none">No category</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className={`${INPUT} !mt-0 sm:w-40`} value={flag} onChange={(e) => setFlag(e.target.value)}>{FLAGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        {canManage && <button type="button" className={BTN} onClick={() => open(null)}>+ New product</button>}
        {canManage && <button type="button" className={BTN2} onClick={starter}>Load starter catalogue</button>}
      </div>

      {canManage && picked.size > 0 && (
        <div className="flex flex-wrap items-end gap-2 rounded-2xl bg-amber-50 p-3 text-sm dark:bg-slate-800">
          <b>{picked.size} selected</b>
          <select className={`${INPUT} !mt-0 w-44`} value={bulk.action} onChange={(e) => setBulk((b) => ({ ...b, action: e.target.value }))}>
            <option value="">Choose action…</option>
            <option value="sale">Put on sale…</option><option value="clear_sale">End sale</option>
            <option value="hide">Hide</option><option value="show">Show</option>
            <option value="feature">Feature</option><option value="unfeature">Unfeature</option>
            <option value="stock">Set stock…</option>
          </select>
          {bulk.action === 'sale' && <>
            <label className="text-xs">Discount %<input type="number" min="1" max="89" className={`${INPUT} !mt-0 w-24`} value={bulk.percent} onChange={(e) => setBulk((b) => ({ ...b, percent: e.target.value }))} /></label>
            <label className="text-xs">Ends<input type="datetime-local" className={`${INPUT} !mt-0 w-52`} value={bulk.ends_at} onChange={(e) => setBulk((b) => ({ ...b, ends_at: e.target.value }))} /></label>
          </>}
          {bulk.action === 'stock' && <select className={`${INPUT} !mt-0 w-44`} value={bulk.stock_status} onChange={(e) => setBulk((b) => ({ ...b, stock_status: e.target.value }))}>{STOCK.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>}
          <button type="button" disabled={!bulk.action} className={BTN} onClick={runBulk}>Apply</button>
          <button type="button" className={BTN2} onClick={() => setPicked(new Set())}>Clear</button>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
      {data && data.products.length === 0 && <p className="rounded-2xl bg-white py-14 text-center text-sm text-slate-500 dark:bg-slate-800">No products yet. Use “Load starter catalogue” to bring in the dealer list.</p>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {data?.products.map((p) => (
          <div key={p.id} className="flex gap-3 rounded-2xl bg-white p-3 shadow-sm dark:border dark:border-slate-700 dark:bg-slate-800">
            {canManage && <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={picked.has(p.id)} onChange={() => toggle(p.id)} aria-label={`Select ${p.name}`} />}
            <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-slate-100">
              {p.first_image ? <img src={`${API}/${p.first_image}`} alt="" className="h-full w-full object-contain" /> : <div className="grid h-full place-items-center px-1 text-center text-[10px] font-semibold text-slate-400">No picture</div>}
            </div>
            <div className="min-w-0 flex-1 text-sm">
              <div className="line-clamp-2 font-semibold text-slate-900 dark:text-white">{p.name}</div>
              <div className="text-xs text-slate-500">{p.sku} · {p.category_name || 'No category'}</div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs">
                <b className="text-slate-900 dark:text-white">{Number(p.sale_active ? p.sale_price : p.retail_price).toLocaleString()}</b>
                {p.sale_active && <span className="rounded bg-red-100 px-1.5 font-bold text-red-700">SALE</span>}
                {!p.visible && <span className="rounded bg-slate-200 px-1.5 font-bold text-slate-700">Hidden</span>}
                {p.featured ? <span className="rounded bg-amber-100 px-1.5 font-bold text-amber-800">Featured</span> : null}
                {p.stock_status !== 'in_stock' && <span className="text-slate-500">{STOCK.find((s) => s[0] === p.stock_status)?.[1]}</span>}
              </div>
              {canManage && <div className="mt-2 flex gap-3 text-xs font-semibold"><button type="button" className="text-lagoon-700 dark:text-lagoon-300" onClick={() => open(p)}>Edit</button><button type="button" className="text-red-600" onClick={() => del(p)}>Delete</button></div>}
            </div>
          </div>
        ))}
      </div>
      {data && <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />}

      <Modal open={editing !== undefined} onClose={() => setEditing(undefined)} title={editing ? 'Edit product' : 'New product'} maxWidthClass="max-w-3xl">
        {editing !== undefined && <ProductForm key={editing?.id || 'new'} token={token} product={editing} categories={categories} onClose={() => setEditing(undefined)} onSaved={() => { load(); refreshStats(); }} />}
      </Modal>
      {confirmDialog}
    </div>
  );
}
