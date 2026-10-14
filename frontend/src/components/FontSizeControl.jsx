import { useState } from 'react';
import {
  FONT_SIZE_DEFAULT,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  FONT_SIZE_PRESETS,
  getFontSize,
  setFontSize,
} from '../lib/fontSize';

// Text size picker: four presets plus a fine-grained slider for a custom size.
// Applies instantly and is remembered on this device.
export default function FontSizeControl() {
  const [pct, setPct] = useState(getFontSize);

  function change(next) {
    setPct(setFontSize(next));
  }

  const activePreset = FONT_SIZE_PRESETS.find((p) => p.pct === pct);

  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="Text size">
        {FONT_SIZE_PRESETS.map((p) => {
          const active = p.pct === pct;
          return (
            <button
              key={p.pct}
              type="button"
              onClick={() => change(p.pct)}
              aria-pressed={active}
              className={`min-h-11 rounded-xl border px-3 text-sm font-semibold ${
                active
                  ? 'border-slate-900 bg-slate-900 text-white dark:border-lagoon-600 dark:bg-lagoon-600'
                  : 'border-slate-300 text-slate-700 hover:bg-white/60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800'
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between text-xs font-medium text-slate-600 dark:text-slate-400">
          <label htmlFor="font-size-range">Custom size</label>
          <span>{pct}%{activePreset ? ` · ${activePreset.label}` : ' · Custom'}</span>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <span className="text-xs text-slate-500">A</span>
          <input
            id="font-size-range"
            type="range"
            min={FONT_SIZE_MIN}
            max={FONT_SIZE_MAX}
            step={1}
            value={pct}
            onChange={(e) => change(e.target.value)}
            className="h-2 w-full cursor-pointer accent-lagoon-600"
          />
          <span className="text-lg text-slate-500">A</span>
        </div>
      </div>

      <p className="mt-4 rounded-xl border border-slate-200/70 bg-white/40 p-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-200">
        Preview: invoices, quotes and clients all use this size.
      </p>

      {pct !== FONT_SIZE_DEFAULT && (
        <button
          type="button"
          onClick={() => change(FONT_SIZE_DEFAULT)}
          className="mt-3 text-sm font-semibold text-lagoon-700 hover:underline dark:text-lagoon-300"
        >
          Reset to default
        </button>
      )}
    </div>
  );
}
