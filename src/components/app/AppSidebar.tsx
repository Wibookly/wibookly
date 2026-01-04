import { NavLink, useLocation } from 'react-router-dom';
import { LayoutDashboard, Plug, FolderOpen, ListFilter, RefreshCw, Settings, LogOut } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import wibooklyLogo from '@/assets/wibookly-logo.png';
import { OnboardingChecklist } from './OnboardingChecklist';

const navItems = [
  { title: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { title: 'Integrations', href: '/integrations', icon: Plug },
  { title: 'Categories', href: '/categories', icon: FolderOpen },
  { title: 'Rules', href: '/rules', icon: ListFilter },
  { title: 'Sync', href: '/sync', icon: RefreshCw },
  { title: 'Settings', href: '/settings', icon: Settings },
];

export function AppSidebar() {
  const { signOut, organization } = useAuth();
  const location = useLocation();

  return (
    <aside className="w-64 h-screen bg-card border-r border-border flex flex-col">
      <div className="p-4 border-b border-border">
        <img src={wibooklyLogo} alt="Wibookly" className="h-10 w-auto" />
        {organization && (
          <p className="mt-2 text-xs text-muted-foreground truncate">{organization.name}</p>
        )}
      </div>

      {/* Onboarding Progress */}
      <div className="p-3">
        <OnboardingChecklist />
      </div>

      <nav className="flex-1 p-3 space-y-1 overflow-auto">
        {navItems.map((item) => {
          const isActive = location.pathname === item.href;
          return (
            <NavLink
              key={item.href}
              to={item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
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
