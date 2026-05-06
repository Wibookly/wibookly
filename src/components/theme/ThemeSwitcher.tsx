import { Sun, Moon } from 'lucide-react';
import { useTheme, COLOR_THEMES } from '@/lib/theme';
import { cn } from '@/lib/utils';

export function ThemeSwitcher() {
  const { colorTheme, setColorTheme, resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-full bg-card/80 backdrop-blur border border-border shadow-sm">
      <div className="flex items-center gap-1.5">
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
                'h-6 w-6 rounded-full transition-transform hover:scale-110',
                active && 'scale-110 ring-2 ring-primary ring-offset-2 ring-offset-card'
              )}
              style={{ background: t.gradient }}
            />
          );
        })}
      </div>
      <div className="h-5 w-px bg-border mx-1" />
      <button
        type="button"
        onClick={() => setTheme(isDark ? 'light' : 'dark')}
        className="flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium text-foreground hover:bg-secondary transition-colors"
        aria-label="Toggle light/dark mode"
        title="Toggle light/dark mode"
      >
        {isDark ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}
