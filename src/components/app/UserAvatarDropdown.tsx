import { useAuth } from '@/lib/auth';
import { useTheme, type Theme } from '@/lib/theme';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';
import { LogOut, User, Sun, Moon, Monitor, Volume2, AlertCircle, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ttsService, type TtsState } from '@/lib/ttsService';

export function UserAvatarDropdown() {
  const { profile, signOut } = useAuth();
  const { theme, setTheme } = useTheme();

  // Extract first name + last initial (e.g. "John D.") - no email fallback
  const getNameParts = () => {
    if (profile?.full_name) {
      const parts = profile.full_name.trim().split(/\s+/);
      const first = parts[0] || 'User';
      const lastInitial = parts.length > 1 ? parts[parts.length - 1].charAt(0).toUpperCase() : '';
      return { first, lastInitial };
    }
    return { first: 'User', lastInitial: '' };
  };

  const { first: firstName, lastInitial } = getNameParts();
  const displayName = lastInitial ? `${firstName} ${lastInitial}.` : firstName;
  const fullName = profile?.full_name?.trim() || displayName;
  const initials = (firstName.charAt(0) + (lastInitial || firstName.charAt(1) || '')).toUpperCase();
  const photoUrl = profile?.profile_photo_url ?? undefined;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 hover:opacity-80 transition-opacity min-w-0">
          {photoUrl ? (
            <Avatar className="h-9 w-9 border-2 border-white shadow-md shrink-0">
              <AvatarImage src={photoUrl} alt={fullName} />
              <AvatarFallback className="bg-primary text-primary-foreground text-sm font-medium">
                {initials}
              </AvatarFallback>
            </Avatar>
          ) : (
            <div className="h-9 w-9 flex items-center justify-center shadow-md border-2 border-white rounded-full bg-primary text-primary-foreground text-sm font-medium shrink-0">
              {initials}
            </div>
          )}
          <span className="hidden sm:inline text-sm font-medium text-foreground truncate">{fullName}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <div className="flex items-center gap-3">
            {photoUrl ? (
              <Avatar className="h-10 w-10">
                <AvatarImage src={photoUrl} alt={firstName} />
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
            ) : null}
            <div className="flex flex-col space-y-1 min-w-0">
              <p className="text-sm font-medium truncate">{profile?.full_name || 'User'}</p>
              <p className="text-xs text-muted-foreground truncate">{profile?.email}</p>
            </div>
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
        <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
          <DropdownMenuRadioItem value="light" className="gap-2">
            <Sun className="w-4 h-4" /> Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark" className="gap-2">
            <Moon className="w-4 h-4" /> Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system" className="gap-2">
            <Monitor className="w-4 h-4" /> System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={signOut} className="flex items-center gap-2">
          <LogOut className="w-4 h-4" />
          Sign Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
