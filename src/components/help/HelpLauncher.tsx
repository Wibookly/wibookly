import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { LifeBuoy } from 'lucide-react';
import { HelpPanel } from './HelpPanel';
import { OPEN_HELP_PANEL_EVENT, type OpenHelpPanelDetail } from './events';

/**
 * Floating circular Help button, fixed to the bottom-right of every
 * authenticated page. Opens the side help panel which combines articles,
 * search, contextual help, quick links, and (Phase 2) the AI chatbot.
 */
export function HelpLauncher() {
  const [open, setOpen] = useState(false);
  const [initialArticleId, setInitialArticleId] = useState<string | null>(null);

  // Allow other components to open the panel via a custom event.
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
      <Button
        type="button"
        onClick={() => {
          setInitialArticleId(null);
          setOpen(true);
        }}
        aria-label="Open help and support"
        className="fixed bottom-5 right-5 z-40 h-12 w-12 rounded-full p-0 shadow-lg hover:shadow-xl transition-shadow"
      >
        <LifeBuoy className="h-5 w-5" />
      </Button>
      <HelpPanel
        open={open}
        onOpenChange={setOpen}
        initialArticleId={initialArticleId}
      />
    </>
  );
}
