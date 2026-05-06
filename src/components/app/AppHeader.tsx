import { useAuth } from '@/lib/auth';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import energyForwardLogo from '@/assets/energyforward-logo.png';
import { ThemeSwitcher } from '@/components/theme/ThemeSwitcher';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LogOut, User } from 'lucide-react';

export function AppHeader() {
  const { profile, signOut } = useAuth();

  const initials = profile?.full_name
    ? profile.full_name.split(' ').map(n => n[0]).join('').toUpperCase()
    : profile?.email?.[0]?.toUpperCase() || 'U';

  const photoUrl = (profile as { profile_photo_url?: string | null } | null)?.profile_photo_url ?? undefined;

  return (
    <header
      className="h-20 px-6 grid items-center iri-glass"
      style={{
        gridTemplateColumns: '1fr auto 1fr',
        borderBottom: '1px solid var(--border-soft)',
      }}
    >
      {/* LEFT — Theme switcher */}
      <div className="flex items-center justify-start">
        <ThemeSwitcher />
      </div>

      {/* CENTER — Big centered logo */}
      <div className="flex items-center justify-center">
        <img
          src={energyForwardLogo}
          alt="EnergyForward"
          className="h-14 w-auto object-contain select-none"
          draggable={false}
        />
      </div>

      {/* RIGHT — User menu */}
      <div className="flex items-center justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 hover:opacity-80 transition-opacity rounded-full px-2 py-1 iri-border">
              <Avatar className="h-8 w-8">
                {photoUrl ? <AvatarImage src={photoUrl} alt={profile?.full_name || 'User'} /> : null}
                <AvatarFallback className="text-xs" style={{ background: 'var(--surface-2)', color: 'var(--text)' }}>{initials}</AvatarFallback>
              </Avatar>
              <span className="text-sm font-medium hidden sm:inline" style={{ color: 'var(--text)' }}>
                {(() => {
                  const name = profile?.full_name?.trim();
                  if (name) {
                    const parts = name.split(/\s+/);
                    const first = parts[0];
                    const lastInitial = parts.length > 1 ? ` ${parts[parts.length - 1][0].toUpperCase()}.` : '';
                    return `${first}${lastInitial}`;
                  }
                  return profile?.email?.split('@')[0] || 'User';
                })()}
              </span>
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

