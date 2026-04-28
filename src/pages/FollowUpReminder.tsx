import FollowUpReminderSettings from '@/components/follow-up/FollowUpReminderSettings';
import { HelpDot } from '@/components/help/HelpDot';

export default function FollowUpReminderPage() {
  return (
    <div className="container max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          Follow-Up Reminder
          <HelpDot articleId="follow-up-reminder" label="How follow-ups work" />
        </h1>
        <p className="text-muted-foreground mt-1">
          Never lose a thread. BCC a numeric address to schedule an automatic nudge.
        </p>
      </div>
      <FollowUpReminderSettings />
    </div>
  );
}
