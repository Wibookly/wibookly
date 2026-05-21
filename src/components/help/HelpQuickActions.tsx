import { useLocation } from 'react-router-dom';
import { Compass, LifeBuoy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useTour } from '@/components/onboarding/TourProvider';
import { getContextualArticles } from '@/config/help-content';
import {
  OPEN_HELP_PANEL_EVENT,
  START_GUIDED_TOUR_EVENT,
  type OpenHelpPanelDetail,
  type StartGuidedTourDetail,
} from './events';

interface HelpQuickActionsProps {
  className?: string;
  compact?: boolean;
}

export function HelpQuickActions({ className, compact = false }: HelpQuickActionsProps) {
  const location = useLocation();
  const { startTour, hasTourForCurrentPage } = useTour();

  const openGuide = () => {
    if (hasTourForCurrentPage) {
      startTour();
      return;
    }

    const article = getContextualArticles(location.pathname)[0];

    if (article?.steps?.some((step) => !!step.target)) {
      window.dispatchEvent(
        new CustomEvent<StartGuidedTourDetail>(START_GUIDED_TOUR_EVENT, {
          detail: { articleId: article.id },
        }),
      );
      return;
    }

    window.dispatchEvent(
      new CustomEvent<OpenHelpPanelDetail>(OPEN_HELP_PANEL_EVENT, {
        detail: { articleId: article?.id, initialTab: 'articles' },
      }),
    );
  };

  const openSupport = () => {
    window.dispatchEvent(
      new CustomEvent<OpenHelpPanelDetail>(OPEN_HELP_PANEL_EVENT, {
        detail: { initialTab: 'issue' },
      }),
    );
  };

  return (
    <div className={cn('space-y-1.5', className)}>
      <Button
        type="button"
        variant="outline"
        onClick={openGuide}
        className={cn('w-full justify-start gap-2', compact && 'h-9 px-3 text-xs')}
      >
        <Compass className="w-4 h-4 text-primary" />
        <span>User Guide</span>
      </Button>

      <Button
        type="button"
        variant="outline"
        onClick={openSupport}
        className={cn('w-full justify-start gap-2', compact && 'h-9 px-3 text-xs')}
      >
        <LifeBuoy className="w-4 h-4 text-primary" />
        <span>Help &amp; Support</span>
      </Button>
    </div>
  );
}