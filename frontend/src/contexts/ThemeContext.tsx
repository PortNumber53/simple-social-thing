import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
export type EffectiveTheme = 'light' | 'dark';

const STORAGE_KEY = 'sst-theme';

function getSystemTheme(): EffectiveTheme {
  if (typeof window === 'undefined') return 'light';
  if (!window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function computeEffectiveTheme(mode: ThemeMode): EffectiveTheme {
  if (mode === 'system') return getSystemTheme();
  return mode;
}

function applyThemeToDocument(effective: EffectiveTheme) {
  if (typeof document === 'undefined') return;
  const isDark = effective === 'dark';
  document.documentElement.classList.toggle('dark', isDark);
  // Helps native form controls match the theme.
  document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
}

function readStoredMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    // ignore
  }
  return 'system';
}

function writeStoredMode(mode: ThemeMode) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}

type ThemeContextValue = {
  mode: ThemeMode;
  effectiveTheme: EffectiveTheme;
  setMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => readStoredMode());
  const [systemTheme, setSystemTheme] = useState<EffectiveTheme>(() => getSystemTheme());

  // Track system theme changes (only matters when mode === 'system').
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystemTheme(mq.matches ? 'dark' : 'light');
    onChange();
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
    // Safari < 14
    // eslint-disable-next-line deprecation/deprecation
    mq.addListener(onChange);
    // eslint-disable-next-line deprecation/deprecation
    return () => mq.removeListener(onChange);
  }, []);

  const effectiveTheme = useMemo<EffectiveTheme>(() => {
    if (mode === 'system') return systemTheme;
    return mode;
  }, [mode, systemTheme]);

  useEffect(() => {
    applyThemeToDocument(effectiveTheme);
  }, [effectiveTheme]);

  const setMode = (next: ThemeMode) => {
    setModeState(next);
    writeStoredMode(next);
    // Apply immediately to reduce perceived lag.
    applyThemeToDocument(computeEffectiveTheme(next));
  };

  const value = useMemo<ThemeContextValue>(() => ({ mode, effectiveTheme, setMode }), [mode, effectiveTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

