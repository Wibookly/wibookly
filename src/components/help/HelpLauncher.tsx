import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { LifeBuoy } from 'lucide-react';
import { HelpPanel } from './HelpPanel';
import { OPEN_HELP_PANEL_EVENT, type OpenHelpPanelDetail } from './events';

/**
 * Floating Help & Support button, fixed to the bottom-right of every
 * authenticated page. Bright, labeled, and gently pulsing so brand-new users
 * always know where to click for help.
 */
export function HelpLauncher() {
  const [open, setOpen] = useState(false);
  const [initialArticleId, setInitialArticleId] = useState<string | null>(null);

  // Allow other components (e.g. <HelpDot articleId="..." />) to open the panel.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<OpenHelpPanelDetail>).detail;
      setInitialArticleId(detail?.articleId ?? null);
      setOpen(true);
    };
    window.addEventListener(OPEN_HELP_PANEL_EVENT, handler);
    return () => window.removeEventListener(OPEN_HELP_PANEL_EVENT, handler);
  }, []);

  return (
    <>
      {/* Subtle pulsing halo — purely decorative, sits behind the button. */}
      <span
        aria-hidden
        className="fixed bottom-5 right-5 z-30 h-14 w-32 rounded-full bg-primary/30 blur-xl animate-pulse pointer-events-none"
      />
      <Button
        type="button"
        size="lg"
        onClick={() => {
          setInitialArticleId(null);
          setOpen(true);
        }}
        aria-label="Open help and support"
        className="fixed bottom-5 right-5 z-40 h-14 rounded-full pl-4 pr-5 shadow-xl hover:shadow-2xl transition-all hover:scale-105 bg-primary text-primary-foreground font-semibold gap-2"
      >
        <span className="relative flex h-8 w-8 items-center justify-center rounded-full bg-primary-foreground/20">
          <LifeBuoy className="h-5 w-5" />
          <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-accent" />
          </span>
        </span>
        Help &amp; Support
      </Button>
      <HelpPanel
        open={open}
        onOpenChange={setOpen}
        initialArticleId={initialArticleId}
      />
    </>
  );
}
