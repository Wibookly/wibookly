import { useTheme } from '@/lib/theme';
import { Sun, Moon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ModeToggleProps {
  /** Inline = sidebar style (full-width row). Icon = compact icon-only button. */
  variant?: 'inline' | 'icon';
  className?: string;
}

export function ModeToggle({ variant = 'inline', className }: ModeToggleProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const toggle = () => setTheme(isDark ? 'light' : 'dark');

  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        className={cn(
          'inline-flex items-center justify-center w-10 h-10 rounded-full border-2 shadow-md transition-colors',
          'bg-[var(--surface)] border-[var(--border-strong)] hover:border-primary hover:bg-[var(--surface-2)]',
          className,
        )}
      >
        {isDark ? (
          <Sun className="w-5 h-5 text-amber-400" />
        ) : (
          <Moon className="w-5 h-5 text-slate-700" />
        )}
      </button>
    );
  }

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
        className="relative inline-flex h-6 w-11 items-center rounded-full border-2 transition-colors"
        style={{
          background: isDark ? 'var(--c-blue)' : 'var(--surface-3)',
          borderColor: isDark ? 'var(--c-blue)' : 'var(--border-strong)',
        }}
      >
        <span
          className="inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform flex items-center justify-center"
          style={{ transform: isDark ? 'translateX(20px)' : 'translateX(0px)' }}
        >
          {isDark ? (
            <Moon className="w-3 h-3 text-slate-700" />
          ) : (
            <Sun className="w-3 h-3 text-amber-500" />
          )}
        </span>
      </span>
      <span className="text-button" style={{ color: 'var(--text-body)' }}>
        {isDark ? 'Dark Mode' : 'Light Mode'}
      </span>
    </button>
  );
}
