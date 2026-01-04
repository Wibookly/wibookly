import { NavLink, useLocation } from 'react-router-dom';
import { LayoutDashboard, Plug, FolderOpen, ListFilter, RefreshCw, Settings, LogOut, X } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import wibooklyLogo from '@/assets/wibookly-logo.png';
import { OnboardingChecklist } from './OnboardingChecklist';
import { Sheet, SheetContent, SheetHeader } from '@/components/ui/sheet';

const navItems = [
  { title: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { title: 'Integrations', href: '/integrations', icon: Plug },
  { title: 'Categories', href: '/categories', icon: FolderOpen },
  { title: 'Rules', href: '/rules', icon: ListFilter },
  { title: 'Sync', href: '/sync', icon: RefreshCw },
  { title: 'Settings', href: '/settings', icon: Settings },
];

interface MobileSidebarProps {
  open: boolean;
  onClose: () => void;
}

export function MobileSidebar({ open, onClose }: MobileSidebarProps) {
  const { signOut, organization } = useAuth();
  const location = useLocation();

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
          {organization && (
            <p className="text-xs text-muted-foreground truncate text-left">{organization.name}</p>
          )}
        </SheetHeader>

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
