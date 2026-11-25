import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

const INTERESTS = [
  { value: 'edupage', label: 'EduPage (timetables, grades, communication)' },
  { value: 'business_suite', label: 'Business Suite (quotes, invoices, licences)' },
  { value: 'both', label: 'Both' },
  { value: 'unsure', label: 'Not sure yet' },
];
const FIELD =
  'w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 focus:border-lagoon-500 focus:outline-none focus:ring-2 focus:ring-lagoon-500/30 dark:border-slate-600 dark:bg-slate-900 dark:text-white';
const EMPTY = { name: '', organisation: '', email: '', phone: '', interest: 'unsure', message: '' };

// Public walkthrough-request form (POST /api/public/enquiries). The hidden
// "website" field is a honeypot and `t` (when the form appeared) lets the
// server drop instant bot submissions; the optional Cloudflare Turnstile
// challenge shows only when the server reports a site key.
export default function EnquiryForm({ turnstileSiteKey = '' }) {
  const [form, setForm] = useState(EMPTY);
  const [trap, setTrap] = useState('');
  const [openedAt, setOpenedAt] = useState(() => Date.now());
  const [state, setState] = useState('idle'); // idle | sending | done
  const [error, setError] = useState('');
  const [tsToken, setTsToken] = useState('');
  const tsRef = useRef(null);
  const widgetId = useRef(null);

  useEffect(() => {
    if (!turnstileSiteKey || state === 'done') return undefined;
    let cancelled = false;
    function render() {
      if (cancelled || !tsRef.current || !window.turnstile) return;
      widgetId.current = window.turnstile.render(tsRef.current, {
        sitekey: turnstileSiteKey,
        callback: (t) => setTsToken(t),
        'expired-callback': () => setTsToken(''),
      });
    }
    if (window.turnstile) render();
    else {
      let script = document.getElementById('cf-turnstile-script');
      if (!script) {
        script = document.createElement('script');
        script.id = 'cf-turnstile-script';
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        document.head.appendChild(script);
      }
      script.addEventListener('load', render);
    }
    return () => {
      cancelled = true;
      if (widgetId.current != null && window.turnstile) {
        try {
          window.turnstile.remove(widgetId.current);
        } catch {
          /* already gone */
        }
      }
      widgetId.current = null;
    };
  }, [turnstileSiteKey, state]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (turnstileSiteKey && !tsToken) {
      setError('Please complete the spam check below.');
      return;
    }
    setState('sending');
    try {
      await api.public.sendEnquiry({ ...form, website: trap, t: openedAt, turnstileToken: tsToken });
      setState('done');
    } catch (err) {
      setError(err.message);
      setState('idle');
      if (widgetId.current != null && window.turnstile) window.turnstile.reset(widgetId.current);
      setTsToken('');
    }
  }

  if (state === 'done') {
    return (
      <div role="status" className="rounded-3xl bg-white p-8 text-center dark:bg-slate-900">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-xl text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
          ✓
        </div>
        <h3 className="font-display mt-4 text-xl font-bold text-slate-900 dark:text-white">Thanks, we have your request</h3>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          We will contact you within one working day to agree a time. A copy of your message is on its way to your inbox.
        </p>
        <button
          type="button"
          onClick={() => {
            setForm(EMPTY);
            setOpenedAt(Date.now());
            setState('idle');
          }}
          className="mt-5 min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Send another
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-3xl bg-white p-5 text-left dark:bg-slate-900 sm:p-7">
      <h2 className="font-display text-xl font-extrabold text-slate-900 dark:text-white">Book a walkthrough</h2>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        A 30-minute call. We show EduPage or the Business Suite on your own school's setup. No obligation.
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-semibold text-slate-800 dark:text-slate-200">
          Your name
          <input className={`${FIELD} mt-1 font-normal`} required maxLength={120} autoComplete="name" value={form.name} onChange={set('name')} />
        </label>
        <label className="block text-sm font-semibold text-slate-800 dark:text-slate-200">
          School or organisation
          <input className={`${FIELD} mt-1 font-normal`} maxLength={160} autoComplete="organization" value={form.organisation} onChange={set('organisation')} />
        </label>
        <label className="block text-sm font-semibold text-slate-800 dark:text-slate-200">
          Email
          <input className={`${FIELD} mt-1 font-normal`} type="email" required maxLength={200} autoComplete="email" value={form.email} onChange={set('email')} />
        </label>
        <label className="block text-sm font-semibold text-slate-800 dark:text-slate-200">
          Phone <span className="font-normal text-slate-500">(Viber / WhatsApp ok)</span>
          <input className={`${FIELD} mt-1 font-normal`} type="tel" maxLength={40} autoComplete="tel" value={form.phone} onChange={set('phone')} />
        </label>
        <label className="block text-sm font-semibold text-slate-800 dark:text-slate-200 sm:col-span-2">
          I am interested in
          <select className={`${FIELD} mt-1 font-normal`} value={form.interest} onChange={set('interest')}>
            {INTERESTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-semibold text-slate-800 dark:text-slate-200 sm:col-span-2">
          Anything we should know? <span className="font-normal text-slate-500">(optional)</span>
          <textarea className={`${FIELD} mt-1 min-h-24 font-normal`} maxLength={2000} value={form.message} onChange={set('message')} />
        </label>
      </div>

      {/* Honeypot: people never see or fill this. */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
        <label>
          Leave empty
          <input tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} />
        </label>
      </div>

      {turnstileSiteKey && <div ref={tsRef} className="mt-4" />}
      {error && (
        <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={state === 'sending'}
        className="mt-5 min-h-11 w-full rounded-xl bg-slate-900 px-6 text-sm font-bold text-white hover:bg-slate-700 disabled:opacity-60 dark:bg-lagoon-600 dark:hover:bg-lagoon-500 sm:w-auto"
      >
        {state === 'sending' ? 'Sending…' : 'Request walkthrough'}
      </button>
      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
        We reply within one working day. We only use your details to answer you.
      </p>
    </form>
  );
}
