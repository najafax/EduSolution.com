import { useTheme } from '../context/ThemeContext';

const MODES = ['light', 'dark', 'system'];
const LABELS = { light: 'Light', dark: 'Dark', system: 'System' };

function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" strokeLinecap="round" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SystemIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" strokeLinecap="round" />
    </svg>
  );
}

const ICONS = { light: SunIcon, dark: MoonIcon, system: SystemIcon };

// Cycles light -> dark -> system on each click, showing the current mode's
// icon. A single click target (rather than a 3-way segmented control) to
// keep it compact in the navbar next to GlobalSearch/the nav links.
export default function ThemeToggle({ className = '' }) {
  const { theme, setTheme } = useTheme();
  const Icon = ICONS[theme];

  function cycle() {
    const next = MODES[(MODES.indexOf(theme) + 1) % MODES.length];
    setTheme(next);
  }

  return (
    <button
      type="button"
      onClick={cycle}
      title={`Theme: ${LABELS[theme]} (click to change)`}
      aria-label={`Theme: ${LABELS[theme]}. Click to change.`}
      className={`flex min-h-11 min-w-11 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200 ${className}`}
    >
      <Icon />
    </button>
  );
}
