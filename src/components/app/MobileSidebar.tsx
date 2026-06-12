import { NavLink, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  LogOut,
  BarChart3,
  MessageSquare,
  Sun,
  Link2,
  Tag,
  User,
  Shield,
  BellRing,
  Headphones,
  Clock,
  Bot,
  UserPlus,
  Pin,
  PinOff,
  Settings as SettingsIcon,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { useFeatureAccess } from '@/hooks/useFeatureAccess';
import { HelpQuickActions } from '@/components/help/HelpQuickActions';
import { UserAvatarDropdown } from '@/components/app/UserAvatarDropdown';


import { Sheet, SheetContent, SheetHeader } from '@/components/ui/sheet';
import { useActiveEmail } from '@/contexts/ActiveEmailContext';

interface MobileSidebarProps {
  open: boolean;
  onClose: () => void;
}

function SectionLabel({ title, accent }: { title: string; accent: string }) {
  return (
    <div
      className="flex items-center gap-2 px-3 pt-3 pb-1.5"
      style={{
        color: accent,
        fontSize: '11px',
        fontWeight: 700,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
      }}
    >
      <span className="inline-block rounded-full" style={{ width: 6, height: 6, background: accent }} />
      <span>{title}</span>
    </div>
  );
}

function MobileNavItem({
  href,
  icon: Icon,
  accent,
  onClick,
  children,
}: {
  href: string;
  icon: React.ElementType;
  accent: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const location = useLocation();
  const path = href.split('?')[0];
  const isActive = location.pathname === path;
  const activeStyle: React.CSSProperties = {
    background: `linear-gradient(135deg, ${accent}, color-mix(in srgb, ${accent} 88%, black))`,
    color: '#FFFFFF',
    fontWeight: 600,
    boxShadow: `0 6px 16px -4px color-mix(in srgb, ${accent} 55%, transparent)`,
  };
  return (
    <NavLink
      to={href}
      onClick={onClick}
      className={cn('flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors')}
      style={isActive ? activeStyle : { color: 'var(--text-body)', fontSize: '13.5px', fontWeight: 500 }}
    >
      <Icon className="w-4 h-4 shrink-0" style={{ color: isActive ? '#FFFFFF' : accent }} />
      <span className="flex-1 truncate" style={{ fontSize: '13.5px' }}>{children}</span>
    </NavLink>
  );
}

export function MobileSidebar({ open, onClose }: MobileSidebarProps) {
  const { signOut, profile } = useAuth();
  const { connections } = useActiveEmail();
  const { hasFeature, loading: featureLoading } = useFeatureAccess();
  const isSuperAdmin = profile?.email?.toLowerCase() === 'arahimi@energyforward.com';
  const isChatOnly =
    !isSuperAdmin &&
    !featureLoading &&
    hasFeature('ai_chat') &&
    !hasFeature('email_intelligence') &&
    !hasFeature('daily_brief') &&
    !hasFeature('reports') &&
    !hasFeature('feature.follow_up_reminder') &&
    !hasFeature('meeting_copilot');

  const handleNavClick = () => onClose();

  const accents = {
    cyan:   'var(--c-cyan)',
    purple: 'var(--c-purple)',
    orange: 'var(--c-orange)',
    green:  'var(--c-green)',
    red:    'var(--c-rose)',
  };

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent
        side="left"
        className="w-[88vw] max-w-[320px] p-0 flex flex-col"
        style={{ background: 'var(--bg-elev)' }}
      >
        <SheetHeader className="p-4" style={{ borderBottom: '1px solid var(--border-soft)' }}>
          <div className="flex items-center justify-between">
            <span className="text-lg font-semibold" style={{ color: 'var(--text-body)' }}>InboxIQ</span>
          </div>
        </SheetHeader>

        {/* Connected Emails */}
        <div className="p-3" style={{ borderBottom: '1px solid var(--border-soft)' }}>
          <h3
            className="mb-2 px-1"
            style={{ fontSize: '10.5px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}
          >
            Connected Emails
          </h3>
          {connections.length > 0 ? (
            <div className="space-y-1.5">
              {connections.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl min-w-0"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                >
                  <span className="text-xs font-medium truncate min-w-0" style={{ color: 'var(--primary)' }}>
                    {c.email}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div
              className="px-3 py-2 text-xs rounded-xl"
              style={{ color: 'var(--text-muted)', background: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              No emails connected
            </div>
          )}
        </div>

        <nav className="flex-1 px-2 pb-3 space-y-1 overflow-y-auto">
          {isChatOnly ? (
            <>
              <SectionLabel title="AI Intelligence" accent={accents.purple} />
              <MobileNavItem href="/chat" icon={MessageSquare} accent={accents.purple} onClick={handleNavClick}>AI Chat</MobileNavItem>
            </>
          ) : (
            <>
              <SectionLabel title="Provisioning" accent={accents.cyan} />
              <MobileNavItem href="/integrations" icon={Link2} accent={accents.cyan} onClick={handleNavClick}>
                Email & Calendar Connections
              </MobileNavItem>

              {!featureLoading && (isSuperAdmin || hasFeature('daily_brief') || hasFeature('feature.follow_up_reminder') || hasFeature('ai_chat') || hasFeature('email_intelligence')) && (
                <>
                  <SectionLabel title="AI Intelligence" accent={accents.purple} />
                  {(isSuperAdmin || hasFeature('ai_chat')) && (
                    <MobileNavItem href="/chat" icon={MessageSquare} accent={accents.purple} onClick={handleNavClick}>AI Chat</MobileNavItem>
                  )}
                  {(isSuperAdmin || hasFeature('email_intelligence')) && (
                    <MobileNavItem href="/categories" icon={Tag} accent={accents.purple} onClick={handleNavClick}>Email Intelligence</MobileNavItem>
                  )}
                  {(isSuperAdmin || hasFeature('feature.follow_up_reminder')) && (
                    <MobileNavItem href="/follow-up-reminder" icon={BellRing} accent={accents.purple} onClick={handleNavClick}>No Reply Tracker</MobileNavItem>
                  )}
                </>
              )}

              <SectionLabel title="My Settings" accent={accents.orange} />
              <MobileNavItem href="/settings" icon={User} accent={accents.orange} onClick={handleNavClick}>My Profile & Signature</MobileNavItem>
              {(isSuperAdmin || hasFeature('meeting_copilot')) && (
                <>
                  <MobileNavItem href="/meeting-copilot" icon={Headphones} accent={accents.orange} onClick={handleNavClick}>Meeting Copilot</MobileNavItem>
                  <MobileNavItem href="/integrations?tab=settings" icon={Clock} accent={accents.orange} onClick={handleNavClick}>My Availability and Calendar</MobileNavItem>
                </>
              )}

              {!featureLoading && (isSuperAdmin || hasFeature('reports') || hasFeature('daily_brief')) && (
                <>
                  <SectionLabel title="AI Activity" accent={accents.green} />
                  {(isSuperAdmin || hasFeature('reports')) && (
                    <MobileNavItem href="/ai-activity" icon={BarChart3} accent={accents.green} onClick={handleNavClick}>AI Activity</MobileNavItem>
                  )}
                  {(isSuperAdmin || hasFeature('daily_brief')) && (
                    <MobileNavItem href="/ai-daily-brief" icon={Sun} accent={accents.green} onClick={handleNavClick}>My Daily Brief</MobileNavItem>
                  )}
                </>
              )}

              {isSuperAdmin && (
                <>
                  <SectionLabel title="Administration" accent={accents.red} />
                  <MobileNavItem href="/admin" icon={Shield} accent={accents.red} onClick={handleNavClick}>Admin Dashboard</MobileNavItem>
                </>
              )}
            </>
          )}
        </nav>

        <div className="p-3 space-y-3" style={{ borderTop: '1px solid var(--border-soft)' }}>
          <div>
            <p
              className="mb-2 px-1"
              style={{ fontSize: '10.5px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}
            >
              Guidance
            </p>
            <HelpQuickActions compact />
          </div>

          {/* User profile — matches desktop sidebar footer */}
          <div
            className="flex items-center justify-between gap-2 px-2 py-2 rounded-xl"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <UserAvatarDropdown />
          </div>

          <button
            onClick={() => { signOut(); onClose(); }}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-medium transition-colors"
            style={{ color: 'var(--text-muted)', background: 'transparent' }}
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
