import { Sun, Moon, Check, Palette as PaletteIcon } from 'lucide-react';
import { UserAvatarDropdown } from './UserAvatarDropdown';
import { SupportBell } from '@/components/help/SupportBell';
import { useTheme, PALETTES, type Palette } from '@/lib/theme';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * Slim global top bar. Light/dark toggle (sun shown in dark mode, moon in
 * light mode) plus a palette dropdown for the 10 app-wide color themes.
 */
export function AppHeader() {
  const { resolvedTheme, setTheme, palette, setPalette } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const current = PALETTES.find((p) => p.id === palette) ?? PALETTES[0];

  return (
    <header
      className="sticky top-0 z-30 flex items-center justify-end gap-2 px-4 py-3 lg:px-6"
      style={{
        background: 'color-mix(in srgb, var(--bg) 80%, transparent)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderBottom: '1px solid var(--border)',
      }}
    >
      {/* Palette picker */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Change color theme"
            title={`Theme: ${current.name}`}
            className="inline-flex items-center gap-2 h-9 px-2.5 rounded-full transition-all hover:scale-105"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <span
              aria-hidden
              className="inline-block h-5 w-5 rounded-full shrink-0"
              style={{
                background: `linear-gradient(135deg, ${current.swatch[0]}, ${current.swatch[1]})`,
                boxShadow: '0 0 0 2px var(--surface)',
              }}
            />
            <PaletteIcon className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
            Color theme
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {PALETTES.map((p) => {
            const active = p.id === palette;
            return (
              <DropdownMenuItem
                key={p.id}
                onClick={() => setPalette(p.id as Palette)}
                className="flex items-center gap-2 cursor-pointer"
              >
                <span
                  aria-hidden
                  className="inline-block h-4 w-4 rounded-full shrink-0"
                  style={{ background: `linear-gradient(135deg, ${p.swatch[0]}, ${p.swatch[1]})` }}
                />
                <span className="flex-1 text-sm">{p.name}</span>
                {active && <Check className="w-3.5 h-3.5" style={{ color: 'var(--primary)' }} />}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Light/dark toggle: shows sun in dark mode, moon in light mode */}
      <button
        type="button"
        onClick={() => setTheme(isDark ? 'light' : 'dark')}
        aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        className="inline-flex items-center justify-center w-9 h-9 rounded-full transition-all hover:scale-105"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          color: isDark ? '#FBBF24' : '#475569',
        }}
      >
        {isDark ? <Sun className="w-[18px] h-[18px]" /> : <Moon className="w-[18px] h-[18px]" />}
      </button>

      <UserAvatarDropdown />
    </header>
  );
}
