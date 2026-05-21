import { useEffect, useState } from 'react';
import { HelpPanel } from './HelpPanel';
import { OPEN_HELP_PANEL_EVENT, type OpenHelpPanelDetail } from './events';

/**
 * Headless host that mounts the Help & Support side panel and listens for
 * `OPEN_HELP_PANEL_EVENT`. Other components (e.g. the user dropdown, the
 * <HelpDot /> badges) open the panel by dispatching that event — no floating
 * launcher button is rendered.
 */
export function HelpPanelHost() {
  const [open, setOpen] = useState(false);
  const [initialArticleId, setInitialArticleId] = useState<string | null>(null);
  const [initialTab, setInitialTab] = useState<'articles' | 'chat' | 'issue' | undefined>(undefined);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<OpenHelpPanelDetail>).detail;
      setInitialArticleId(detail?.articleId ?? null);
      setInitialTab(detail?.initialTab);
      setOpen(true);
    };
    window.addEventListener(OPEN_HELP_PANEL_EVENT, handler);
    return () => window.removeEventListener(OPEN_HELP_PANEL_EVENT, handler);
  }, []);

  return (
    <HelpPanel
      open={open}
      onOpenChange={setOpen}
      initialArticleId={initialArticleId}
      initialTab={initialTab}
    />
  );
}
