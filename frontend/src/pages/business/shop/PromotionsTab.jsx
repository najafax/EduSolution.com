import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { useToast } from '../../../context/ToastContext';
import { useConfirm } from '../../../lib/useConfirm';
import Modal from '../../../components/Modal';
import { INPUT, BTN, BTN2, Field, prepareImage, toLocalInput, fromLocalInput } from './common';

const THEMES = [['ember', 'Ember (red-orange)'], ['ocean', 'Ocean (blue)'], ['forest', 'Forest (green)'], ['ink', 'Ink (dark)']];
const EMPTY = { title: '', subtitle: '', badge: 'FLASH SALE', cta_label: 'Shop the sale', link_path: '/sale', theme: 'ember', image: undefined, starts_at: '', ends_at: '', active: true, show_on_main_site: true };

export default function PromotionsTab({ token, canManage }) {
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [list, setList] = useState([]);
  const [editing, setEditing] = useState(undefined);
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mail, setMail] = useState(null); // { promo, html, subject }
  const [testTo, setTestTo] = useState('');

  const load = () => api.shop.promotions(token).then((r) => setList(r.promotions)).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [token]);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  function openForm(p) {
    setError('');
    setEditing(p || null);
    setF(p ? { ...EMPTY, ...p, image: undefined, starts_at: toLocalInput(p.starts_at), ends_at: toLocalInput(p.ends_at), active: Boolean(p.active), show_on_main_site: Boolean(p.show_on_main_site) } : EMPTY);
  }
  async function save(e) {
    e.preventDefault(); setBusy(true); setError('');
    const payload = { ...f, starts_at: fromLocalInput(f.starts_at), ends_at: fromLocalInput(f.ends_at) };
    if (payload.image === undefined) delete payload.image;
    try {
      if (editing) await api.shop.updatePromotion(editing.id, payload, token); else await api.shop.createPromotion(payload, token);
      setEditing(undefined); load(); toast('Banner saved', { type: 'success' });
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function pick(e) {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    try { setF((s) => ({ ...s, image: undefined })); const uri = await prepareImage(file, 1400); setF((s) => ({ ...s, image: uri })); } catch (err) { setError(err.message); }
  }
  async function del(p) {
    if (!(await confirm({ title: 'Delete this banner?', message: p.title, confirmLabel: 'Delete' }))) return;
    await api.shop.removePromotion(p.id, token); load();
  }
  async function openMail(p) {
    try { const r = await api.shop.promoEmailPreview(p.id, token); setMail({ promo: p, ...r }); } catch (e) { toast(e.message, { type: 'error' }); }
  }
  async function send(audience) {
    if (audience === 'clients' && !(await confirm({ title: 'Email every client?', message: 'This sends the banner email to every client who has an email address on file. Send a test to yourself first.', confirmLabel: 'Send to all clients' }))) return;
    setBusy(true);
    try {
      const r = await api.shop.promoSendEmail(mail.promo.id, { audience, test_to: testTo }, token);
      toast(`${r.sent} sent${r.failed ? `, ${r.failed} failed` : ''}`, { type: r.failed ? 'error' : 'success' });
    } catch (e) { toast(e.message, { type: 'error' }); } finally { setBusy(false); }
  }
  const live = (p) => p.active && (!p.starts_at || p.starts_at <= new Date().toISOString()) && (!p.ends_at || p.ends_at > new Date().toISOString());

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="max-w-2xl text-sm text-slate-600 dark:text-slate-300">Flash banners appear on the shop home page and, if ticked, on the main website. Use “Email” to send the same banner, with your on-sale products, to your clients.</p>
        {canManage && <button type="button" className={`${BTN} ml-auto`} onClick={() => openForm(null)}>+ New banner</button>}
      </div>
      {list.length === 0 && <p className="rounded-2xl bg-white py-14 text-center text-sm text-slate-500 dark:bg-slate-800">No banners yet.</p>}
      <div className="grid gap-3 lg:grid-cols-2">
        {list.map((p) => (
          <div key={p.id} className="rounded-2xl bg-white p-4 shadow-sm dark:border dark:border-slate-700 dark:bg-slate-800">
            <div className="flex items-center gap-2 text-xs"><span className="rounded-full bg-slate-900 px-2.5 py-0.5 font-bold text-white">{p.badge}</span><span className={live(p) ? 'font-bold text-emerald-600' : 'text-slate-500'}>{live(p) ? 'Live now' : p.active ? 'Scheduled / ended' : 'Off'}</span></div>
            <div className="mt-2 font-display text-lg font-extrabold text-slate-900 dark:text-white">{p.title}</div>
            <div className="text-sm text-slate-500">{p.subtitle}</div>
            <div className="mt-1 text-xs text-slate-500">{p.ends_at ? `Ends ${new Date(p.ends_at).toLocaleString()}` : 'No end date'} · links to {p.link_path}{p.show_on_main_site ? ' · on main site' : ''}</div>
            <div className="mt-3 flex gap-3 text-sm font-semibold">
              <button type="button" className="text-lagoon-700 dark:text-lagoon-300" onClick={() => openMail(p)}>Email</button>
              {canManage && <button type="button" className="text-lagoon-700 dark:text-lagoon-300" onClick={() => openForm(p)}>Edit</button>}
              {canManage && <button type="button" className="text-red-600" onClick={() => del(p)}>Delete</button>}
            </div>
          </div>
        ))}
      </div>

      <Modal open={editing !== undefined} onClose={() => setEditing(undefined)} title={editing ? 'Edit banner' : 'New banner'} maxWidthClass="max-w-2xl">
        <form onSubmit={save} className="space-y-3">
          <Field label="Headline"><input required className={INPUT} value={f.title} onChange={set('title')} placeholder="Big AC Sale — up to 25% off" /></Field>
          <Field label="Sub-headline"><input className={INPUT} value={f.subtitle} onChange={set('subtitle')} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Badge"><input className={INPUT} value={f.badge} onChange={set('badge')} /></Field>
            <Field label="Button text"><input className={INPUT} value={f.cta_label} onChange={set('cta_label')} /></Field>
            <Field label="Button goes to" hint="/sale, /products, /category/air-conditioners …"><input className={INPUT} value={f.link_path} onChange={set('link_path')} /></Field>
            <Field label="Colour"><select className={INPUT} value={f.theme} onChange={set('theme')}>{THEMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
            <Field label="Starts (optional)"><input type="datetime-local" className={INPUT} value={f.starts_at} onChange={set('starts_at')} /></Field>
            <Field label="Ends (shows a countdown)"><input type="datetime-local" className={INPUT} value={f.ends_at} onChange={set('ends_at')} /></Field>
          </div>
          <div className="text-sm"><span className="font-medium text-slate-700 dark:text-slate-300">Background picture (optional)</span>
            <div className="mt-1 flex items-center gap-3"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={pick} />{f.image && <span className="text-xs text-emerald-600">New picture ready</span>}{editing?.has_image && f.image === undefined && <button type="button" className="text-xs text-red-600" onClick={() => setF((s) => ({ ...s, image: null }))}>Remove current</button>}</div>
          </div>
          <div className="flex flex-wrap gap-6 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={f.active} onChange={set('active')} /> Active</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={f.show_on_main_site} onChange={set('show_on_main_site')} /> Show on the main website</label>
          </div>
          {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
          <div className="flex justify-end gap-2"><button type="button" className={BTN2} onClick={() => setEditing(undefined)}>Cancel</button><button disabled={busy} className={BTN}>{busy ? 'Saving…' : 'Save banner'}</button></div>
        </form>
      </Modal>

      <Modal open={Boolean(mail)} onClose={() => setMail(null)} title="Email banner" maxWidthClass="max-w-3xl">
        {mail && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600 dark:text-slate-300">Subject: <b>{mail.subject}</b> · shows {mail.products.length} on-sale product(s).</p>
            <iframe title="Email preview" sandbox="" srcDoc={mail.html} className="h-[26rem] w-full rounded-xl border border-slate-200 bg-white" />
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs">Send a test to<input className={`${INPUT} !mt-0 w-64`} value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="your email (blank = you)" /></label>
              <button type="button" disabled={busy || !canManage} className={BTN2} onClick={() => send('test')}>Send test</button>
              <button type="button" disabled={busy || !canManage} className={BTN} onClick={() => send('clients')}>Send to all clients</button>
            </div>
          </div>
        )}
      </Modal>
      {confirmDialog}
    </div>
  );
}
