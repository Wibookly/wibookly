import { Bell } from 'lucide-react';
import { UserAvatarDropdown } from './UserAvatarDropdown';

/**
 * Slim global top bar. Intentionally does NOT show the page title — every
 * primary page renders its own colored `<PageHero />` which serves as the
 * page header. Showing the title here too would duplicate it.
 */
export function AppHeader() {
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
