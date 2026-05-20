import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getContextualArticles } from '@/config/help-content';
import { OPEN_HELP_PANEL_EVENT, type OpenHelpPanelDetail } from './events';

/**
 * Floating "Guide me through this page" pill, anchored bottom-left.
 *
 * - Auto-detects the current route's primary contextual help article.
 * - Pulses gently so users notice it the first time they land on a page.
 * - Click → opens the global Help panel deep-linked to that article
 *   (step-by-step instructions for every button/toggle on the page).
 * - Per-page dismiss is remembered in localStorage; dismissed pages
 *   collapse to a small icon that can be re-expanded.
 */
export function PageGuide() {
  const location = useLocation();
  const articles = useMemo(
    () => getContextualArticles(location.pathname),
    [location.pathname],
  );
  const primary = articles[0];
  const storageKey = primary ? `inboxiq-page-guide-dismissed:${primary.id}` : null;

  const [collapsed, setCollapsed] = useState(false);

  // Re-check dismissed state on every route change.
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

  const open = () => {
    window.dispatchEvent(
      new CustomEvent<OpenHelpPanelDetail>(OPEN_HELP_PANEL_EVENT, {
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
        'bg-primary text-primary-foreground shadow-xl',
        'ring-2 ring-primary/30 animate-pulse-slow',
      )}
      style={{
        // Soft glow so it visibly illuminates on dark + light themes.
        boxShadow:
          '0 0 0 4px hsl(var(--primary) / 0.18), 0 10px 30px -10px hsl(var(--primary) / 0.5)',
      }}
    >
      <button
        type="button"
        onClick={open}
        className="flex items-center gap-2 pl-3 pr-2 py-2 rounded-l-full hover:bg-primary/90 transition"
        title="Step-by-step guide for this page"
      >
        <Sparkles className="h-4 w-4" />
        <span className="text-xs font-medium hidden sm:inline">
          Guide me through this page
        </span>
        <span className="text-xs font-medium sm:hidden">Guide me</span>
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
