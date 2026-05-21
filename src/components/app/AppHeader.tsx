import { useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Bell, ChevronDown, LogOut, User, Sparkles } from 'lucide-react';
import { useTour } from '@/components/onboarding/TourProvider';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

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
  const { profile, signOut } = useAuth();
  const { pathname } = useLocation();
  const { startTour, hasTourForCurrentPage } = useTour();
  const title = getPageTitle(pathname);

  const initials = profile?.full_name
    ? profile.full_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : profile?.email?.[0]?.toUpperCase() || 'U';

  const photoUrl = (profile as { profile_photo_url?: string | null } | null)?.profile_photo_url ?? undefined;

  const firstName = (() => {
    const name = profile?.full_name?.trim();
    if (name) {
      const parts = name.split(/\s+/);
      const first = parts[0];
      const lastInitial = parts.length > 1 ? ` ${parts[parts.length - 1][0].toUpperCase()}.` : '';
      return `${first}${lastInitial}`;
    }
    return profile?.email?.split('@')[0] || 'User';
  })();

  return (
    <header
      className="sticky top-0 z-30 flex items-center justify-between px-8 py-5"
      style={{
        background: 'color-mix(in srgb, var(--bg) 80%, transparent)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <h1 className="text-h4" style={{ color: 'var(--text)' }}>{title}</h1>

      <div className="flex items-center gap-3">
        <button
          aria-label="Notifications"
          className="relative w-10 h-10 rounded-full grid place-items-center transition-colors"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <Bell className="w-[18px] h-[18px]" strokeWidth={1.8} style={{ color: 'var(--text-body)' }} />
          <span className="absolute top-2 right-2 w-2 h-2 rounded-full" style={{ background: 'var(--c-pink)' }} />
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex items-center gap-2 pl-1 pr-3 py-1 rounded-full transition-colors"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              <Avatar className="h-8 w-8">
                {photoUrl ? <AvatarImage src={photoUrl} alt={profile?.full_name || 'User'} /> : null}
                <AvatarFallback className="text-button" style={{ background: 'var(--c-blue)', color: '#FFFFFF' }}>
                  {initials}
                </AvatarFallback>
              </Avatar>
              <span className="text-button hidden sm:inline" style={{ color: 'var(--text)' }}>{firstName}</span>
              <ChevronDown className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium">{profile?.full_name || 'User'}</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{profile?.email}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a href="/settings" className="flex items-center gap-2">
                <User className="w-4 h-4" />
                Settings
              </a>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={signOut} className="flex items-center gap-2">
              <LogOut className="w-4 h-4" />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
