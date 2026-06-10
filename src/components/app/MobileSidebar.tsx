import { NavLink, useLocation } from 'react-router-dom';
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
  Settings,
  Bot,
  UserPlus,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { useFeatureAccess } from '@/hooks/useFeatureAccess';
import { HelpQuickActions } from '@/components/help/HelpQuickActions';

import { Sheet, SheetContent, SheetHeader } from '@/components/ui/sheet';
import { useActiveEmail } from '@/contexts/ActiveEmailContext';

interface MobileSidebarProps {
  open: boolean;
  onClose: () => void;
}

export function MobileSidebar({ open, onClose }: MobileSidebarProps) {
  const { signOut, profile } = useAuth();
  const location = useLocation();
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

  const navItemClass = (href: string) => {
    const path = href.split('?')[0];
    const isActive = location.pathname === path;
    return cn(
      'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors',
      isActive
        ? 'bg-primary text-primary-foreground'
        : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
    );
  };

  const SectionLabel = ({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) => (
    <div className="flex items-center gap-2 px-2 pt-3 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
      <Icon className="w-3.5 h-3.5" />
      {children}
    </div>
  );

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent side="left" className="w-[88vw] max-w-[320px] p-0 flex flex-col">
        <SheetHeader className="p-4 border-b border-border">
          <div className="flex items-center justify-between">
            <span className="text-lg font-semibold text-foreground">InboxIQ</span>
          </div>
        </SheetHeader>

        {/* Connected Emails */}
        <div className="p-3 border-b border-border">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Connected Emails</h3>
          {connections.length > 0 ? (
            <div className="space-y-1.5">
              {connections.map((c) => (
                <div key={c.id} className="flex items-center gap-2 px-2 py-1.5 bg-primary/10 rounded-md min-w-0">
                  <span className="text-[11px] font-medium text-primary truncate min-w-0">{c.email}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No emails connected</p>
          )}
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {isChatOnly ? (
            <>
              <SectionLabel icon={Bot}>AI Intelligence</SectionLabel>
              <NavLink to="/chat" onClick={handleNavClick} className={navItemClass('/chat')}>
                <MessageSquare className="w-4 h-4" /> AI Chat
              </NavLink>
            </>
          ) : (
            <>
              {/* Provisioning */}
              <SectionLabel icon={UserPlus}>Provisioning</SectionLabel>
              <NavLink to="/integrations" onClick={handleNavClick} className={navItemClass('/integrations')}>
                <Link2 className="w-4 h-4" /> Email & Calendar Connections
              </NavLink>

              {/* AI Intelligence */}
              {!featureLoading && (isSuperAdmin || hasFeature('daily_brief') || hasFeature('feature.follow_up_reminder') || hasFeature('ai_chat') || hasFeature('email_intelligence')) && (
                <>
                  <SectionLabel icon={Bot}>AI Intelligence</SectionLabel>
                  {(isSuperAdmin || hasFeature('ai_chat')) && (
                    <NavLink to="/chat" onClick={handleNavClick} className={navItemClass('/chat')}>
                      <MessageSquare className="w-4 h-4" /> AI Chat
                    </NavLink>
                  )}
                  {(isSuperAdmin || hasFeature('email_intelligence')) && (
                    <NavLink to="/categories" onClick={handleNavClick} className={navItemClass('/categories')}>
                      <Tag className="w-4 h-4" /> Email Intelligence
                    </NavLink>
                  )}
                  {(isSuperAdmin || hasFeature('feature.follow_up_reminder')) && (
                    <NavLink to="/follow-up-reminder" onClick={handleNavClick} className={navItemClass('/follow-up-reminder')}>
                      <BellRing className="w-4 h-4" /> No Reply Tracker
                    </NavLink>
                  )}
                </>
              )}

              {/* My Settings */}
              <SectionLabel icon={Settings}>My Settings</SectionLabel>
              <NavLink to="/settings" onClick={handleNavClick} className={navItemClass('/settings')}>
                <User className="w-4 h-4" /> My Profile & Signature
              </NavLink>
              {(isSuperAdmin || hasFeature('meeting_copilot')) && (
                <>
                  <NavLink to="/meeting-copilot" onClick={handleNavClick} className={navItemClass('/meeting-copilot')}>
                    <Headphones className="w-4 h-4" /> Meeting Copilot
                  </NavLink>
                  <NavLink to="/integrations?tab=settings" onClick={handleNavClick} className={navItemClass('/integrations')}>
                    <Clock className="w-4 h-4" /> My Availability and Calendar
                  </NavLink>
                </>
              )}

              {/* AI Activity */}
              {!featureLoading && (isSuperAdmin || hasFeature('reports') || hasFeature('daily_brief')) && (
                <>
                  <SectionLabel icon={BarChart3}>AI Activity</SectionLabel>
                  {(isSuperAdmin || hasFeature('reports')) && (
                    <NavLink to="/ai-activity" onClick={handleNavClick} className={navItemClass('/ai-activity')}>
                      <BarChart3 className="w-4 h-4" /> AI Activity
                    </NavLink>
                  )}
                  {(isSuperAdmin || hasFeature('daily_brief')) && (
                    <NavLink to="/ai-daily-brief" onClick={handleNavClick} className={navItemClass('/ai-daily-brief')}>
                      <Sun className="w-4 h-4" /> My Daily Brief
                    </NavLink>
                  )}
                </>
              )}

              {/* Admin */}
              {isSuperAdmin && (
                <>
                  <SectionLabel icon={Shield}>Administration</SectionLabel>
                  <NavLink to="/admin" onClick={handleNavClick} className={navItemClass('/admin')}>
                    <Shield className="w-4 h-4" /> Admin Dashboard
                  </NavLink>
                </>
              )}
            </>
          )}
        </nav>

        <div className="p-3 border-t border-border space-y-3">
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Guidance</h3>
            <HelpQuickActions compact />
          </div>
          <button
            onClick={() => { signOut(); onClose(); }}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
