import FollowUpReminderSettings from '@/components/follow-up/FollowUpReminderSettings';
import { PageHero } from '@/components/app/PageHero';
import { BellRing } from 'lucide-react';

export default function FollowUpReminderPage() {
  return (
    <div className="page-shell space-y-6">
      <div className="page-shell-sticky">
        <PageHero
          eyebrow="AI Intelligence"
          title="No Reply Tracker"
          description="Never lose a thread. BCC a numeric address to schedule an automatic nudge when no one replies."
          accent="pink"
          icon={<BellRing className="w-5 h-5 text-white" strokeWidth={2} />}
        />
      </div>
      <div className="page-shell-content">
        <FollowUpReminderSettings />
      </div>
    </div>
  );
}
