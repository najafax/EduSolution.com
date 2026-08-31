import { useState } from 'react';
import { extractReference } from '../lib/extractReference';
import { ScanIcon } from './icons';

// Optional, best-effort OCR assist attached to the Reference field on the
// "Record payment" form (RecordPaymentModal.jsx) — lets staff photograph
// or upload a bank slip and have the reference/transaction number it
// prints pre-filled, instead of retyping it by hand. `tesseract.js` is
// loaded on demand via a dynamic `import()` rather than bundled into the
// main chunk — this is a rarely-clicked, one-off action, not something
// every page load should pay for, the same "route-level code-splitting"
// reasoning this app already applies to entire pages (see CLAUDE.md's own
// note on that). The recognition run itself needs tesseract's own worker/
// core/language files, which it fetches from its default CDN the first
// time it's used and caches locally afterward — this can fail outright on
// a very restrictive network (a corporate firewall blocking an unknown CDN
// domain, the same class of problem this business has already hit once —
// see the FortiGate incident this feature followed), so every failure here
// is caught and surfaced as a plain "couldn't read this automatically"
// notice, never a broken form. The Reference field itself
// (`RecordPaymentModal.jsx`) stays a normal, freely-editable text input
// regardless of whether a scan is attempted or what it finds — this is
// purely a shortcut to fill it in, never a requirement to record a
// payment, and whatever it detects is always meant to be double-checked
// against the real slip before saving.
export default function ScanPaymentSlip({ onDetected, disabled }) {
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const [scanNotice, setScanNotice] = useState('');

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // clears the input so re-selecting the same file still fires onChange
    if (!file) return;
    setScanning(true);
    setScanError('');
    setScanNotice('');
    try {
      const { default: Tesseract } = await import('tesseract.js');
      const { data } = await Tesseract.recognize(file, 'eng');
      const reference = extractReference(data.text);
      if (reference) {
        onDetected(reference);
        setScanNotice(`Detected "${reference}" — please double-check it against the slip before saving.`);
      } else {
        setScanError("Couldn't detect a reference number automatically — please enter it manually.");
      }
    } catch {
      setScanError("Couldn't scan this image — please enter the reference manually.");
    } finally {
      setScanning(false);
    }
  }

  return (
    <div>
      <label className="flex min-h-11 w-fit cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-slate-300 px-3 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
        <ScanIcon width={16} height={16} />
        {scanning ? 'Scanning slip…' : 'Scan payment slip (optional)'}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFile}
          disabled={scanning || disabled}
          className="hidden"
        />
      </label>
      {scanNotice && <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">{scanNotice}</p>}
      {scanError && <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{scanError}</p>}
    </div>
  );
}
