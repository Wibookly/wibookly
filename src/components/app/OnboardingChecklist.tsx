import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Check, Circle, Mail, FolderOpen, Sparkles, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  href: string;
  isComplete: boolean;
}

export function OnboardingChecklist() {
  const { organization, profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [steps, setSteps] = useState<OnboardingStep[]>([
    {
      id: 'account',
      title: 'Create Account',
      description: 'Your account is ready',
      icon: User,
      href: '/dashboard',
      isComplete: true // Always complete if user is logged in
    },
    {
      id: 'email',
      title: 'Connect Email',
      description: 'Link Google or Outlook',
      icon: Mail,
      href: '/integrations',
      isComplete: false
    },
    {
      id: 'categories',
      title: 'Setup Categories',
      description: 'Organize your inbox',
      icon: FolderOpen,
      href: '/categories',
      isComplete: false
    },
    {
      id: 'ai',
      title: 'Enable AI Drafts',
      description: 'Auto-generate replies',
      icon: Sparkles,
      href: '/settings',
      isComplete: false
    }
  ]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!organization?.id) return;

    const fetchProgress = async () => {
      try {
        // Check email connections (Google or Outlook)
        const { data: connections } = await supabase
          .from('provider_connections')
          .select('is_connected, provider')
          .eq('organization_id', organization.id);

        const hasEmailConnected = connections?.some(c => c.is_connected) || false;

        // Check categories
        const { count: categoriesCount } = await supabase
          .from('categories')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', organization.id)
          .eq('is_enabled', true);

        // Check AI enabled on any category
        const { data: aiCategories } = await supabase
          .from('categories')
          .select('id')
          .eq('organization_id', organization.id)
          .eq('ai_draft_enabled', true)
          .limit(1);

        setSteps(prev => prev.map(step => {
          if (step.id === 'email') return { ...step, isComplete: hasEmailConnected };
          if (step.id === 'categories') return { ...step, isComplete: (categoriesCount || 0) > 0 };
          if (step.id === 'ai') return { ...step, isComplete: (aiCategories?.length || 0) > 0 };
          return step;
        }));
      } catch (error) {
        console.error('Error fetching onboarding progress:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchProgress();
  }, [organization?.id]);

  const completedCount = steps.filter(s => s.isComplete).length;
  const progress = (completedCount / steps.length) * 100;

  // Find current step based on route
  const getCurrentStepIndex = () => {
    const pathMap: Record<string, number> = {
      '/dashboard': 0,
      '/integrations': 1,
      '/categories': 2,
      '/settings': 3
    };
    return pathMap[location.pathname] ?? -1;
  };

  const currentStepIndex = getCurrentStepIndex();

  if (loading) {
    return (
      <div className="bg-card rounded-lg border border-border p-4">
        <div className="h-4 w-32 bg-muted animate-pulse rounded mb-4" />
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-12 bg-muted animate-pulse rounded" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-lg border border-border overflow-hidden">
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-medium text-sm">Setup Progress</h3>
          <span className="text-xs text-muted-foreground">{completedCount}/{steps.length} complete</span>
        </div>
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div 
            className="h-full bg-primary transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="p-2">
        {steps.map((step, index) => {
          const isActive = currentStepIndex === index;
          const Icon = step.icon;
          
          return (
            <button
              key={step.id}
              onClick={() => navigate(step.href)}
              className={cn(
                'w-full flex items-center gap-3 p-3 rounded-md text-left transition-all',
                isActive && 'bg-primary/10',
                !isActive && 'hover:bg-muted/50'
              )}
            >
              <div className={cn(
                'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors',
                step.isComplete 
                  ? 'bg-success text-success-foreground' 
                  : isActive 
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
              )}>
                {step.isComplete ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <Icon className="w-4 h-4" />
                )}
              </div>
              
              <div className="flex-1 min-w-0">
                <p className={cn(
                  'text-sm font-medium',
                  step.isComplete && 'text-muted-foreground line-through'
                )}>
                  {step.title}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {step.description}
                </p>
              </div>

              {isActive && !step.isComplete && (
                <div className="flex-shrink-0 w-2 h-2 rounded-full bg-primary animate-pulse" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
