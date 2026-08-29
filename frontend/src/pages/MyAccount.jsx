import { useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { roleLabel } from '../lib/roles';

// Client-side gate before ever attempting the upload — mirrors
// PortalInvoiceDetail.jsx's own PROOF_MAX_BYTES precedent, giving an
// immediate, friendly error rather than relying solely on the backend's
// own rejection (AVATAR_MAX_BYTES in routes/auth.js).
const AVATAR_MAX_BYTES = 3 * 1024 * 1024;

function fileToDataUri(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Same two-initial-from-name-or-email calc as Sidebar.jsx's own account
// row uses — kept as its own small copy here rather than a shared helper,
// same acceptable-duplication call this app already makes for
// comparably tiny, single-purpose bits of logic (e.g. EXPIRY_WARNING_DAYS).
function initialsFor(user) {
  return (user?.name || user?.email || '?')
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export default function MyAccount() {
  const { user, token, updateUser, updateToken } = useAuth();
  const avatarInputRef = useRef(null);

  const [profileForm, setProfileForm] = useState({ name: user?.name || '', email: user?.email || '' });
  const [profileError, setProfileError] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');
  const [profileSubmitting, setProfileSubmitting] = useState(false);

  const [avatarError, setAvatarError] = useState('');
  const [avatarBusy, setAvatarBusy] = useState(false);

  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '' });
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);

  const [notifyOverdue, setNotifyOverdue] = useState(Boolean(user?.notifyOverdue));
  const [notifyQuoteResponses, setNotifyQuoteResponses] = useState(Boolean(user?.notifyQuoteResponses));
  const [notifyMonthlyReport, setNotifyMonthlyReport] = useState(Boolean(user?.notifyMonthlyReport));
  const [notifyPaymentProofs, setNotifyPaymentProofs] = useState(Boolean(user?.notifyPaymentProofs));
  const [prefsError, setPrefsError] = useState('');
  const [prefsSuccess, setPrefsSuccess] = useState('');
  const [prefsSubmitting, setPrefsSubmitting] = useState(false);

  async function handleProfileSubmit(e) {
    e.preventDefault();
    setProfileError('');
    setProfileSuccess('');
    setProfileSubmitting(true);
    try {
      const { user: nextUser } = await api.updateMe(profileForm, token);
      updateUser(nextUser);
      setProfileSuccess('Profile updated.');
    } catch (err) {
      setProfileError(err.message);
    } finally {
      setProfileSubmitting(false);
    }
  }

  async function handleAvatarChange(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // lets picking the same file twice in a row still fire onChange
    if (!file) return;
    setAvatarError('');
    if (file.size > AVATAR_MAX_BYTES) {
      setAvatarError('Image is too large — please keep it under 3MB.');
      return;
    }
    setAvatarBusy(true);
    try {
      const dataUri = await fileToDataUri(file);
      const { user: nextUser } = await api.updateAvatar(dataUri, token);
      updateUser(nextUser);
    } catch (err) {
      setAvatarError(err.message);
    } finally {
      setAvatarBusy(false);
    }
  }

  async function handleAvatarRemove() {
    setAvatarError('');
    setAvatarBusy(true);
    try {
      const { user: nextUser } = await api.removeAvatar(token);
      updateUser(nextUser);
    } catch (err) {
      setAvatarError(err.message);
    } finally {
      setAvatarBusy(false);
    }
  }

  async function handlePasswordSubmit(e) {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');
    setPasswordSubmitting(true);
    try {
      const { token: nextToken } = await api.changePassword(passwordForm, token);
      updateToken(nextToken);
      setPasswordForm({ currentPassword: '', newPassword: '' });
      setPasswordSuccess('Password changed.');
    } catch (err) {
      setPasswordError(err.message);
    } finally {
      setPasswordSubmitting(false);
    }
  }

  async function handlePrefsSubmit(e) {
    e.preventDefault();
    setPrefsError('');
    setPrefsSuccess('');
    setPrefsSubmitting(true);
    try {
      await api.updatePreferences({ notifyOverdue, notifyQuoteResponses, notifyMonthlyReport, notifyPaymentProofs }, token);
      updateUser({ ...user, notifyOverdue, notifyQuoteResponses, notifyMonthlyReport, notifyPaymentProofs });
      setPrefsSuccess('Preferences saved.');
    } catch (err) {
      setPrefsError(err.message);
    } finally {
      setPrefsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white">My account</h1>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        {roleLabel(user?.role)} account. Contact an admin to change your role or module
        permissions.
      </p>

      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Photo</h2>
        <div className="mt-3 flex items-center gap-4">
          {user?.avatarImage ? (
            <img
              src={user.avatarImage}
              alt=""
              className="h-16 w-16 shrink-0 rounded-full object-cover ring-2 ring-slate-100 dark:ring-slate-800"
            />
          ) : (
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-lagoon-600 text-lg font-bold text-white">
              {initialsFor(user)}
            </span>
          )}
          <div className="flex flex-wrap gap-2">
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleAvatarChange}
              className="hidden"
            />
            <button
              type="button"
              disabled={avatarBusy}
              onClick={() => avatarInputRef.current?.click()}
              className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {avatarBusy ? 'Uploading…' : user?.avatarImage ? 'Change photo' : 'Upload photo'}
            </button>
            {user?.avatarImage && (
              <button
                type="button"
                disabled={avatarBusy}
                onClick={handleAvatarRemove}
                className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Remove
              </button>
            )}
          </div>
        </div>
        {avatarError && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{avatarError}</p>}
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">JPEG, PNG, or WEBP, up to 3MB.</p>
      </div>

      <form onSubmit={handleProfileSubmit} className="mt-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Profile</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Name</span>
            <input
              type="text"
              required
              value={profileForm.name}
              onChange={(e) => setProfileForm((f) => ({ ...f, name: e.target.value }))}
              className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Email</span>
            <input
              type="email"
              required
              value={profileForm.email}
              onChange={(e) => setProfileForm((f) => ({ ...f, email: e.target.value }))}
              className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            />
          </label>
        </div>
        {profileError && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{profileError}</p>}
        {profileSuccess && <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">{profileSuccess}</p>}
        <button
          type="submit"
          disabled={profileSubmitting}
          className="mt-3 min-h-11 rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500 disabled:opacity-60"
        >
          {profileSubmitting ? 'Saving…' : 'Save profile'}
        </button>
      </form>

      <form onSubmit={handlePasswordSubmit} className="mt-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Change password</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Current password</span>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={passwordForm.currentPassword}
              onChange={(e) => setPasswordForm((f) => ({ ...f, currentPassword: e.target.value }))}
              className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">New password</span>
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={passwordForm.newPassword}
              onChange={(e) => setPasswordForm((f) => ({ ...f, newPassword: e.target.value }))}
              className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            />
          </label>
        </div>
        {passwordError && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{passwordError}</p>}
        {passwordSuccess && <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">{passwordSuccess}</p>}
        <button
          type="submit"
          disabled={passwordSubmitting}
          className="mt-3 min-h-11 rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500 disabled:opacity-60"
        >
          {passwordSubmitting ? 'Saving…' : 'Change password'}
        </button>
      </form>

      <form onSubmit={handlePrefsSubmit} className="mt-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Notifications</h2>
        <label className="mt-3 flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            checked={notifyOverdue}
            onChange={(e) => setNotifyOverdue(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          <span className="text-sm text-slate-700 dark:text-slate-300">Email me a daily digest when overdue reminders are sent</span>
        </label>
        <label className="mt-2 flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            checked={notifyQuoteResponses}
            onChange={(e) => setNotifyQuoteResponses(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          <span className="text-sm text-slate-700 dark:text-slate-300">Email me when a client accepts a quote</span>
        </label>
        <label className="mt-2 flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            checked={notifyMonthlyReport}
            onChange={(e) => setNotifyMonthlyReport(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          <span className="text-sm text-slate-700 dark:text-slate-300">Email me a P&amp;L summary at the start of each month</span>
        </label>
        <label className="mt-2 flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            checked={notifyPaymentProofs}
            onChange={(e) => setNotifyPaymentProofs(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          <span className="text-sm text-slate-700 dark:text-slate-300">Email me when a client uploads a payment proof</span>
        </label>
        {prefsError && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{prefsError}</p>}
        {prefsSuccess && <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">{prefsSuccess}</p>}
        <button
          type="submit"
          disabled={prefsSubmitting}
          className="mt-3 min-h-11 rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500 disabled:opacity-60"
        >
          {prefsSubmitting ? 'Saving…' : 'Save preferences'}
        </button>
      </form>
    </div>
  );
}
