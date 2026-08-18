import { createContext, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext(null);
const STORAGE_KEY = 'edusolution_theme';
const MEDIA_QUERY = '(prefers-color-scheme: dark)';

function systemPrefersDark() {
  return window.matchMedia(MEDIA_QUERY).matches;
}

function applyTheme(resolvedTheme) {
  document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
}

// `theme` is the user's stored choice — 'light' | 'dark' | 'system'.
// `resolvedTheme` is always 'light' or 'dark', resolving 'system' against
// the OS preference — components that just need to know which palette is
// active (rather than offer the three-way picker) should read this.
// A visitor with nothing stored yet defaults to 'light', not 'system' — a
// first-time visitor on a device set to dark mode would otherwise land on
// a dark app with no indication that was ever a choice; the three-way
// toggle (ThemeToggle.jsx) is still one tap away for anyone who wants dark
// or to follow their OS. Index.html's pre-mount script mirrors this same
// "nothing stored → light" default so the very first paint matches.
export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => localStorage.getItem(STORAGE_KEY) || 'light');
  const [resolvedTheme, setResolvedTheme] = useState(() => (theme === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : theme));

  useEffect(() => {
    const resolved = theme === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : theme;
    setResolvedTheme(resolved);
    applyTheme(resolved);
  }, [theme]);

  useEffect(() => {
    if (theme !== 'system') return;
    const mql = window.matchMedia(MEDIA_QUERY);
    function handleChange() {
      const resolved = systemPrefersDark() ? 'dark' : 'light';
      setResolvedTheme(resolved);
      applyTheme(resolved);
    }
    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, [theme]);

  function setTheme(nextTheme) {
    localStorage.setItem(STORAGE_KEY, nextTheme);
    setThemeState(nextTheme);
  }

  return <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
