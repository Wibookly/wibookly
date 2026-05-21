import FollowUpReminderSettings from '@/components/follow-up/FollowUpReminderSettings';
import { PageHero } from '@/components/app/PageHero';
import { BellRing } from 'lucide-react';

export default function FollowUpReminderPage() {
  return (
    <div className="min-h-full max-w-7xl mx-auto w-full p-4 lg:p-6 space-y-6">
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
