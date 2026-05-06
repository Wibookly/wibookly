import { useTheme } from '@/lib/theme';

export function ModeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const toggle = () => setTheme(isDark ? 'light' : 'dark');

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl transition-colors"
      style={{ background: 'transparent' }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--nav-hover-bg)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <span
        className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
        style={{ background: isDark ? 'var(--c-blue)' : 'var(--surface-3)' }}
      >
        <span
          className="inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform"
          style={{ transform: isDark ? 'translateX(22px)' : 'translateX(2px)' }}
        />
      </span>
      <span className="text-button" style={{ color: 'var(--text-body)' }}>
        {isDark ? 'Dark Mode' : 'Light Mode'}
      </span>
    </button>
  );
}
