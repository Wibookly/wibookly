import { Link, useLocation } from 'react-router-dom';
import { Plug, FolderOpen, Sparkles, BarChart3, Calendar, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  icon: React.ElementType;
  title: string;
  description: string;
}

const navItems: NavItem[] = [
  {
    href: '/integrations',
    icon: Plug,
    title: 'Integrations',
    description: 'Manage email & calendar connections'
  },
  {
    href: '/categories',
    icon: FolderOpen,
    title: 'Categories',
    description: 'Organize emails with categories & rules'
  },
  {
    href: '/email-draft',
    icon: Sparkles,
    title: 'AI Settings',
    description: 'Configure AI writing preferences'
  },
  {
    href: '/ai-calendar',
    icon: Calendar,
    title: 'AI Calendar',
    description: 'Availability & calendar event settings'
  },
  {
    href: '/ai-activity',
    icon: BarChart3,
    title: 'AI Activity',
    description: 'View AI actions & scheduled events'
  }
];

export function PostOnboardingNav() {
  const location = useLocation();

  return (
    <div className="bg-card rounded-lg border border-border p-4 animate-fade-in">
      <h3 className="text-sm font-semibold text-muted-foreground mb-3">Quick Navigation</h3>
      <div className="grid gap-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.href;
          return (
            <Link key={item.href} to={item.href}>
              <Button
                variant="ghost"
                className={cn(
                  "w-full justify-between h-auto py-3 px-3 hover:bg-muted/50",
                  isActive && "bg-primary/10 border border-primary/30"
                )}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={cn(
                    "flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center",
                    isActive ? "bg-primary/20" : "bg-primary/10"
                  )}>
                    <Icon className={cn("w-4 h-4", isActive ? "text-primary" : "text-primary")} />
                  </div>
                  <div className="text-left min-w-0">
                    <p className={cn("text-sm font-medium truncate", isActive && "text-primary")}>{item.title}</p>
                    <p className="text-xs text-muted-foreground truncate">{item.description}</p>
                  </div>
                </div>
                <ArrowRight className={cn("w-4 h-4 flex-shrink-0", isActive ? "text-primary" : "text-muted-foreground")} />
              </Button>
            </Link>
          );
        })}
      </div>
    </div>
  );
}