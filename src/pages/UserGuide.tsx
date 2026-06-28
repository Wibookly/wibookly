import { useEffect } from 'react';
import { PageHero } from '@/components/app/PageHero';
import { Compass, BookOpen, MapPin } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { HelpQuickActions } from '@/components/help/HelpQuickActions';
import { OPEN_WELCOME_GUIDE_EVENT } from '@/components/help/events';

export default function UserGuide() {
  const openWelcome = () => {
    window.dispatchEvent(new CustomEvent(OPEN_WELCOME_GUIDE_EVENT));
  };

  // Auto-open the Welcome Guide on first visit
  useEffect(() => {
    const t = setTimeout(openWelcome, 250);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="page-shell">
      <div className="page-shell-sticky">
        <PageHero
          eyebrow="Knowledge Base"
          title="User Guide"
          description="A guided tour of every InboxIQ feature, plus per-page walkthroughs you can launch whenever you need them."
          accent="cyan"
          icon={<Compass className="w-5 h-5 text-white" strokeWidth={2} />}
        />
      </div>

      <div className="page-shell-content w-full animate-fade-in max-w-3xl space-y-4">
        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-start gap-3">
              <BookOpen className="w-5 h-5 text-primary mt-0.5 shrink-0" />
              <div>
                <h3 className="font-semibold">Full InboxIQ User Guide</h3>
                <p className="text-sm text-muted-foreground">
                  Step-by-step walkthroughs for every feature your account has access to.
                </p>
              </div>
            </div>
            <Button onClick={openWelcome}>Open User Guide</Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-start gap-3">
              <MapPin className="w-5 h-5 text-primary mt-0.5 shrink-0" />
              <div>
                <h3 className="font-semibold">Quick actions</h3>
                <p className="text-sm text-muted-foreground">
                  Tour the page you're currently on, or send your admin team a support ticket.
                </p>
              </div>
            </div>
            <HelpQuickActions />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
