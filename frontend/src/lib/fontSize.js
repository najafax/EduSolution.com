// Per-device text size. Everything in the app is sized in rem, so scaling the
// root font size scales text, spacing, buttons and cards together. Stored in
// localStorage (a device preference, like the theme) and applied before first
// paint by a small script in index.html, so there is no flash of the wrong size.
export const FONT_SIZE_KEY = 'edusolution_font_size';
export const FONT_SIZE_MIN = 80;
export const FONT_SIZE_MAX = 140;
export const FONT_SIZE_DEFAULT = 100;

export const FONT_SIZE_PRESETS = [
  { label: 'Small', pct: 90 },
  { label: 'Default', pct: 100 },
  { label: 'Large', pct: 112 },
  { label: 'Extra large', pct: 125 },
];

function clamp(pct) {
  const n = Math.round(Number(pct));
  if (!Number.isFinite(n)) return FONT_SIZE_DEFAULT;
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, n));
}

export function getFontSize() {
  try {
    const raw = localStorage.getItem(FONT_SIZE_KEY);
    return raw === null ? FONT_SIZE_DEFAULT : clamp(raw);
  } catch {
    return FONT_SIZE_DEFAULT;
  }
}

export function applyFontSize(pct) {
  document.documentElement.style.fontSize = pct === FONT_SIZE_DEFAULT ? '' : `${pct}%`;
}

export function setFontSize(pct) {
  const value = clamp(pct);
  applyFontSize(value);
  try {
    if (value === FONT_SIZE_DEFAULT) localStorage.removeItem(FONT_SIZE_KEY);
    else localStorage.setItem(FONT_SIZE_KEY, String(value));
  } catch {
    // Storage unavailable (private window): still applies for this visit.
  }
  return value;
}
