import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

export type Theme = 'light' | 'dark' | 'system';
export type ColorTheme = 'ocean' | 'sunset' | 'forest' | 'cosmic' | 'mocha';

export const COLOR_THEMES: { id: ColorTheme; name: string; subtitle: string; gradient: string }[] = [
  { id: 'ocean',  name: 'Ocean Tide',   subtitle: 'Calm focus',         gradient: 'linear-gradient(135deg, #2563EB 0%, #06B6D4 50%, #8B5CF6 100%)' },
  { id: 'sunset', name: 'Sunset Glow',  subtitle: 'Warm + inviting',    gradient: 'linear-gradient(135deg, #FACC15 0%, #EA580C 50%, #DB2777 100%)' },
  { id: 'forest', name: 'Forest Calm',  subtitle: 'Grounded + natural', gradient: 'linear-gradient(135deg, #14532D 0%, #65A30D 50%, #EAB308 100%)' },
  { id: 'cosmic', name: 'Cosmic Drift', subtitle: 'AI-forward',         gradient: 'linear-gradient(135deg, #6D28D9 0%, #D946EF 50%, #06B6D4 100%)' },
  { id: 'mocha',  name: 'Mocha Cream',  subtitle: 'Cozy + refined',     gradient: 'linear-gradient(135deg, #92400E 0%, #EA580C 50%, #FACC15 100%)' },
];

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: 'light' | 'dark';
  setTheme: (t: Theme) => void;
  colorTheme: ColorTheme;
  setColorTheme: (c: ColorTheme) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);
const MODE_KEY = 'inboxiq-theme';
const COLOR_KEY = 'inboxiq-color-theme';

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyMode(resolved: 'light' | 'dark') {
  document.documentElement.classList.toggle('dark', resolved === 'dark');
}

function applyColorTheme(c: ColorTheme) {
  document.documentElement.setAttribute('data-theme', c);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'system';
    return (localStorage.getItem(MODE_KEY) as Theme) || 'system';
  });
  const [colorTheme, setColorThemeState] = useState<ColorTheme>(() => {
    if (typeof window === 'undefined') return 'ocean';
    const saved = localStorage.getItem(COLOR_KEY) as ColorTheme | null;
    return saved && COLOR_THEMES.some((t) => t.id === saved) ? saved : 'ocean';
  });
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(() =>
    theme === 'system' ? getSystemTheme() : (theme as 'light' | 'dark')
  );

  useEffect(() => {
    const resolved = theme === 'system' ? getSystemTheme() : (theme as 'light' | 'dark');
    setResolvedTheme(resolved);
    applyMode(resolved);
  }, [theme]);

  useEffect(() => {
    applyColorTheme(colorTheme);
  }, [colorTheme]);

  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      const resolved = mq.matches ? 'dark' : 'light';
      setResolvedTheme(resolved);
      applyMode(resolved);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const setTheme = (t: Theme) => {
    localStorage.setItem(MODE_KEY, t);
    setThemeState(t);
  };
  const setColorTheme = (c: ColorTheme) => {
    localStorage.setItem(COLOR_KEY, c);
    setColorThemeState(c);
  };

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, colorTheme, setColorTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
