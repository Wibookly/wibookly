import { useEffect, useState, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Check, Mail, FolderOpen, Sparkles, User, X, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import confetti from 'canvas-confetti';

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  href: string;
  isComplete: boolean;
}

interface OnboardingChecklistProps {
  onStepClick?: () => void;
}

export function OnboardingChecklist({ onStepClick }: OnboardingChecklistProps) {
  const { organization, profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isDismissed, setIsDismissed] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [prevCompletedCount, setPrevCompletedCount] = useState(0);
  const hasAnimated = useRef<Set<string>>(new Set());
  
  const [steps, setSteps] = useState<OnboardingStep[]>([
    {
      id: 'account',
      title: 'Create Account',
      description: 'Your account is ready',
      icon: User,
      href: '/dashboard',
      isComplete: true
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

  // Check localStorage for dismissed state
  useEffect(() => {
    const dismissed = localStorage.getItem(`onboarding-dismissed-${organization?.id}`);
    if (dismissed === 'true') {
      setIsDismissed(true);
    }
  }, [organization?.id]);

  useEffect(() => {
    if (!organization?.id) return;

    const fetchProgress = async () => {
      try {
        const { data: connections } = await supabase
          .from('provider_connections')
          .select('is_connected, provider')
          .eq('organization_id', organization.id);

        const hasEmailConnected = connections?.some(c => c.is_connected) || false;

        const { count: categoriesCount } = await supabase
          .from('categories')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', organization.id)
          .eq('is_enabled', true);

        const { data: aiCategories } = await supabase
          .from('categories')
          .select('id')
          .eq('organization_id', organization.id)
          .eq('ai_draft_enabled', true)
          .limit(1);

        setSteps(prev => prev.map(step => {
          let isComplete = step.isComplete;
          if (step.id === 'email') isComplete = hasEmailConnected;
          if (step.id === 'categories') isComplete = (categoriesCount || 0) > 0;
          if (step.id === 'ai') isComplete = (aiCategories?.length || 0) > 0;
          return { ...step, isComplete };
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
  const allComplete = completedCount === steps.length;

  // Trigger confetti when a step completes
  useEffect(() => {
    if (loading) return;
    
    steps.forEach(step => {
      if (step.isComplete && !hasAnimated.current.has(step.id)) {
        hasAnimated.current.add(step.id);
        
        // Only trigger confetti if this is a new completion (not initial load)
        if (prevCompletedCount > 0 || step.id !== 'account') {
          triggerConfetti();
        }
      }
    });

    // Big celebration when all complete
    if (allComplete && prevCompletedCount < steps.length && prevCompletedCount > 0) {
      triggerBigConfetti();
    }

    setPrevCompletedCount(completedCount);
  }, [steps, loading, completedCount, allComplete, prevCompletedCount]);

  const triggerConfetti = () => {
    confetti({
      particleCount: 50,
      spread: 60,
      origin: { y: 0.7, x: 0.2 },
      colors: ['#00b4d8', '#00d4aa', '#48cae4']
    });
  };

  const triggerBigConfetti = () => {
    const duration = 2000;
    const animationEnd = Date.now() + duration;

    const frame = () => {
      confetti({
        particleCount: 3,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors: ['#00b4d8', '#00d4aa', '#48cae4', '#90e0ef']
      });
      confetti({
        particleCount: 3,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors: ['#00b4d8', '#00d4aa', '#48cae4', '#90e0ef']
      });

      if (Date.now() < animationEnd) {
        requestAnimationFrame(frame);
      }
    };
    frame();
  };

  const handleDismiss = () => {
    setIsDismissed(true);
    if (organization?.id) {
      localStorage.setItem(`onboarding-dismissed-${organization.id}`, 'true');
    }
  };

  const handleStepClick = (href: string) => {
    navigate(href);
    onStepClick?.();
  };

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

  if (isDismissed) return null;

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
    <div className="bg-card rounded-lg border border-border overflow-hidden animate-fade-in">
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <button 
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="flex items-center gap-2 font-medium text-sm hover:text-primary transition-colors"
          >
            Setup Progress
            {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{completedCount}/{steps.length}</span>
            {allComplete && (
              <button 
                onClick={handleDismiss}
                className="p-1 rounded hover:bg-muted transition-colors"
                title="Dismiss"
              >
                <X className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            )}
          </div>
        </div>
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div 
            className="h-full bg-gradient-to-r from-primary to-accent transition-all duration-700 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div 
        className={cn(
          'transition-all duration-300 ease-out overflow-hidden',
          isCollapsed ? 'max-h-0' : 'max-h-96'
        )}
      >
        <div className="p-2">
          {steps.map((step, index) => {
            const isActive = currentStepIndex === index;
            const Icon = step.icon;
            const wasJustCompleted = step.isComplete && hasAnimated.current.has(step.id);
            
            return (
              <button
                key={step.id}
                onClick={() => handleStepClick(step.href)}
                className={cn(
                  'w-full flex items-center gap-3 p-3 rounded-md text-left transition-all duration-200',
                  isActive && 'bg-primary/10',
                  !isActive && 'hover:bg-muted/50',
                  wasJustCompleted && 'animate-scale-in'
                )}
              >
                <div className={cn(
                  'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300',
                  step.isComplete 
                    ? 'bg-success text-success-foreground scale-100' 
                    : isActive 
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground',
                  step.isComplete && 'animate-bounce'
                )}
                style={{ animationIterationCount: step.isComplete ? 1 : 0 }}
                >
                  {step.isComplete ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <Icon className="w-4 h-4" />
                  )}
                </div>
                
                <div className="flex-1 min-w-0">
                  <p className={cn(
                    'text-sm font-medium transition-all duration-200',
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

        {allComplete && (
          <div className="p-3 border-t border-border bg-success/10">
            <p className="text-xs text-center text-success font-medium">
              🎉 All set! You're ready to go
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
