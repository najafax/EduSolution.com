import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { useToast } from '../../../context/ToastContext';
import { INPUT, AREA, BTN, Card, Field, prepareImage } from './common';

export default function SettingsTab({ token, canManage }) {
  const { toast } = useToast();
  const [f, setF] = useState(null);
  const [hero, setHero] = useState(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { api.shop.settings(token).then((r) => setF(r.settings)); }, [token]);
  if (!f) return <p className="py-10 text-center text-sm text-slate-500">Loading…</p>;
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  async function pick(e) {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    try { setHero(await prepareImage(file, 1800)); } catch (err) { setError(err.message); }
  }
  async function save(e) {
    e.preventDefault(); setBusy(true); setError('');
    const payload = { ...f, card_enabled: Boolean(f.card_enabled) };
    delete payload.hero_image; delete payload.has_hero_image;
    if (hero !== undefined) payload.hero_image = hero;
    try { await api.shop.saveSettings(payload, token); toast('Shop settings saved', { type: 'success' }); setHero(undefined); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  const dis = !canManage;
  return (
    <form onSubmit={save} className="space-y-4">
      <Card className="space-y-3">
        <h2 className="font-display text-lg font-extrabold text-slate-900 dark:text-white">Storefront</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Shop name"><input disabled={dis} className={INPUT} value={f.shop_name} onChange={set('shop_name')} /></Field>
          <Field label="Tagline"><input disabled={dis} className={INPUT} value={f.tagline} onChange={set('tagline')} /></Field>
          <Field label="Top announcement bar" hint="One line above the header. Leave blank to hide." className="sm:col-span-2"><input disabled={dis} className={INPUT} value={f.announcement} onChange={set('announcement')} placeholder="Free delivery to your boat on orders over MVR 5,000" /></Field>
          <Field label="Home page headline" className="sm:col-span-2"><input disabled={dis} className={INPUT} value={f.hero_title} onChange={set('hero_title')} /></Field>
          <Field label="Home page sub-headline" className="sm:col-span-2"><input disabled={dis} className={INPUT} value={f.hero_subtitle} onChange={set('hero_subtitle')} /></Field>
        </div>
        <div className="text-sm"><span className="font-medium text-slate-700 dark:text-slate-300">Home page background picture</span>
          <div className="mt-1 flex flex-wrap items-center gap-3"><input disabled={dis} type="file" accept="image/png,image/jpeg,image/webp" onChange={pick} />{f.has_hero_image && hero === undefined && <><span className="text-xs text-slate-500">One is set.</span>{canManage && <button type="button" className="text-xs text-red-600" onClick={() => setHero(null)}>Remove</button>}</>}{hero && <span className="text-xs text-emerald-600">New picture ready — save to apply</span>}{hero === null && <span className="text-xs text-amber-600">Will be removed on save</span>}</div>
        </div>
      </Card>
      <Card className="space-y-3">
        <h2 className="font-display text-lg font-extrabold text-slate-900 dark:text-white">Contact, delivery & payment</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Phone"><input disabled={dis} className={INPUT} value={f.phone} onChange={set('phone')} /></Field>
          <Field label="WhatsApp number" hint="Used for the Chat on WhatsApp buttons."><input disabled={dis} className={INPUT} value={f.whatsapp} onChange={set('whatsapp')} /></Field>
          <Field label="Shop email"><input disabled={dis} className={INPUT} value={f.email} onChange={set('email')} /></Field>
          <Field label="Email me new orders at" hint="Comma-separated. Blank = staff who ticked enquiry emails."><input disabled={dis} className={INPUT} value={f.notify_email} onChange={set('notify_email')} /></Field>
          <Field label="Delivery note" className="sm:col-span-2"><textarea disabled={dis} rows={2} className={AREA} value={f.delivery_note} onChange={set('delivery_note')} /></Field>
          <Field label="Warranty note" className="sm:col-span-2"><input disabled={dis} className={INPUT} value={f.warranty_note} onChange={set('warranty_note')} /></Field>
          <Field label="Bank details for transfers" hint="Blank = uses the bank details from Settings." className="sm:col-span-2"><textarea disabled={dis} rows={3} className={AREA} value={f.bank_details} onChange={set('bank_details')} /></Field>
          <Field label="Terms of sale" className="sm:col-span-2"><textarea disabled={dis} rows={5} className={AREA} value={f.terms} onChange={set('terms')} /></Field>
        </div>
        <label className="flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-900"><input disabled={dis} type="checkbox" className="mt-1" checked={Boolean(f.card_enabled)} onChange={set('card_enabled')} />
          <span><b>Offer card payment</b><br /><span className="text-slate-500">Customers can choose “Card”. You then send them a secure payment link from your bank or gateway. Fully automatic card payment needs a merchant account with your bank and is added separately.</span></span></label>
        <Field label="Card provider note (private)"><input disabled={dis} className={INPUT} value={f.card_provider} onChange={set('card_provider')} placeholder="e.g. BML Connect" /></Field>
      </Card>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      {canManage && <button disabled={busy} className={BTN}>{busy ? 'Saving…' : 'Save shop settings'}</button>}
    </form>
  );
}
