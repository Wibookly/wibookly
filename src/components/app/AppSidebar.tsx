import { NavLink, useLocation } from 'react-router-dom';
import { Plug, FolderOpen, Settings, LogOut, Sparkles, BarChart3, ChevronDown, Check, Mail, Calendar, Clock, Tag, Palette, User, PenTool, ListFilter, MessageSquare, Sun, Bot, UserPlus, Link2, Cog, Shield, BellRing, BookOpen } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

import { OnboardingChecklist } from './OnboardingChecklist';
import { PostOnboardingNav } from './PostOnboardingNav';
import { useActiveEmail } from '@/contexts/ActiveEmailContext';
import { useFeatureAccess } from '@/hooks/useFeatureAccess';
import energyForwardLogo from '@/assets/ef-logo.png';
import { InboxIQLogo } from '@/components/app/InboxIQLogo';
import { ModeToggle } from '@/components/theme/ModeToggle';

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
  // Outlook: white "O+envelope" mark on solid #0078D4 tile
  return (
    <span
      className={cn('inline-flex items-center justify-center rounded-md', className)}
      style={{ background: '#0078D4', width: '1.25rem', height: '1.25rem' }}
      aria-label="Outlook"
    >
      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" aria-hidden="true">
        <path
          d="M3 7.5h12v9H3v-9zm0 0l6 4.5 6-4.5M17 9h4v6h-4V9zm0 0l2 1.5L21 9"
          stroke="#FFFFFF"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

interface NavSectionProps {
  title: string;
  icon: React.ElementType;
  accent: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  colorClass?: string;
}

function NavSection({ title, accent, children, defaultOpen = true }: NavSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="mb-3">
      <CollapsibleTrigger
        className="flex items-center justify-between w-full px-3 py-1.5 rounded-md transition-colors group"
        style={{
          color: accent,
          fontSize: '9px',
          fontWeight: 700,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
        }}
      >
        <div className="flex items-center gap-2">
          <span
            className="inline-block rounded-full"
            style={{ width: 6, height: 6, background: accent }}
          />
          <span>{title}</span>
        </div>
        <ChevronDown className={cn('w-3 h-3 transition-transform', isOpen && 'rotate-180')} style={{ color: accent, opacity: 0.7 }} />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-0.5 mt-1">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

interface NavItemProps {
  href: string;
  icon: React.ElementType;
  accent: string;
  children: React.ReactNode;
  showUpgradeBadge?: boolean;
}

function NavItem({ href, icon: Icon, accent, children }: NavItemProps) {
  const location = useLocation();
  const currentUrl = location.pathname + location.search;
  const isActive = currentUrl === href || (location.pathname === href.split('?')[0] && location.search === '?' + href.split('?')[1]);

  const activeStyle: React.CSSProperties = {
    background: `linear-gradient(135deg, ${accent}, color-mix(in srgb, ${accent} 88%, black))`,
    color: '#FFFFFF',
    fontWeight: 600,
    boxShadow: `0 6px 16px -4px color-mix(in srgb, ${accent} 55%, transparent)`,
  };

  return (
    <NavLink
      to={href}
      className="flex items-center gap-3 px-3 py-2 rounded-xl transition-colors"
      style={isActive
        ? activeStyle
        : { color: 'var(--text-body)', fontSize: '13.5px', fontWeight: 500, letterSpacing: '-0.005em' }}
      onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--nav-hover-bg)'; }}
      onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
    >
      <Icon className="w-4 h-4 shrink-0" style={{ color: isActive ? '#FFFFFF' : accent }} />
      <span className="flex-1 truncate" style={{ fontSize: '13.5px' }}>{children}</span>
    </NavLink>
  );
}
export function AppSidebar() {
  const { signOut, organization, profile } = useAuth();
  const { connections, activeConnection, setActiveConnectionId, loading } = useActiveEmail();
  const [isOnboardingComplete, setIsOnboardingComplete] = useState(false);
  const { hasFeature, loading: featureLoading } = useFeatureAccess();
  const isSuperAdmin = profile?.email?.toLowerCase() === 'arahimi@energyforward.com';

  // "Chat-only" users: have AI Chat but no email/drafting/reporting features.
  // For these users we collapse the sidebar to just connected emails + AI Chat.
  const isChatOnly =
    !featureLoading &&
    !isSuperAdmin &&
    hasFeature('ai_chat') &&
    !hasFeature('ai_draft') &&
    !hasFeature('ai_auto_reply') &&
    !hasFeature('daily_brief') &&
    !hasFeature('reports') &&
    !hasFeature('feature.follow_up_reminder');

  // Check if onboarding has been dismissed
  useEffect(() => {
    if (organization?.id) {
      const dismissed = localStorage.getItem(`onboarding-dismissed-${organization.id}`);
      setIsOnboardingComplete(dismissed === 'true');
    }
  }, [organization?.id]);

  return (
    <aside className="hidden lg:flex w-72 h-screen sticky top-0 flex-col shrink-0" style={{ background: 'var(--surface)', borderRight: '1px solid var(--border)' }}>
      <div className="px-5 pt-6 pb-5 flex flex-col items-center gap-2" style={{ borderBottom: '1px solid var(--border)' }}>
        <img
          src={energyForwardLogo}
          alt="EnergyForward"
          className="h-9 w-auto"
          draggable={false}
        />
        <div className="font-sans font-bold tracking-tight text-xl leading-none" style={{ color: 'var(--text)' }}>
          InboxIQ
        </div>
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
          {isChatOnly ? (
            <NavSection title="AI Intelligence" icon={Bot} defaultOpen colorClass="text-cyan-500">
              <NavItem href="/chat" icon={MessageSquare}>AI Chat</NavItem>
            </NavSection>
          ) : (
            <>
              {/* Account Provisioning */}
              <NavSection title="Account Provisioning" icon={UserPlus} defaultOpen colorClass="text-blue-500">
                <NavItem href="/integrations" icon={Link2}>Email & Calendar Connections</NavItem>
              </NavSection>

              {/* AI Intelligence */}
              {!featureLoading && (isSuperAdmin || hasFeature('daily_brief') || hasFeature('feature.follow_up_reminder') || hasFeature('ai_chat')) && (
                <NavSection title="AI Intelligence" icon={Bot} defaultOpen colorClass="text-cyan-500">
                  {(isSuperAdmin || hasFeature('ai_chat')) && <NavItem href="/chat" icon={MessageSquare}>AI Chat</NavItem>}
                  <NavItem href="/categories" icon={Tag}>Email Intelligence</NavItem>
                  {(isSuperAdmin || hasFeature('feature.follow_up_reminder')) && <NavItem href="/follow-up-reminder" icon={BellRing}>No Reply Tracker</NavItem>}
                </NavSection>
              )}

              {/* My Settings */}
              <NavSection title="My Settings" icon={Settings} defaultOpen colorClass="text-slate-500">
                <NavItem href="/settings" icon={User}>My Profile &amp; Signature</NavItem>
                {!featureLoading && (isSuperAdmin || hasFeature('ai_draft') || hasFeature('ai_auto_reply')) && (
                  <>
                    {hasFeature('ai_draft') && hasFeature('ai_auto_reply') ? (
                      <NavItem href="/email-draft" icon={Sparkles}>AI Draft / Auto Reply Settings</NavItem>
                    ) : (
                      <>
                        {(isSuperAdmin || hasFeature('ai_draft')) && (
                          <NavItem href="/email-draft" icon={Sparkles}>AI Draft Settings</NavItem>
                        )}
                        {(isSuperAdmin || hasFeature('ai_auto_reply')) && !hasFeature('ai_draft') && (
                          <NavItem href="/email-draft" icon={MessageSquare}>AI Auto Reply</NavItem>
                        )}
                      </>
                    )}
                  </>
                )}
                <NavItem href="/integrations?tab=settings" icon={Clock}>My Availability and Calendar</NavItem>
              </NavSection>

              {/* Reports */}
              {!featureLoading && (isSuperAdmin || hasFeature('reports') || hasFeature('daily_brief')) && (
                <NavSection title="Reports" icon={BarChart3} defaultOpen colorClass="text-emerald-500">
                  {(isSuperAdmin || hasFeature('reports')) && <NavItem href="/ai-activity" icon={BarChart3}>AI Activity</NavItem>}
                  {(isSuperAdmin || hasFeature('daily_brief')) && <NavItem href="/ai-daily-brief" icon={Sun}>My Daily Brief</NavItem>}
                </NavSection>
              )}

              {/* Admin */}
              {isSuperAdmin && (
                <NavSection title="Administration" icon={Shield} defaultOpen colorClass="text-red-500">
                  <NavItem href="/admin" icon={Shield}>Admin Dashboard</NavItem>
                </NavSection>
              )}
            </>
          )}
        </nav>
      </div>

      <div className="p-3 border-t border-border space-y-1">
        <ModeToggle />
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
