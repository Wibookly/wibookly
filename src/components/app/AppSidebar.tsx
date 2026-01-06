import { NavLink, useLocation } from 'react-router-dom';
import { Plug, FolderOpen, Settings, LogOut, Sparkles, BarChart3, ChevronDown, Check, Mail, Calendar, Clock, Tag, Palette, User, PenTool, ListFilter } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import wibooklyLogo from '@/assets/wibookly-logo.png';
import { OnboardingChecklist } from './OnboardingChecklist';
import { PostOnboardingNav } from './PostOnboardingNav';
import { useActiveEmail } from '@/contexts/ActiveEmailContext';
import { useState, useEffect } from 'react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

function ProviderIcon({ provider, className }: { provider: 'google' | 'outlook'; className?: string }) {
  if (provider === 'google') {
    return (
      <svg className={className} viewBox="0 0 48 48" fill="none">
        <path d="M43.611 20.083H42V20H24V28H35.303C33.654 32.657 29.223 36 24 36C17.373 36 12 30.627 12 24C12 17.373 17.373 12 24 12C27.059 12 29.842 13.154 31.961 15.039L37.618 9.382C34.046 6.053 29.268 4 24 4C12.955 4 4 12.955 4 24C4 35.045 12.955 44 24 44C35.045 44 44 35.045 44 24C44 22.659 43.862 21.35 43.611 20.083Z" fill="#FFC107"/>
        <path d="M6.306 14.691L12.877 19.51C14.655 15.108 18.961 12 24 12C27.059 12 29.842 13.154 31.961 15.039L37.618 9.382C34.046 6.053 29.268 4 24 4C16.318 4 9.656 8.337 6.306 14.691Z" fill="#FF3D00"/>
        <path d="M24 44C29.166 44 33.86 42.023 37.409 38.808L31.219 33.57C29.211 35.091 26.715 36 24 36C18.798 36 14.381 32.683 12.717 28.054L6.195 33.079C9.505 39.556 16.227 44 24 44Z" fill="#4CAF50"/>
        <path d="M43.611 20.083H42V20H24V28H35.303C34.511 30.237 33.072 32.166 31.216 33.571L31.219 33.57L37.409 38.808C36.971 39.205 44 34 44 24C44 22.659 43.862 21.35 43.611 20.083Z" fill="#1976D2"/>
      </svg>
    );
  }
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none">
      <path d="M28 8H44V40H28V8Z" fill="#1976D2"/>
      <path d="M28 8L4 13V35L28 40V8Z" fill="#2196F3"/>
      <path d="M16 18C12.686 18 10 20.686 10 24C10 27.314 12.686 30 16 30C19.314 30 22 27.314 22 24C22 20.686 19.314 18 16 18ZM16 27C14.343 27 13 25.657 13 24C13 22.343 14.343 21 16 21C17.657 21 19 22.343 19 24C19 25.657 17.657 27 16 27Z" fill="white"/>
    </svg>
  );
}

interface NavSectionProps {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  defaultOpen?: boolean;
  colorClass?: string;
}

function NavSection({ title, icon: Icon, children, defaultOpen = false, colorClass = 'text-primary' }: NavSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex items-center justify-between w-full px-3 py-2.5 rounded-lg text-sm font-semibold hover:bg-secondary/50 transition-colors group">
        <div className="flex items-center gap-3">
          <div className={cn("p-1.5 rounded-md bg-secondary/80", colorClass)}>
            <Icon className="w-4 h-4" />
          </div>
          <span className={cn(
            "text-foreground relative pb-1",
            isOpen && "after:content-[''] after:absolute after:bottom-0 after:left-0 after:w-full after:h-0.5 after:bg-blue-500 after:rounded-full"
          )}>{title}</span>
        </div>
        <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform group-hover:text-foreground", isOpen && "rotate-180")} />
      </CollapsibleTrigger>
      <CollapsibleContent className="pl-4 space-y-0.5 mt-1 ml-3 border-l-2 border-border/50">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

interface NavItemProps {
  href: string;
  icon: React.ElementType;
  children: React.ReactNode;
}

function NavItem({ href, icon: Icon, children }: NavItemProps) {
  const location = useLocation();
  const currentUrl = location.pathname + location.search;
  const isActive = currentUrl === href || (location.pathname === href.split('?')[0] && location.search === '?' + href.split('?')[1]);
  
  return (
    <NavLink
      to={href}
      className={cn(
        'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors relative',
        isActive
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
      )}
    >
      <Icon className="w-4 h-4" />
      <span className={cn(
        "relative pb-1",
        isActive && "after:content-[''] after:absolute after:bottom-0 after:left-0 after:w-full after:h-0.5 after:bg-green-500 after:rounded-full"
      )}>{children}</span>
    </NavLink>
  );
}

export function AppSidebar() {
  const { signOut, organization } = useAuth();
  const location = useLocation();
  const { connections, activeConnection, setActiveConnectionId, loading } = useActiveEmail();
  const [isOnboardingComplete, setIsOnboardingComplete] = useState(false);

  // Check if onboarding has been dismissed
  useEffect(() => {
    if (organization?.id) {
      const dismissed = localStorage.getItem(`onboarding-dismissed-${organization.id}`);
      setIsOnboardingComplete(dismissed === 'true');
    }
  }, [organization?.id]);

  return (
    <aside className="hidden lg:flex w-80 h-screen bg-card border-r border-border flex-col">
      <div className="p-4 border-b border-border flex flex-col items-center">
        <img src={wibooklyLogo} alt="Wibookly" className="h-40 w-auto" />
      </div>

      {/* Active Email Selector */}
      <div className="p-3 border-b border-border">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Connected Emails</h3>
        {loading ? (
          <div className="h-10 bg-muted/50 animate-pulse rounded-md" />
        ) : connections.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger className="w-full">
              <div className="flex items-center justify-between gap-2 px-3 py-2 bg-primary/10 hover:bg-primary/20 rounded-md transition-colors cursor-pointer min-w-0">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {activeConnection && (
                    <ProviderIcon provider={activeConnection.provider} className="w-4 h-4 flex-shrink-0" />
                  )}
                  <span className="text-xs font-medium text-primary truncate">
                    {activeConnection?.email || 'Select email'}
                  </span>
                </div>
                <ChevronDown className="w-3 h-3 text-primary flex-shrink-0" />
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[220px]">
              {connections.map((connection) => (
                <DropdownMenuItem
                  key={connection.id}
                  onClick={() => setActiveConnectionId(connection.id)}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <ProviderIcon provider={connection.provider} className="w-4 h-4 flex-shrink-0" />
                  <span className="text-xs truncate flex-1">{connection.email}</span>
                  {activeConnection?.id === connection.id && (
                    <Check className="w-3 h-3 text-primary flex-shrink-0" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <div className="px-3 py-2 text-xs text-muted-foreground bg-muted/30 rounded-md">
            No emails connected
          </div>
        )}
      </div>

      {/* Scrollable middle section containing nav */}
      <div className="flex-1 overflow-y-auto min-h-0">

        <nav className="p-3 pt-0 space-y-2">
          {/* Email & Calendar Integrations */}
          <NavSection title="Email & Calendar Integrations" icon={Plug} defaultOpen colorClass="text-blue-500">
            <NavItem href="/integrations" icon={Mail}>Email Connections</NavItem>
            <NavItem href="/integrations?tab=calendar" icon={Calendar}>Calendar Connections</NavItem>
            <NavItem href="/integrations?tab=availability" icon={Clock}>Availability Hours</NavItem>
            <NavItem href="/integrations?tab=calendar-color" icon={Palette}>Calendar Event Color</NavItem>
          </NavSection>

          {/* Email Folders/Labels */}
          <NavSection title="Email Folders/Labels" icon={FolderOpen} defaultOpen colorClass="text-amber-500">
            <NavItem href="/categories" icon={Tag}>Categories</NavItem>
          </NavSection>

          {/* AI Settings */}
          <NavSection title="AI Settings" icon={Sparkles} defaultOpen colorClass="text-purple-500">
            <NavItem href="/email-draft" icon={Sparkles}>AI Draft Settings</NavItem>
            <NavItem href="/email-draft?tab=labels" icon={Palette}>AI Label Colors</NavItem>
          </NavSection>

          {/* Settings */}
          <NavSection title="Settings" icon={Settings} defaultOpen colorClass="text-slate-500">
            <NavItem href="/settings?section=profile" icon={User}>My Profile</NavItem>
            <NavItem href="/settings?section=signature" icon={PenTool}>My Signature</NavItem>
          </NavSection>

          {/* Reports */}
          <NavSection title="Reports" icon={BarChart3} defaultOpen colorClass="text-emerald-500">
            <NavItem href="/ai-activity" icon={BarChart3}>AI Activity</NavItem>
          </NavSection>
        </nav>
      </div>

      <div className="p-3 border-t border-border">
        <button
          onClick={signOut}
          className="flex items-center gap-3 w-full px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
