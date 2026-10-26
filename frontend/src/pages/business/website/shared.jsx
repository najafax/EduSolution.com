import { resizeImage, dataUriByteLength } from '../../../lib/imageResize';

export const SERVICE_ICON_OPTIONS = [
  { value: 'service', label: 'General' },
  { value: 'school', label: 'School / education' },
  { value: 'business', label: 'Business / billing' },
  { value: 'support', label: 'Support' },
  { value: 'reports', label: 'Reports' },
  { value: 'license', label: 'License / access' },
];

const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_IMAGE_BYTES = 400 * 1024;

// Shared by the Team and Gallery sections below — same client-side resize
// Settings.jsx's own logo/signature upload uses (lib/imageResize.js), since
// this app has no separate file storage service and a team/gallery photo is
// routinely a full-resolution phone export well past what a small team
// headshot or gallery thumbnail ever needs to render at.
export function ImageField({ label, value, onChange, onError }) {
  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    onError('');
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      onError(`${label} must be a PNG, JPEG or WEBP image`);
      return;
    }
    try {
      const dataUri = await resizeImage(file, { maxDimension: 1200 });
      if (dataUriByteLength(dataUri) > MAX_IMAGE_BYTES) {
        onError(`${label} is still too large after resizing — please use a smaller or simpler image`);
        return;
      }
      onChange(dataUri);
    } catch (err) {
      onError(err.message || `Could not read the selected file for ${label}`);
    }
  }

  return (
    <div className="block">
      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
      {value ? (
        <div className="mt-1 flex items-center gap-3">
          <img src={value} alt="" className="h-16 w-16 rounded-md border border-slate-200 object-cover dark:border-slate-700" />
          <button
            type="button"
            onClick={() => onChange('')}
            className="min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Remove
          </button>
        </div>
      ) : (
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={handleFile}
          className="mt-1 block w-full text-sm text-slate-600 file:mr-3 file:min-h-11 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:text-sm file:font-medium file:text-slate-700 dark:text-slate-400 dark:file:bg-slate-800 dark:file:text-slate-200"
        />
      )}
    </div>
  );
}

export const TEXT_INPUT = 'mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white';
export const TEXTAREA = 'mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white';
export const CHECKBOX = 'h-4 w-4 rounded border-slate-300';

export function FormActions({ submitting, onCancel }) {
  return (
    <div className="flex gap-3 sm:col-span-2">
      <button
        type="submit"
        disabled={submitting}
        className="min-h-11 rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-700 dark:bg-lagoon-600 dark:hover:bg-lagoon-500 disabled:opacity-60"
      >
        {submitting ? 'Saving…' : 'Save'}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        Cancel
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// News & announcements
// ---------------------------------------------------------------------------

