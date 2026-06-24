import { Bell, Sun, Moon } from 'lucide-react';
import { UserAvatarDropdown } from './UserAvatarDropdown';
import { useTheme } from '@/lib/theme';

/**
 * Slim global top bar. Intentionally does NOT show the page title — every
 * primary page renders its own colored `<PageHero />` which serves as the
 * page header. Showing the title here too would duplicate it.
 */
export function AppHeader() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

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
      {/* Global theme toggle — visible on every page */}
      <button
        type="button"
        onClick={() => setTheme(isDark ? 'light' : 'dark')}
        aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        className="inline-flex items-center gap-2 h-9 px-3 rounded-full border-2 shadow-md transition-all hover:scale-105"
        style={{
          background: isDark ? 'linear-gradient(135deg, #1e293b, #334155)' : 'linear-gradient(135deg, #fef3c7, #fde68a)',
          borderColor: isDark ? '#64748b' : '#f59e0b',
          color: isDark ? '#fbbf24' : '#92400e',
        }}
      >
        {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        <span className="text-xs font-semibold hidden sm:inline">
          {isDark ? 'Light' : 'Dark'}
        </span>
      </button>

      <button
        aria-label="Notifications"
        className="relative hidden sm:grid w-9 h-9 rounded-full place-items-center transition-colors"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <Bell className="w-[16px] h-[16px]" strokeWidth={1.8} style={{ color: 'var(--text-body)' }} />
        <span className="absolute top-2 right-2 w-2 h-2 rounded-full" style={{ background: 'var(--c-pink)' }} />
      </button>

      <UserAvatarDropdown />
    </header>
  );
}
