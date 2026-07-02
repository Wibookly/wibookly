import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

export type Theme = 'light' | 'dark' | 'system';

export type Palette =
  | 'aurora' | 'indigo' | 'violet' | 'sunset' | 'rose'
  | 'emerald' | 'sky' | 'amber' | 'crimson' | 'magenta' | 'cinnamon';

export interface PaletteDef {
  id: Palette;
  name: string;
  /** Two-stop swatch shown in the dropdown */
  swatch: [string, string];
}

export const PALETTES: PaletteDef[] = [
  { id: 'aurora',   name: 'Aurora',   swatch: ['#2C6BEF', '#A855F7'] },
  { id: 'indigo',   name: 'Indigo',   swatch: ['#4F46E5', '#2B6EE3'] },
  { id: 'violet',   name: 'Violet',   swatch: ['#7C3AED', '#C026D3'] },
  { id: 'sunset',   name: 'Sunset',   swatch: ['#F97316', '#EC4899'] },
  { id: 'rose',     name: 'Rose',     swatch: ['#E11D74', '#8B5CF6'] },
  { id: 'emerald',  name: 'Emerald',  swatch: ['#059669', '#14B8A6'] },
  { id: 'sky',      name: 'Sky',      swatch: ['#0EA5E9', '#06B6D4'] },
  { id: 'amber',    name: 'Amber',    swatch: ['#D97706', '#F59E0B'] },
  { id: 'crimson',  name: 'Crimson',  swatch: ['#DC2626', '#F97316'] },
  { id: 'magenta',  name: 'Magenta',  swatch: ['#C026D3', '#A855F7'] },
  { id: 'cinnamon', name: 'Cinnamon', swatch: ['#BA7517', '#FAC775'] },
];

/* --- Legacy compatibility (old code imports ColorTheme/COLOR_THEMES) --- */
export type ColorTheme = Palette;
export const COLOR_THEMES = PALETTES.map((p) => ({
  id: p.id,
  name: p.name,
  subtitle: '',
  gradient: `linear-gradient(135deg, ${p.swatch[0]}, ${p.swatch[1]})`,
}));

const LEGACY_PALETTE_MAP: Record<string, Palette> = {
  ocean: 'sky', cosmic: 'violet', pearl: 'aurora', forest: 'emerald', mocha: 'amber',
};

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: 'light' | 'dark';
  setTheme: (t: Theme) => void;
  palette: Palette;
  setPalette: (p: Palette) => void;
  /** Legacy aliases */
  colorTheme: Palette;
  setColorTheme: (p: Palette) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);
const MODE_KEY = 'inboxiq-mode';
const LEGACY_MODE_KEY = 'inboxiq-theme';
const PALETTE_KEY = 'inboxiq-palette';
const LEGACY_COLOR_KEY = 'inboxiq-color-theme';




function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyMode(resolved: 'light' | 'dark') {
  document.documentElement.classList.toggle('dark', resolved === 'dark');
}

function applyPalette(p: Palette) {
  document.documentElement.setAttribute('data-palette', p);
  // Keep data-theme set so existing [data-theme=...] rules still match.
  document.documentElement.setAttribute('data-theme', p);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'system';
    return (localStorage.getItem(MODE_KEY) as Theme)
        || (localStorage.getItem(LEGACY_MODE_KEY) as Theme)
        || 'system';
  });

  const [palette, setPaletteState] = useState<Palette>(() => {
    if (typeof window === 'undefined') return 'aurora';
    const saved = localStorage.getItem(PALETTE_KEY) || localStorage.getItem(LEGACY_COLOR_KEY);
    if (!saved) return 'aurora';
    const mapped = (LEGACY_PALETTE_MAP[saved] ?? saved) as Palette;
    return PALETTES.some((p) => p.id === mapped) ? mapped : 'aurora';
  });
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(() =>
    theme === 'system' ? getSystemTheme() : (theme as 'light' | 'dark')
  );

  useEffect(() => {
    const resolved = theme === 'system' ? getSystemTheme() : (theme as 'light' | 'dark');
    setResolvedTheme(resolved);
    applyMode(resolved);
  }, [theme]);

  useEffect(() => { applyPalette(palette); }, [palette]);

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
  const setPalette = (p: Palette) => {
    localStorage.setItem(PALETTE_KEY, p);
    setPaletteState(p);
  };

  return (
    <ThemeContext.Provider value={{
      theme, resolvedTheme, setTheme,
      palette, setPalette,
      colorTheme: palette, setColorTheme: setPalette,
    }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
