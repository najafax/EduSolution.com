import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { roleLabel } from '../lib/roles';
import { useConfirm } from '../lib/useConfirm';

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

// Relative-enough "last active" phrasing for a session row — this app
// already has lib/date.js's own timeAgo() for the same kind of thing
// (InvoiceDetail.jsx's "Viewed by client…"), but that one is tuned for
// dates days/weeks old; a session's last_seen_at is far more often minutes
// or hours old, so this is its own small helper rather than stretching
// that one to cover both ranges.
function timeAgoShort(isoLike) {
  const then = new Date(isoLike.replace(' ', 'T') + 'Z').getTime();
  const diffMs = Date.now() - then;
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export default function MyAccount() {
  const { user, token, isSuperAdmin, updateUser, updateToken } = useAuth();
  const avatarInputRef = useRef(null);
  const { confirm, confirmDialog } = useConfirm();

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
  const [notifyAdminChanges, setNotifyAdminChanges] = useState(Boolean(user?.notifyAdminChanges));
  const [prefsError, setPrefsError] = useState('');
  const [prefsSuccess, setPrefsSuccess] = useState('');
  const [prefsSubmitting, setPrefsSubmitting] = useState(false);

  const [sessions, setSessions] = useState(null);
  const [sessionsError, setSessionsError] = useState('');
  const [revokingId, setRevokingId] = useState(null);

  function loadSessions() {
    api.sessions
      .list(token)
      .then((res) => setSessions(res.sessions))
      .catch((err) => setSessionsError(err.message));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadSessions, [token]);

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
      await api.updatePreferences(
        { notifyOverdue, notifyQuoteResponses, notifyMonthlyReport, notifyPaymentProofs, notifyAdminChanges },
        token,
      );
      updateUser({ ...user, notifyOverdue, notifyQuoteResponses, notifyMonthlyReport, notifyPaymentProofs, notifyAdminChanges });
      setPrefsSuccess('Preferences saved.');
    } catch (err) {
      setPrefsError(err.message);
    } finally {
      setPrefsSubmitting(false);
    }
  }

  async function handleRevokeSession(session) {
    if (
      !(await confirm({
        title: 'Sign out this device?',
        message: `This ends the session on ${session.userAgent || 'this device'}. It will need to log in again.`,
        confirmLabel: 'Sign out',
      }))
    )
      return;
    setSessionsError('');
    setRevokingId(session.id);
    try {
      await api.sessions.revoke(session.id, token);
      loadSessions();
    } catch (err) {
      setSessionsError(err.message);
    } finally {
      setRevokingId(null);
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
        {/* Only meaningful for a super admin — a plain admin/staff can't
            reach the Users page actions that would ever trigger this (see
            assertSuperAdminForAdminTier in routes/users.js), so showing the
            toggle to them would just be a checkbox that does nothing. */}
        {isSuperAdmin && (
          <label className="mt-2 flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={notifyAdminChanges}
              onChange={(e) => setNotifyAdminChanges(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            <span className="text-sm text-slate-700 dark:text-slate-300">
              Email me when a new admin or super admin account is created or promoted
            </span>
          </label>
        )}
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

      <div className="mt-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Active sessions</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Every device currently signed in as you. Sign out a device you don't recognize or left logged in
          somewhere.
        </p>
        {sessionsError && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{sessionsError}</p>}
        {!sessions && !sessionsError ? (
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">Loading…</p>
        ) : sessions && sessions.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
            No sessions to show yet — sign in again to start tracking this device.
          </p>
        ) : sessions ? (
          <ul className="mt-3 flex flex-col gap-2">
            {sessions.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2 dark:border-slate-700"
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="min-w-0 truncate text-sm text-slate-900 dark:text-white">
                      {s.userAgent || 'Unknown device'}
                    </p>
                    {s.isCurrent && (
                      <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                        This device
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Last active {timeAgoShort(s.lastSeenAt)}</p>
                </div>
                {!s.isCurrent && (
                  <button
                    type="button"
                    disabled={revokingId === s.id}
                    onClick={() => handleRevokeSession(s)}
                    className="min-h-11 shrink-0 rounded-md border border-red-200 px-3 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
                  >
                    {revokingId === s.id ? 'Signing out…' : 'Sign out'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {confirmDialog}
    </div>
  );
}
