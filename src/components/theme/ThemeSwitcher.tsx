import { Sun, Moon } from 'lucide-react';
import { useTheme, COLOR_THEMES } from '@/lib/theme';
import { cn } from '@/lib/utils';

/**
 * Compact, polished theme switcher: 5 small color dots + an animated
 * pill-shaped light/dark toggle. Sized to feel like a SaaS control, not
 * a row of large buttons.
 */
export function ThemeSwitcher() {
  const { colorTheme, setColorTheme, resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  return (
    <div className="flex items-center gap-2 px-2 py-1 rounded-full bg-card/90 backdrop-blur border border-border shadow-sm">
      <div className="flex items-center gap-1">
        {COLOR_THEMES.map((t) => {
          const active = t.id === colorTheme;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setColorTheme(t.id)}
              title={`${t.name} — ${t.subtitle}`}
              aria-label={`Switch to ${t.name} theme`}
              className={cn(
                'h-4 w-4 rounded-full transition-all duration-200 hover:scale-125',
                active
                  ? 'ring-2 ring-foreground/70 ring-offset-2 ring-offset-card scale-110'
                  : 'opacity-80 hover:opacity-100'
              )}
              style={{ background: t.gradient }}
            />
          );
        })}
      </div>

      <div className="h-4 w-px bg-border" />

      {/* Animated light/dark pill toggle */}
      <button
        type="button"
        onClick={() => setTheme(isDark ? 'light' : 'dark')}
        aria-label="Toggle light/dark mode"
        title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        className={cn(
          'relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-300',
          isDark
            ? 'bg-gradient-to-r from-indigo-900 via-slate-800 to-slate-900'
            : 'bg-gradient-to-r from-amber-300 via-amber-400 to-orange-400'
        )}
      >
        <span
          className={cn(
            'inline-flex h-5 w-5 items-center justify-center rounded-full bg-white shadow-md transform transition-transform duration-300',
            isDark ? 'translate-x-[22px]' : 'translate-x-[2px]'
          )}
        >
          {isDark ? (
            <Moon className="w-3 h-3 text-indigo-700" />
          ) : (
            <Sun className="w-3 h-3 text-amber-500" />
          )}
        </span>
      </button>
    </div>
  );
}
