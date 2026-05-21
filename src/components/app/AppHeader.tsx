import { useLocation } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { UserAvatarDropdown } from './UserAvatarDropdown';

const ROUTE_TITLES: Record<string, string> = {
  '/': 'Home',
  '/chat': 'AI Chat',
  '/categories': 'Email Intelligence',
  '/follow-up-reminder': 'No Reply Tracker',
  '/settings': 'My Profile',
  '/email-draft': 'AI Drafts',
  '/integrations': 'Email & Calendar',
  '/ai-activity': 'AI Activity',
  '/ai-daily-brief': 'My Daily Brief',
  '/admin': 'Admin Dashboard',
  '/knowledge': 'Knowledge',
  '/sync': 'Sync',
};

function getPageTitle(pathname: string): string {
  if (ROUTE_TITLES[pathname]) return ROUTE_TITLES[pathname];
  const match = Object.keys(ROUTE_TITLES).find(p => p !== '/' && pathname.startsWith(p));
  if (match) return ROUTE_TITLES[match];
  return 'InboxIQ';
}

export function AppHeader() {
  const { pathname } = useLocation();
  const title = getPageTitle(pathname);

  return (
    <header
      className="sticky top-0 z-30 flex items-center justify-between gap-4 px-4 py-4 lg:px-6"
      style={{
        background: 'color-mix(in srgb, var(--bg) 80%, transparent)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <h1 className="text-h4 min-w-0" style={{ color: 'var(--text)' }}>{title}</h1>

      <div className="flex items-center gap-2 lg:gap-3 shrink-0">
        <button
          aria-label="Notifications"
          className="relative hidden sm:grid w-10 h-10 rounded-full place-items-center transition-colors"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <Bell className="w-[18px] h-[18px]" strokeWidth={1.8} style={{ color: 'var(--text-body)' }} />
          <span className="absolute top-2 right-2 w-2 h-2 rounded-full" style={{ background: 'var(--c-pink)' }} />
        </button>

        <UserAvatarDropdown />
      </div>
    </header>
  );
}
