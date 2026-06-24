import { useEffect } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { LifeBuoy } from 'lucide-react';
import { HelpIssueForm } from './HelpIssueForm';

type HelpTab = 'articles' | 'chat' | 'issue';

interface HelpPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Kept for backwards compatibility — ignored, the panel always shows the issue form. */
  initialArticleId?: string | null;
  /** Kept for backwards compatibility — ignored. */
  initialTab?: HelpTab;
}

/**
 * Help & Support is now ticketing-only. Articles and AI Chat tabs were removed
 * per user request — the panel just opens a "send your admin team an issue" form.
 * The feature dropdown inside HelpIssueForm filters itself based on the user's
 * access level, so users never see features they don't have.
 */
export function HelpPanel({ open, onOpenChange }: HelpPanelProps) {
  // Keep the body scroll-locked state in sync if needed
  useEffect(() => {
    return () => {};
  }, []);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md p-0 flex flex-col"
        aria-label="Help and support panel"
      >
        <SheetHeader className="px-5 pt-5 pb-3 border-b">
          <div className="flex items-center gap-2">
            <LifeBuoy className="w-5 h-5 text-primary" aria-hidden />
            <SheetTitle>Help & Support</SheetTitle>
          </div>
          <SheetDescription className="text-xs">
            Send your admin team an issue — we'll include the page you're on.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <HelpIssueForm />
        </div>
      </SheetContent>
    </Sheet>
  );
}
