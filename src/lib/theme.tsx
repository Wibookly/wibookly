import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

export type Theme = 'light' | 'dark' | 'system';
export type ColorTheme = 'aurora' | 'sunset' | 'ocean' | 'cosmic' | 'pearl';

export const COLOR_THEMES: { id: ColorTheme; name: string; subtitle: string; gradient: string }[] = [
  { id: 'aurora', name: 'Aurora',  subtitle: 'Full rainbow',      gradient: 'conic-gradient(from 0deg, #FF6B9D, #FFA500, #FFE66D, #6BFF95, #6BCBFF, #B26BFF, #FF6BD9, #FF6B9D)' },
  { id: 'sunset', name: 'Sunset',  subtitle: 'Warm rainbow',      gradient: 'linear-gradient(135deg, #FFE66D, #FFA500, #FF6B9D, #DC2626)' },
  { id: 'ocean',  name: 'Ocean',   subtitle: 'Cool rainbow',      gradient: 'linear-gradient(135deg, #6BFF95, #6BCBFF, #B26BFF, #FF6BD9)' },
  { id: 'cosmic', name: 'Cosmic',  subtitle: 'Vivid purple/cyan', gradient: 'linear-gradient(135deg, #B26BFF, #FF6BD9, #FF6B9D, #6BCBFF)' },
  { id: 'pearl',  name: 'Pearl',   subtitle: 'Soft pastel',       gradient: 'linear-gradient(135deg, #FFA0BC, #FFD8A0, #A0FFD8, #B8A0FF)' },
];

const LEGACY_MAP: Record<string, ColorTheme> = { forest: 'aurora', mocha: 'pearl' };

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
    if (typeof window === 'undefined') return 'aurora';
    const saved = localStorage.getItem(COLOR_KEY) as string | null;
    if (!saved) return 'aurora';
    const mapped = (LEGACY_MAP[saved] ?? saved) as ColorTheme;
    return COLOR_THEMES.some((t) => t.id === mapped) ? mapped : 'aurora';
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
