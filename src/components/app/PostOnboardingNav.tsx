import { Link } from 'react-router-dom';
import { Settings, FolderOpen, Sparkles, BarChart3, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface NavItem {
  href: string;
  icon: React.ElementType;
  title: string;
  description: string;
}

const navItems: NavItem[] = [
  {
    href: '/integrations',
    icon: Settings,
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
    title: 'AI Draft Settings',
    description: 'Configure AI writing preferences'
  },
  {
    href: '/ai-activity',
    icon: BarChart3,
    title: 'AI Activity',
    description: 'View AI actions & scheduled events'
  }
];

export function PostOnboardingNav() {
  return (
    <div className="bg-card rounded-lg border border-border p-4 animate-fade-in">
      <h3 className="text-sm font-semibold text-muted-foreground mb-3">Quick Navigation</h3>
      <div className="grid gap-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.href} to={item.href}>
              <Button
                variant="ghost"
                className="w-full justify-between h-auto py-3 px-3 hover:bg-muted/50"
              >
                <div className="flex items-center gap-3">
                  <div className="flex-shrink-0 w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
                    <Icon className="w-4 h-4 text-primary" />
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-medium">{item.title}</p>
                    <p className="text-xs text-muted-foreground">{item.description}</p>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground" />
              </Button>
            </Link>
          );
        })}
      </div>
    </div>
  );
}