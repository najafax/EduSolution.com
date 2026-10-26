import { useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';

// Two-step verification card for My account: turn it on (scan a QR code or
// type the key into an authenticator app, prove it works with one code, save
// the one-time recovery codes), turn it off, or get fresh recovery codes.
// Any account can use it; it is strongly recommended for admin-tier accounts.
const inputClass =
  'mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white';
const primaryBtn =
  'min-h-11 rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-700 dark:bg-lagoon-600 dark:hover:bg-lagoon-500 disabled:opacity-60';
const secondaryBtn =
  'min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800';

export default function TwoFactorCard() {
  const { user, token, updateUser, isAdmin } = useAuth();
  const enabled = Boolean(user?.twoFactorEnabled);

  // mode: 'idle' | 'setup' (QR shown, waiting for a code) | 'codes' (show recovery codes) | 'disable' | 'regen'
  const [mode, setMode] = useState('idle');
  const [setupData, setSetupData] = useState(null); // { secret, otpauthUri, qr }
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  function reset(nextMode = 'idle') {
    setMode(nextMode);
    setCode('');
    setPassword('');
    setError('');
  }

  async function startSetup() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const data = await api.twoFactor.setup(token);
      let qr = '';
      try {
        const QRCode = (await import('qrcode')).default;
        qr = await QRCode.toDataURL(data.otpauthUri, { margin: 1, width: 220 });
      } catch {
        // No QR — the key below can still be typed in by hand.
      }
      setSetupData({ ...data, qr });
      setMode('setup');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnable(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api.twoFactor.enable(code, token);
      updateUser({ ...user, twoFactorEnabled: true });
      setRecoveryCodes(res.recoveryCodes);
      setSetupData(null);
      reset('codes');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmDisable(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.twoFactor.disable(password, code, token);
      updateUser({ ...user, twoFactorEnabled: false });
      reset('idle');
      setNotice('Two-step verification is off.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmRegen(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api.twoFactor.newRecoveryCodes(password, code, token);
      setRecoveryCodes(res.recoveryCodes);
      reset('codes');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const passwordAndCode = (onSubmit, label, danger) => (
    <form onSubmit={onSubmit} className="mt-4 grid gap-3 sm:grid-cols-2">
      <label className="block">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Your password</span>
        <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Code from your app (or a recovery code)</span>
        <input required autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} className={inputClass} />
      </label>
      {error && <p className="text-sm text-red-600 dark:text-red-400 sm:col-span-2">{error}</p>}
      <div className="flex gap-2 sm:col-span-2">
        <button
          type="submit"
          disabled={busy}
          className={danger ? 'min-h-11 rounded-md bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60' : primaryBtn}
        >
          {busy ? 'Working…' : label}
        </button>
        <button type="button" onClick={() => reset('idle')} className={secondaryBtn}>
          Cancel
        </button>
      </div>
    </form>
  );

  return (
    <section className="mt-4 glass rounded-3xl p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Two-step verification</h2>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            enabled
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
          }`}
        >
          {enabled ? 'On' : 'Off'}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
        Adds a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, Authy…) to every
        sign-in, so a stolen password alone is not enough.
        {isAdmin && !enabled && <strong className="text-amber-700 dark:text-amber-400"> Strongly recommended for admin accounts.</strong>}
      </p>

      {notice && mode === 'idle' && <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">{notice}</p>}

      {mode === 'idle' && !enabled && (
        <>
          {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
          <button type="button" onClick={startSetup} disabled={busy} className={`mt-3 ${primaryBtn}`}>
            {busy ? 'Starting…' : 'Set up two-step verification'}
          </button>
        </>
      )}

      {mode === 'idle' && enabled && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => reset('regen')} className={secondaryBtn}>
            New recovery codes
          </button>
          <button type="button" onClick={() => reset('disable')} className={secondaryBtn}>
            Turn off
          </button>
        </div>
      )}

      {mode === 'setup' && setupData && (
        <form onSubmit={confirmEnable} className="mt-4">
          <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700 dark:text-slate-300">
            <li>Open your authenticator app and add an account.</li>
            <li>
              Scan this code, or on a phone <a className="font-medium text-lagoon-600 underline" href={setupData.otpauthUri}>tap here to open your app</a>.
            </li>
            <li>Type the 6-digit code it shows to finish.</li>
          </ol>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            {setupData.qr && <img src={setupData.qr} alt="QR code for your authenticator app" width={176} height={176} className="rounded-lg bg-white p-1" />}
            <div className="min-w-0 text-sm">
              <p className="text-slate-600 dark:text-slate-400">Can't scan? Enter this key by hand:</p>
              <p className="mt-1 break-all font-mono text-base tracking-wider text-slate-900 dark:text-white">{setupData.secret}</p>
            </div>
          </div>
          <label className="mt-4 block max-w-xs">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">6-digit code</span>
            <input inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} className={inputClass} />
          </label>
          {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="mt-3 flex gap-2">
            <button type="submit" disabled={busy} className={primaryBtn}>
              {busy ? 'Checking…' : 'Turn on'}
            </button>
            <button type="button" onClick={() => { setSetupData(null); reset('idle'); }} className={secondaryBtn}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {mode === 'codes' && (
        <div className="mt-4">
          <p className="text-sm font-medium text-slate-900 dark:text-white">Save your recovery codes now</p>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            Each code works once if you lose your phone. They are shown only this time — store them somewhere safe (a password manager is ideal).
          </p>
          <ul className="mt-3 grid grid-cols-2 gap-2 font-mono text-sm text-slate-900 dark:text-white sm:grid-cols-5">
            {recoveryCodes.map((c) => (
              <li key={c} className="rounded-md bg-slate-100 px-2 py-1.5 text-center dark:bg-slate-800">
                {c}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => navigator.clipboard?.writeText(recoveryCodes.join('\n'))} className={secondaryBtn}>
              Copy codes
            </button>
            <button type="button" onClick={() => { setRecoveryCodes([]); reset('idle'); }} className={primaryBtn}>
              I've saved them
            </button>
          </div>
        </div>
      )}

      {mode === 'disable' && passwordAndCode(confirmDisable, 'Turn off two-step verification', true)}
      {mode === 'regen' && passwordAndCode(confirmRegen, 'Make new recovery codes', false)}
    </section>
  );
}
