import { useEffect, useState, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Check, Mail, FolderOpen, User, X, ChevronDown, ChevronUp, FileText, Sparkles, Calendar, PenLine } from 'lucide-react';
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
  isOptional?: boolean;
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
      href: '/settings',
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
      id: 'rules',
      title: 'Setup Rules',
      description: 'Create email rules',
      icon: FileText,
      href: '/categories',
      isComplete: false,
      isOptional: true
    },
    {
      id: 'signature',
      title: 'Update Profile & Signature',
      description: 'Set up your email signature',
      icon: PenLine,
      href: '/settings',
      isComplete: false,
      isOptional: true
    },
    {
      id: 'ai-drafts',
      title: 'Setup AI Drafts',
      description: 'Configure AI draft settings',
      icon: Sparkles,
      href: '/ai-activity',
      isComplete: false
    },
    {
      id: 'calendars',
      title: 'Connect Calendars',
      description: 'Link your calendars',
      icon: Calendar,
      href: '/integrations',
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

        const { count: rulesCount } = await supabase
          .from('rules')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', organization.id)
          .eq('is_enabled', true);

        const { data: aiSettings } = await supabase
          .from('ai_settings')
          .select('writing_style')
          .eq('organization_id', organization.id)
          .single();

        const { data: emailProfile } = await supabase
          .from('email_profiles')
          .select('email_signature, signature_enabled')
          .eq('organization_id', organization.id)
          .limit(1)
          .single();

        setSteps(prev => prev.map(step => {
          let isComplete = step.isComplete;
          if (step.id === 'account') isComplete = true;
          if (step.id === 'email') isComplete = hasEmailConnected;
          if (step.id === 'categories') isComplete = (categoriesCount || 0) > 0;
          if (step.id === 'rules') isComplete = (rulesCount || 0) > 0;
          if (step.id === 'signature') isComplete = !!(emailProfile?.email_signature && emailProfile?.signature_enabled);
          if (step.id === 'ai-drafts') isComplete = !!(aiSettings?.writing_style && aiSettings.writing_style !== 'professional');
          if (step.id === 'calendars') isComplete = false; // Calendar integration not implemented yet
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

  // Count only required steps for progress
  const requiredSteps = steps.filter(s => !s.isOptional);
  const completedRequiredCount = requiredSteps.filter(s => s.isComplete).length;
  const completedCount = steps.filter(s => s.isComplete).length;
  const progress = (completedRequiredCount / requiredSteps.length) * 100;
  const allRequiredComplete = completedRequiredCount === requiredSteps.length;

  // Trigger confetti only when a step NEWLY completes (not on page load/refresh)
  const initialCompletedRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (loading) return;
    
    if (initialCompletedRef.current === null) {
      initialCompletedRef.current = new Set(steps.filter(s => s.isComplete).map(s => s.id));
      setPrevCompletedCount(completedCount);
      return;
    }
    
    steps.forEach(step => {
      if (step.isComplete && 
          !hasAnimated.current.has(step.id) && 
          !initialCompletedRef.current?.has(step.id)) {
        hasAnimated.current.add(step.id);
        triggerConfetti();
      }
    });

    if (allRequiredComplete && prevCompletedCount < requiredSteps.length && initialCompletedRef.current.size < requiredSteps.length) {
      triggerBigConfetti();
    }

    setPrevCompletedCount(completedCount);
  }, [steps, loading, completedCount, allRequiredComplete, prevCompletedCount, requiredSteps.length]);

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
      '/settings': 0,
      '/integrations': 1,
      '/categories': 2,
      '/ai-activity': 5
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
          {[1, 2, 3].map(i => (
            <div key={i} className="h-12 bg-muted animate-pulse rounded" />
          ))}
        </div>
      </div>
    );
  }

  // Custom step indicator component
  const StepIndicator = ({ step, isActive }: { step: OnboardingStep; isActive: boolean }) => {
    const Icon = step.icon;
    
    if (step.isComplete) {
      // Green filled circle with checkmark for complete
      return (
        <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-emerald-500 text-white">
          <Check className="w-4 h-4" />
        </div>
      );
    }
    
    // Orange half-circle for incomplete steps
    return (
      <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center relative overflow-hidden bg-muted">
        {/* Orange half-fill on the left side */}
        <div 
          className="absolute left-0 top-0 bottom-0 w-1/2 bg-orange-400"
        />
        {/* Icon on top */}
        <Icon className={cn(
          "w-4 h-4 relative z-10",
          isActive ? "text-primary-foreground" : "text-muted-foreground"
        )} />
      </div>
    );
  };

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
            <span className="text-xs text-muted-foreground">{completedRequiredCount}/{requiredSteps.length}</span>
            {allRequiredComplete && (
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
            className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-700 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div 
        className={cn(
          'transition-all duration-300 ease-out overflow-hidden',
          isCollapsed ? 'max-h-0' : 'max-h-[32rem]'
        )}
      >
        <div className="p-2">
          {steps.map((step, index) => {
            const isActive = currentStepIndex === index;
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
                <StepIndicator step={step} isActive={isActive} />
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={cn(
                      'text-sm font-medium transition-all duration-200',
                      step.isComplete && 'text-muted-foreground line-through'
                    )}>
                      {step.title}
                    </p>
                    {step.isOptional && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
                        Optional
                      </span>
                    )}
                  </div>
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

        {allRequiredComplete && (
          <div className="p-3 border-t border-border bg-emerald-500/10">
            <p className="text-xs text-center text-emerald-600 font-medium">
              🎉 All set! You're ready to go
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
