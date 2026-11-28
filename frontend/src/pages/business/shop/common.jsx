import { resizeImage, dataUriByteLength } from '../../../lib/imageResize';

export const INPUT = 'mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white';
export const AREA = 'mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white';
export const BTN = 'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-lagoon-600 dark:hover:bg-lagoon-500';
export const BTN2 = 'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800';

export function Field({ label, hint, children, className = '' }) {
  return (
    <label className={`block text-sm font-medium text-slate-700 dark:text-slate-300 ${className}`}>
      {label}
      {children}
      {hint && <span className="mt-1 block text-xs font-normal text-slate-500">{hint}</span>}
    </label>
  );
}

export function Card({ children, className = '' }) {
  return <div className={`rounded-3xl bg-white p-4 shadow-sm dark:border dark:border-slate-700 dark:bg-slate-800 sm:p-6 ${className}`}>{children}</div>;
}

// Shrinks a chosen picture in the browser first (phone photos are huge) and
// returns a data URI the server accepts (<900KB).
export async function prepareImage(file, maxDimension = 1200) {
  const uri = await resizeImage(file, { maxDimension, quality: 0.85 });
  if (dataUriByteLength(uri) > 880 * 1024) {
    const smaller = await resizeImage(file, { maxDimension: 800, quality: 0.75 });
    if (dataUriByteLength(smaller) > 880 * 1024) throw new Error('That picture is still too large after shrinking. Try a simpler image.');
    return smaller;
  }
  return uri;
}

// <input type="datetime-local"> works in local time; the API stores UTC ISO.
export const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);
