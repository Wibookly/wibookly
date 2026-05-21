import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Sparkles, X, Compass, GraduationCap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTrainingMode } from './TrainingMode';
import { useTour } from '@/components/onboarding/TourProvider';
import { getContextualArticles, type HelpArticle } from '@/config/help-content';
import {
  OPEN_HELP_PANEL_EVENT,
  START_GUIDED_TOUR_EVENT,
  type OpenHelpPanelDetail,
  type StartGuidedTourDetail,
} from './events';

/**
 * Floating page-guide affordance, anchored bottom-left.
 *
 * - Auto-detects the current route's primary contextual help article.
 * - When that article has steps with `target` selectors, exposes a primary
 *   "Tour this page" button that launches the GuidedTour overlay (spotlights
 *   each element as it's described).
 * - Always exposes a secondary "Read guide" affordance that opens the Help
 *   panel deep-linked to the same article (full text + screenshots).
 * - Per-page dismiss is remembered in localStorage; dismissed pages collapse
 *   to a small icon that can be re-expanded.
 */

function hasTour(article: HelpArticle | undefined) {
  return !!article?.steps?.some((s) => !!s.target);
}

export function PageGuide() {
  const location = useLocation();
  const articles = useMemo(
    () => getContextualArticles(location.pathname),
    [location.pathname],
  );
  const primary = articles[0];
  const tourAvailable = hasTour(primary);
  const storageKey = primary ? `inboxiq-page-guide-dismissed:${primary.id}` : null;

  const [collapsed, setCollapsed] = useState(false);
  const [training, setTraining] = useTrainingMode();

  useEffect(() => {
    if (!storageKey) {
      setCollapsed(false);
      return;
    }
    try {
      setCollapsed(localStorage.getItem(storageKey) === '1');
    } catch {
      setCollapsed(false);
    }
  }, [storageKey]);

  if (!primary) return null;

  const openPanel = () => {
    window.dispatchEvent(
      new CustomEvent<OpenHelpPanelDetail>(OPEN_HELP_PANEL_EVENT, {
        detail: { articleId: primary.id },
      }),
    );
  };

  const startTour = () => {
    window.dispatchEvent(
      new CustomEvent<StartGuidedTourDetail>(START_GUIDED_TOUR_EVENT, {
        detail: { articleId: primary.id },
      }),
    );
  };

  const dismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (storageKey) {
      try { localStorage.setItem(storageKey, '1'); } catch { /* ignore */ }
    }
    setCollapsed(true);
  };

  const reopen = () => {
    if (storageKey) {
      try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
    }
    setCollapsed(false);
  };

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={reopen}
        aria-label="Show page guide"
        title="Show guide for this page"
        className="fixed bottom-4 left-4 z-40 h-10 w-10 rounded-full bg-primary/90 text-primary-foreground shadow-lg hover:bg-primary hover:scale-105 transition flex items-center justify-center"
      >
        <Sparkles className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div
      className={cn(
        'fixed bottom-4 left-4 z-40 flex items-stretch rounded-full',
        'bg-primary text-primary-foreground shadow-xl ring-2 ring-primary/30',
      )}
      style={{
        boxShadow:
          '0 0 0 4px hsl(var(--primary) / 0.18), 0 10px 30px -10px hsl(var(--primary) / 0.5)',
      }}
    >
      {tourAvailable ? (
        <button
          type="button"
          onClick={startTour}
          className="flex items-center gap-2 pl-3 pr-2.5 py-2 rounded-l-full hover:bg-primary/90 transition"
          title="Walk me through every button on this page"
        >
          <Compass className="h-4 w-4 animate-pulse" />
          <span className="text-xs font-semibold hidden sm:inline">
            Tour this page
          </span>
          <span className="text-xs font-semibold sm:hidden">Tour</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={openPanel}
          className="flex items-center gap-2 pl-3 pr-2.5 py-2 rounded-l-full hover:bg-primary/90 transition"
          title="Step-by-step guide for this page"
        >
          <Sparkles className="h-4 w-4" />
          <span className="text-xs font-medium hidden sm:inline">
            Guide me through this page
          </span>
          <span className="text-xs font-medium sm:hidden">Guide me</span>
        </button>
      )}

      {tourAvailable && (
        <button
          type="button"
          onClick={openPanel}
          aria-label="Open full help article"
          title="Read the full guide"
          className="flex items-center justify-center px-2 hover:bg-primary/90 transition border-l border-primary-foreground/20"
        >
          <Sparkles className="h-3.5 w-3.5 opacity-90" />
        </button>
      )}

      <button
        type="button"
        onClick={() => setTraining(!training)}
        aria-label={training ? 'Exit training mode' : 'Enter training mode'}
        title={
          training
            ? 'Exit training mode'
            : 'Highlight every control on this page and show inline hints on hover'
        }
        className={cn(
          'flex items-center justify-center px-2 transition border-l border-primary-foreground/20',
          training ? 'bg-primary-foreground/20' : 'hover:bg-primary/90',
        )}
      >
        <GraduationCap
          className={cn('h-3.5 w-3.5', training && 'animate-pulse')}
        />
      </button>


      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss page guide"
        title="Hide for this page"
        className="flex items-center justify-center pl-1 pr-2.5 rounded-r-full hover:bg-primary/90 transition border-l border-primary-foreground/20"
      >
        <X className="h-3.5 w-3.5 opacity-80" />
      </button>
    </div>
  );
}
