import { useEffect, useState } from 'react';
import { installUpdate, isUpdateReady, subscribeUpdate } from '../lib/appUpdate';

// Shown once a newer version of the app has been downloaded in the
// background. Nothing changes until the person taps "Update", so a form
// they are filling in is never wiped by a surprise reload.
export default function UpdateBanner() {
  const [ready, setReady] = useState(isUpdateReady());
  useEffect(() => subscribeUpdate(setReady), []);
  if (!ready) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-3 bottom-24 z-[60] mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-slate-900 p-3 pl-4 text-white shadow-xl sm:bottom-6 dark:bg-lagoon-700"
    >
      <span className="min-w-0 flex-1 text-sm font-medium">A new version is ready.</span>
      <button
        type="button"
        onClick={installUpdate}
        className="min-h-10 shrink-0 rounded-xl bg-white px-4 text-sm font-semibold text-slate-900"
      >
        Update
      </button>
    </div>
  );
}
