/**
 * HelpTip — a small (?) icon that reveals inline guidance for any UI element.
 *
 * Usage:
 *   <Label>Display Name <HelpTip id="profile.displayName" /></Label>
 *
 * Content lives in `src/config/help-tooltips.ts` so non-developers can edit
 * copy without touching components. You can also pass `title` / `body` props
 * inline for one-offs.
 *
 * Behavior:
 * - Click/tap to open (works on touch devices).
 * - Optional "Learn more" link that opens the full Help panel to a specific
 *   article via the existing `OPEN_HELP_PANEL_EVENT`.
 */
import { HelpCircle } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { MiniMarkdown } from './MiniMarkdown';
import { HELP_TOOLTIPS, type HelpTooltipId } from '@/config/help-tooltips';
import { OPEN_HELP_PANEL_EVENT, type OpenHelpPanelDetail } from './events';

interface HelpTipProps {
  /** Key into HELP_TOOLTIPS. Either `id` or `title`+`body` is required. */
  id?: HelpTooltipId;
  title?: string;
  body?: string;
  /** Opens the full Help panel to this article id. */
  learnMoreArticleId?: string;
  /** Visual size of the (?) icon. */
  size?: 'sm' | 'md';
  /** Extra classes for the trigger button. */
  className?: string;
  /** Aria label override. */
  ariaLabel?: string;
}

export function HelpTip({
  id,
  title,
  body,
  learnMoreArticleId,
  size = 'sm',
  className,
  ariaLabel,
}: HelpTipProps) {
  const entry = id ? (HELP_TOOLTIPS[id] as { title: string; body: string; learnMoreArticleId?: string }) : undefined;
  const resolvedTitle = title ?? entry?.title;
  const resolvedBody = body ?? entry?.body;
  const resolvedArticle = learnMoreArticleId ?? entry?.learnMoreArticleId;

  if (!resolvedBody) {
    if (import.meta.env.DEV) {
      console.warn(`[HelpTip] No content found for id="${id}"`);
    }
    return null;
  }

  const iconSize = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';
  const btnSize = size === 'sm' ? 'h-5 w-5' : 'h-6 w-6';

  const openHelpPanel = () => {
    if (!resolvedArticle) return;
    const detail: OpenHelpPanelDetail = { articleId: resolvedArticle };
    window.dispatchEvent(new CustomEvent(OPEN_HELP_PANEL_EVENT, { detail }));
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel ?? `Help: ${resolvedTitle ?? 'more info'}`}
          className={`inline-flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors align-middle ${btnSize} ${className ?? ''}`}
          onClick={(e) => e.stopPropagation()}
        >
          <HelpCircle className={iconSize} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 p-4 z-50"
        align="start"
        side="top"
        onClick={(e) => e.stopPropagation()}
      >
        {resolvedTitle && (
          <p className="text-sm font-semibold text-foreground mb-2">{resolvedTitle}</p>
        )}
        <MiniMarkdown source={resolvedBody} />
        {resolvedArticle && (
          <div className="mt-3 pt-3 border-t">
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              onClick={openHelpPanel}
            >
              Learn more in Help Center →
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
