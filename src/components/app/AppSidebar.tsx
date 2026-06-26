import { NavLink, useLocation } from 'react-router-dom';
import { Plug, FolderOpen, Settings, Sparkles, BarChart3, ChevronDown, Check, Mail, Calendar, Clock, Tag, Palette, User, PenTool, ListFilter, MessageSquare, Sun, Bot, UserPlus, Link2, Cog, Shield, BellRing, BookOpen, Headphones, Pin, PinOff } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

import { OnboardingChecklist } from './OnboardingChecklist';
import { PostOnboardingNav } from './PostOnboardingNav';
import { useActiveEmail } from '@/contexts/ActiveEmailContext';
import { useFeatureAccess } from '@/hooks/useFeatureAccess';
import energyForwardLogo from '@/assets/ef-logo.png';
import { InboxIQLogo } from '@/components/app/InboxIQLogo';
import { ModeToggle } from '@/components/theme/ModeToggle';
import { HelpQuickActions } from '@/components/help/HelpQuickActions';
import { UserAvatarDropdown } from '@/components/app/UserAvatarDropdown';


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
          fontSize: '11px',
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
export function AppSidebar({ pinned = true, onTogglePin }: { pinned?: boolean; onTogglePin?: () => void } = {}) {
  const { organization, profile } = useAuth();
  const { connections, activeConnection, setActiveConnectionId, loading } = useActiveEmail();
  const [isOnboardingComplete, setIsOnboardingComplete] = useState(false);
  const { hasFeature, loading: featureLoading } = useFeatureAccess();
  const isSuperAdmin = profile?.email?.toLowerCase() === 'arahimi@energyforward.com';
  const { isOrgAdmin } = useUserRoles();

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

  const accents = {
    cyan:   'var(--c-cyan)',
    purple: 'var(--c-purple)',
    orange: 'var(--c-orange)',
    green:  'var(--c-green)',
    red:    'var(--c-rose)',
  };

  return (
    <aside className="hidden lg:flex w-[300px] h-[100dvh] flex-col shrink-0 relative overflow-hidden" style={{ background: 'var(--bg-elev)', borderRight: '1px solid var(--border-soft)' }}>

      <div className="px-5 pt-3 pb-2 flex flex-col items-center gap-1 shrink-0" style={{ borderBottom: '1px solid var(--border-soft)' }}>
        <img
          src={energyForwardLogo}
          alt="EnergyForward"
          className="h-[44px] w-auto object-contain"
          draggable={false}
        />
        <InboxIQLogo className="text-[15px] leading-none" />
      </div>

      {/* Active Email Selector */}
      <div className="p-3" style={{ borderBottom: '1px solid var(--border-soft)' }}>
        <h3
          className="mb-2 px-1"
          style={{ fontSize: '10.5px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}
        >
          Connected Emails
        </h3>
        {loading ? (
          <div className="h-10 animate-pulse rounded-xl" style={{ background: 'var(--surface-3)' }} />
        ) : connections.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger className="w-full">
              <div
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl transition-colors cursor-pointer min-w-0"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <ProviderIcon provider="outlook" className="flex-shrink-0" />
                  <span className="text-xs font-medium truncate" style={{ color: 'var(--primary)' }}>
                    {activeConnection?.email || 'Select email'}
                  </span>
                </div>
                <ChevronDown className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--primary)' }} />
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[240px]">
              {connections.map((connection) => (
                <DropdownMenuItem
                  key={connection.id}
                  onClick={() => setActiveConnectionId(connection.id)}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <ProviderIcon provider="outlook" className="flex-shrink-0" />
                  <span className="text-xs truncate flex-1">{connection.email}</span>
                  {activeConnection?.id === connection.id && (
                    <Check className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--primary)' }} />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <div className="px-3 py-2 text-xs rounded-xl" style={{ color: 'var(--text-muted)', background: 'var(--surface)', border: '1px solid var(--border)' }}>
            No emails connected
          </div>
        )}
      </div>

      {/* Scrollable middle section containing nav */}
      <div className="flex-1 overflow-y-auto min-h-0">

        <nav className="p-3 space-y-2">
          {isChatOnly ? (
            <NavSection title="AI Intelligence" icon={Bot} accent={accents.purple} defaultOpen>
              <NavItem href="/chat" icon={MessageSquare} accent={accents.purple}>AI Chat</NavItem>
            </NavSection>
          ) : (
            <>
              {/* Account Provisioning */}
              <NavSection title="Provisioning" icon={UserPlus} accent={accents.cyan} defaultOpen>
                <NavItem href="/integrations" icon={Link2} accent={accents.cyan}><span style={{ fontSize: '12.5px' }}>Email &amp; Calendar Connections</span></NavItem>
              </NavSection>

              {/* AI Intelligence */}
              {!featureLoading && (isSuperAdmin || hasFeature('daily_brief') || hasFeature('ai_chat') || hasFeature('email_intelligence') || hasFeature('feature.follow_up_reminder')) && (
                <NavSection title="AI Intelligence" icon={Bot} accent={accents.purple} defaultOpen>
                  {(isSuperAdmin || hasFeature('ai_chat')) && <NavItem href="/chat" icon={MessageSquare} accent={accents.purple}>AI Chat</NavItem>}
                  {(isSuperAdmin || hasFeature('email_intelligence')) && <NavItem href="/categories" icon={Tag} accent={accents.purple}>Email Intelligence</NavItem>}
                  {(isSuperAdmin || hasFeature('feature.follow_up_reminder')) && <NavItem href="/flagged-email-settings" icon={BellRing} accent={accents.purple}>Flagged Email Tracker</NavItem>}
                  {(isSuperAdmin || hasFeature('daily_brief')) && <NavItem href="/ai-daily-brief" icon={Sun} accent={accents.purple}>My Daily Brief</NavItem>}
                </NavSection>
              )}

              {/* My Settings */}
              <NavSection title="My Settings" icon={Settings} accent={accents.orange} defaultOpen>
                <NavItem href="/settings" icon={User} accent={accents.orange}>My Profile &amp; Signature</NavItem>
                {(isSuperAdmin || hasFeature('meeting_copilot')) && (
                  <NavItem href="/meeting-copilot" icon={Headphones} accent={accents.orange}>Meeting Copilot</NavItem>
                )}
                {(isSuperAdmin || hasFeature('meeting_copilot')) && (
                  <NavItem href="/integrations?tab=settings" icon={Clock} accent={accents.orange}>My Availability and Calendar</NavItem>
                )}
              </NavSection>

              {/* AI Activity Report */}
              {!featureLoading && (isSuperAdmin || hasFeature('reports') || hasFeature('feature.follow_up_reminder')) && (
                <NavSection title="AI Activity" icon={BarChart3} accent={accents.green} defaultOpen>
                  {(isSuperAdmin || hasFeature('reports')) && <NavItem href="/ai-activity" icon={BarChart3} accent={accents.green}>AI Activity Report</NavItem>}
                  {(isSuperAdmin || hasFeature('feature.follow_up_reminder')) && <NavItem href="/flagged-email-tracker" icon={BellRing} accent={accents.green}>Flagged Email Reports</NavItem>}
                </NavSection>
              )}

              {/* Admin */}
              {isSuperAdmin && (
                <NavSection title="Administration" icon={Shield} accent={accents.red} defaultOpen>
                  <NavItem href="/admin" icon={Shield} accent={accents.red}>Admin Dashboard</NavItem>
                  <NavItem href="/super-admin" icon={Shield} accent={accents.red}>Super Admin (Orgs)</NavItem>
                  <NavItem href="/org-admin" icon={Shield} accent={accents.red}>Org Admin</NavItem>
                </NavSection>
              )}
            </>
          )}
        </nav>
      </div>

      {onTogglePin && (
        <div className="px-3 pt-3 pb-2 border-t border-border" data-tour="sidebar-pin">
          <button
            onClick={onTogglePin}
            title={pinned ? 'Unpin sidebar (auto-hide on Chat)' : 'Pin sidebar (keep visible)'}
            aria-label={pinned ? 'Unpin sidebar' : 'Pin sidebar'}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl transition-colors hover:bg-white/5"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <div className="flex items-center gap-2 min-w-0">
              {pinned ? (
                <Pin className="w-4 h-4 shrink-0" style={{ color: 'var(--c-purple)' }} />
              ) : (
                <PinOff className="w-4 h-4 shrink-0" style={{ color: 'var(--text-muted)' }} />
              )}
              <span className="text-xs font-medium truncate" style={{ color: 'var(--text-body)' }}>
                {pinned ? 'Sidebar pinned' : 'Sidebar auto-hides'}
              </span>
            </div>
            <span
              className="text-[10px] font-semibold tracking-wider uppercase shrink-0"
              style={{ color: pinned ? 'var(--c-purple)' : 'var(--text-muted)' }}
            >
              {pinned ? 'Unpin' : 'Pin'}
            </span>
          </button>
        </div>
      )}

      <div className="p-3 border-t border-border space-y-3">
        <div>
          <p
            className="mb-2 px-1"
            style={{ fontSize: '10.5px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}
          >
            Guidance
          </p>
          <HelpQuickActions compact />
        </div>
        
        <div
          className="flex items-center justify-between gap-2 px-2 py-2 rounded-xl"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <UserAvatarDropdown />
          <ModeToggle variant="icon" className="w-9 h-9 shrink-0" />
        </div>
      </div>
    </aside>
  );
}
