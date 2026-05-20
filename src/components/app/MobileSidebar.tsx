import { NavLink, useLocation } from 'react-router-dom';
import { Plug, FolderOpen, Settings, LogOut, Sparkles, BarChart3, Bot, MessageSquare, Sun, Palette, UserPlus, Link2, Cog, Clock, Tag, User, PenTool, Shield } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { useFeatureAccess } from '@/hooks/useFeatureAccess';

import { Sheet, SheetContent, SheetHeader } from '@/components/ui/sheet';
import { useActiveEmail } from '@/contexts/ActiveEmailContext';

interface MobileSidebarProps {
  open: boolean;
  onClose: () => void;
}

export function MobileSidebar({ open, onClose }: MobileSidebarProps) {
  const { signOut, profile } = useAuth();
  const location = useLocation();
  const { connections, activeConnection } = useActiveEmail();
  const { hasFeature, loading: featureLoading } = useFeatureAccess();
  const isSuperAdmin = profile?.email?.toLowerCase() === 'arahimi@energyforward.com';

  const handleNavClick = () => {
    onClose();
  };

  const navItemClass = (href: string) => {
    const isActive = location.pathname === href.split('?')[0];
    return cn(
      'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors',
      isActive
        ? 'bg-primary text-primary-foreground'
        : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
    );
  };

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent side="left" className="w-72 p-0 flex flex-col">
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
                  <span className="text-[10px] font-medium text-primary truncate min-w-0">{c.email}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No emails connected</p>
          )}
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-auto">
          {/* Always visible */}
          <NavLink to="/integrations" onClick={handleNavClick} className={navItemClass('/integrations')}>
            <Link2 className="w-4 h-4" /> Email & Calendar
          </NavLink>
          <NavLink to="/categories" onClick={handleNavClick} className={navItemClass('/categories')}>
            <Tag className="w-4 h-4" /> Email Intelligence
          </NavLink>

          {/* AI Draft / Auto Reply settings now live inside Email Intelligence. */}

          {/* Daily Brief */}
          {!featureLoading && (isSuperAdmin || hasFeature('daily_brief')) && (
            <NavLink to="/ai-daily-brief" onClick={handleNavClick} className={navItemClass('/ai-daily-brief')}>
              <Sun className="w-4 h-4" /> Daily Brief
            </NavLink>
          )}

          {/* Reports */}
          {!featureLoading && (isSuperAdmin || hasFeature('reports')) && (
            <NavLink to="/ai-activity" onClick={handleNavClick} className={navItemClass('/ai-activity')}>
              <BarChart3 className="w-4 h-4" /> AI Activity
            </NavLink>
          )}

          {/* Settings - always visible */}
          <NavLink to="/settings?section=profile" onClick={handleNavClick} className={navItemClass('/settings')}>
            <User className="w-4 h-4" /> My Profile
          </NavLink>

          {/* Admin */}
          {isSuperAdmin && (
            <NavLink to="/admin" onClick={handleNavClick} className={navItemClass('/admin')}>
              <Shield className="w-4 h-4" /> Admin Dashboard
            </NavLink>
          )}
        </nav>

        <div className="p-3 border-t border-border">
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
