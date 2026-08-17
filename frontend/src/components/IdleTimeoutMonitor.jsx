import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
const CHECK_INTERVAL_MS = 1000;

// react-router's navigate(to, { state }) can lose its state: logging out
// mid-navigation causes ProtectedRoute to independently redirect to /login
// too (it re-renders as soon as `token` clears), and whichever of the two
// redirects commits last wins, silently dropping the other's state. Handing
// the banner message off through sessionStorage instead of router state
// sidesteps that race entirely — Login.jsx reads and clears it on mount.
export const IDLE_LOGOUT_MESSAGE_KEY = 'edusolution_idle_logout_message';

// Warns before logging out an idle session, then actually logs out if
// nobody responds. `sessionTimeoutMinutes` comes from business_settings
// (see AuthContext) so an admin can tune it per CLAUDE.md's "Roles and
// permissions" — it applies to every logged-in user regardless of their
// own permission grants.
export default function IdleTimeoutMonitor() {
  const { token, sessionTimeoutMinutes, logout } = useAuth();
  const navigate = useNavigate();

  const lastActivityRef = useRef(Date.now());
  const warningActiveRef = useRef(false);
  const [warningSecondsLeft, setWarningSecondsLeft] = useState(null);

  useEffect(() => {
    warningActiveRef.current = warningSecondsLeft !== null;
  }, [warningSecondsLeft]);

  // Safety net: if the session ends any other way (e.g. the Navbar's own
  // "Log out" button) while the warning happens to be showing, make sure
  // the modal doesn't linger on top of whatever renders next.
  useEffect(() => {
    if (!token) setWarningSecondsLeft(null);
  }, [token]);

  // Track activity, but once the warning modal is showing, background
  // mouse/keyboard noise no longer resets the clock — only an explicit
  // "Stay signed in" click does, so a stray cursor twitch can't silently
  // dismiss a warning nobody consciously acknowledged.
  useEffect(() => {
    if (!token) return;
    function handleActivity() {
      if (!warningActiveRef.current) {
        lastActivityRef.current = Date.now();
      }
    }
    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, handleActivity, { passive: true }));
    return () => {
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, handleActivity));
    };
  }, [token]);

  useEffect(() => {
    if (!token || !sessionTimeoutMinutes) return;
    lastActivityRef.current = Date.now();
    setWarningSecondsLeft(null);

    const timeoutMs = sessionTimeoutMinutes * 60 * 1000;
    const warningMs = Math.min(60 * 1000, Math.floor(timeoutMs / 2));

    const interval = setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current;
      if (elapsed >= timeoutMs) {
        setWarningSecondsLeft(null);
        sessionStorage.setItem(IDLE_LOGOUT_MESSAGE_KEY, "You've been logged out due to inactivity.");
        logout();
        navigate('/login');
        return;
      }
      if (elapsed >= timeoutMs - warningMs) {
        setWarningSecondsLeft(Math.max(0, Math.ceil((timeoutMs - elapsed) / 1000)));
      }
    }, CHECK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [token, sessionTimeoutMinutes, logout, navigate]);

  function staySignedIn() {
    lastActivityRef.current = Date.now();
    setWarningSecondsLeft(null);
  }

  function logOutNow() {
    setWarningSecondsLeft(null);
    navigate('/login');
    logout();
  }

  if (warningSecondsLeft === null) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl dark:bg-slate-900">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Still there?</h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          You'll be logged out in <span className="font-semibold text-slate-900 dark:text-white">{warningSecondsLeft}</span>{' '}
          second{warningSecondsLeft === 1 ? '' : 's'} due to inactivity.
        </p>
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={staySignedIn}
            className="min-h-11 flex-1 rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500"
          >
            Stay signed in
          </button>
          <button
            type="button"
            onClick={logOutNow}
            className="min-h-11 flex-1 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Log out now
          </button>
        </div>
      </div>
    </div>
  );
}
