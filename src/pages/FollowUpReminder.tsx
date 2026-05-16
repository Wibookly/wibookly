import FollowUpReminderSettings from '@/components/follow-up/FollowUpReminderSettings';
import { PageHero } from '@/components/app/PageHero';
import { BellRing } from 'lucide-react';

export default function FollowUpReminderPage() {
  return (
    <div className="container max-w-4xl mx-auto p-6 space-y-6">
      <PageHero
        eyebrow="AI Intelligence"
        title="No Reply Tracker"
        description="Never lose a thread. BCC a numeric address to schedule an automatic nudge when no one replies."
        accent="pink"
        icon={<BellRing className="w-5 h-5 text-white" strokeWidth={2} />}
      />
      <FollowUpReminderSettings />
    </div>
  );
}
