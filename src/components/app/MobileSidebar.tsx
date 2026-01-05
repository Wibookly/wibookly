import { NavLink, useLocation } from 'react-router-dom';
import { LayoutDashboard, Plug, FolderOpen, Settings, LogOut, Sparkles, BarChart3 } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import wibooklyLogo from '@/assets/wibookly-logo.png';
import { OnboardingChecklist } from './OnboardingChecklist';
import { Sheet, SheetContent, SheetHeader } from '@/components/ui/sheet';
import { useConnectedEmails } from '@/hooks/useConnectedEmails';

const navItems = [
  { title: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { title: 'Integrations', href: '/integrations', icon: Plug },
  { title: 'Categories', href: '/categories', icon: FolderOpen },
  { title: 'AI Drafts', href: '/email-draft', icon: Sparkles },
  { title: 'AI Activity', href: '/ai-activity', icon: BarChart3 },
  { title: 'Settings', href: '/settings', icon: Settings },
];

interface MobileSidebarProps {
  open: boolean;
  onClose: () => void;
}

export function MobileSidebar({ open, onClose }: MobileSidebarProps) {
  const { signOut } = useAuth();
  const location = useLocation();
  const { connectedEmails } = useConnectedEmails();

  const handleNavClick = () => {
    onClose();
  };

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent side="left" className="w-72 p-0 flex flex-col">
        <SheetHeader className="p-4 border-b border-border">
          <div className="flex items-center justify-between">
            <img src={wibooklyLogo} alt="Wibookly" className="h-10 w-auto" />
          </div>
        </SheetHeader>

        {/* Connected Emails Section */}
        <div className="p-3 border-b border-border">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Emails</h3>
          {connectedEmails.length > 0 ? (
            <div className="space-y-1.5">
              {connectedEmails.map((connection) => (
                <div
                  key={connection.email}
                  className="flex items-center gap-2 px-2 py-1.5 bg-primary/10 rounded-md min-w-0"
                >
                  {connection.provider === 'google' ? (
                    <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 48 48" fill="none">
                      <path d="M43.611 20.083H42V20H24V28H35.303C33.654 32.657 29.223 36 24 36C17.373 36 12 30.627 12 24C12 17.373 17.373 12 24 12C27.059 12 29.842 13.154 31.961 15.039L37.618 9.382C34.046 6.053 29.268 4 24 4C12.955 4 4 12.955 4 24C4 35.045 12.955 44 24 44C35.045 44 44 35.045 44 24C44 22.659 43.862 21.35 43.611 20.083Z" fill="#FFC107"/>
                      <path d="M6.306 14.691L12.877 19.51C14.655 15.108 18.961 12 24 12C27.059 12 29.842 13.154 31.961 15.039L37.618 9.382C34.046 6.053 29.268 4 24 4C16.318 4 9.656 8.337 6.306 14.691Z" fill="#FF3D00"/>
                      <path d="M24 44C29.166 44 33.86 42.023 37.409 38.808L31.219 33.57C29.211 35.091 26.715 36 24 36C18.798 36 14.381 32.683 12.717 28.054L6.195 33.079C9.505 39.556 16.227 44 24 44Z" fill="#4CAF50"/>
                      <path d="M43.611 20.083H42V20H24V28H35.303C34.511 30.237 33.072 32.166 31.216 33.571L31.219 33.57L37.409 38.808C36.971 39.205 44 34 44 24C44 22.659 43.862 21.35 43.611 20.083Z" fill="#1976D2"/>
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 48 48" fill="none">
                      <path d="M28 8H44V40H28V8Z" fill="#1976D2"/>
                      <path d="M28 8L4 13V35L28 40V8Z" fill="#2196F3"/>
                      <path d="M16 18C12.686 18 10 20.686 10 24C10 27.314 12.686 30 16 30C19.314 30 22 27.314 22 24C22 20.686 19.314 18 16 18ZM16 27C14.343 27 13 25.657 13 24C13 22.343 14.343 21 16 21C17.657 21 19 22.343 19 24C19 25.657 17.657 27 16 27Z" fill="white"/>
                    </svg>
                  )}
                  <span className="text-[10px] font-medium text-primary truncate min-w-0">{connection.email}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No emails connected</p>
          )}
        </div>

        {/* Onboarding Progress */}
        <div className="p-3">
          <OnboardingChecklist onStepClick={handleNavClick} />
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-auto">
          {navItems.map((item) => {
            const isActive = location.pathname === item.href;
            return (
              <NavLink
                key={item.href}
                to={item.href}
                onClick={handleNavClick}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                )}
              >
                <item.icon className="w-4 h-4" />
                {item.title}
              </NavLink>
            );
          })}
        </nav>

        <div className="p-3 border-t border-border">
          <button
            onClick={() => {
              signOut();
              onClose();
            }}
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
