import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { PageHero } from '@/components/app/PageHero';
import { BellRing, Flag, Tag as TagIcon, Sparkles, Send, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { toast } from 'sonner';

type Prefs = {
  enabled: boolean;
  autoReply: boolean;
  autoSend: boolean;
};

const DEFAULTS: Prefs = { enabled: true, autoReply: false, autoSend: false };

function storageKey(userId: string | undefined) {
  return `flag-tracker-prefs:${userId || 'anon'}`;
}

export default function FlaggedEmailSettings() {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);

  useEffect(() => {
    if (!user?.id) return;
    try {
      const raw = localStorage.getItem(storageKey(user.id));
      if (raw) setPrefs({ ...DEFAULTS, ...JSON.parse(raw) });
    } catch {/* ignore */}
  }, [user?.id]);

  const update = (patch: Partial<Prefs>) => {
    const next = { ...prefs, ...patch };
    // Auto-send requires auto-reply
    if (!next.autoReply) next.autoSend = false;
    // Disabling the tracker disables both reply behaviors
    if (!next.enabled) { next.autoReply = false; next.autoSend = false; }
    setPrefs(next);
    try { localStorage.setItem(storageKey(user?.id), JSON.stringify(next)); } catch {/* ignore */}
    toast.success('Preferences saved');
  };

  return (
    <div className="page-shell">
      <div className="page-shell-sticky">
        <PageHero
          eyebrow="AI Intelligence"
          title="Flagged Email Tracker"
          description="Turn the tracker on or off, decide whether AI should automatically draft or even send polite follow-ups, and learn how to flag emails in Outlook."
          accent="purple"
          icon={<BellRing className="w-5 h-5 text-white" strokeWidth={2} />}
        />
      </div>

      <div className="page-shell-content w-full animate-fade-in space-y-6">
        {/* Controls */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tracker controls</CardTitle>
            <CardDescription>These settings only affect your account. Recipients never see flags or categories — they're private to your mailbox.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <ToggleRow
              icon={<Sparkles className="w-4 h-4 text-purple-500" />}
              title="Enable Flagged Email Tracker"
              description="Scan your Outlook Sent Items for flags & FollowUp categories and surface them in the Flagged Email Reports."
              checked={prefs.enabled}
              onCheckedChange={(v) => update({ enabled: v })}
            />
            <ToggleRow
              icon={<BellRing className="w-4 h-4 text-amber-500" />}
              title="Auto-draft follow-up replies"
              description="When the due date passes with no reply, AI writes a polite follow-up draft in the same thread (left unsent for your review)."
              checked={prefs.autoReply}
              onCheckedChange={(v) => update({ autoReply: v })}
              disabled={!prefs.enabled}
            />
            <ToggleRow
              icon={<Send className="w-4 h-4 text-emerald-500" />}
              title="Auto-send follow-up replies"
              description="Send the AI-drafted follow-up automatically (max 2 attempts per email, 3 days apart). Use with caution — drafts will be sent without review."
              checked={prefs.autoSend}
              onCheckedChange={(v) => update({ autoSend: v })}
              disabled={!prefs.enabled || !prefs.autoReply}
            />

            {prefs.autoSend && (
              <Alert variant="destructive">
                <ShieldAlert className="h-4 w-4" />
                <AlertTitle>Auto-send is on</AlertTitle>
                <AlertDescription>
                  Follow-ups will be sent on your behalf from your connected Outlook account. Make sure recipients and tone are appropriate. You can turn this off at any time.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* How it works */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">How to flag an email</CardTitle>
            <CardDescription>Two zero-config gestures in Outlook — pick whichever is faster for you.</CardDescription>
          </CardHeader>
          <CardContent className="grid md:grid-cols-2 gap-4 text-sm">
            <div className="rounded-lg border p-4">
              <div className="flex items-center gap-2 font-medium mb-1"><Flag className="w-4 h-4 text-amber-500" /> Flag + due date (preferred)</div>
              <ol className="list-decimal pl-5 text-muted-foreground space-y-1">
                <li>Send your email as usual.</li>
                <li>Open the message in <strong>Sent Items</strong>.</li>
                <li>Click the flag icon and pick <strong>Custom… → Due date</strong>.</li>
                <li>InboxIQ drafts a polite follow-up on that date if no reply has arrived.</li>
              </ol>
            </div>
            <div className="rounded-lg border p-4">
              <div className="flex items-center gap-2 font-medium mb-1"><TagIcon className="w-4 h-4 text-emerald-500" /> Category fallback</div>
              <ol className="list-decimal pl-5 text-muted-foreground space-y-1">
                <li>Apply a category to the sent message.</li>
                <li>Use <code className="px-1 rounded bg-muted">FollowUp</code> (defaults to 3 days), or <code className="px-1 rounded bg-muted">FollowUp 5d</code> for any 1–999 day window.</li>
                <li>We'll calculate the follow-up date from when you sent the email.</li>
              </ol>
            </div>
          </CardContent>
        </Card>

        {/* What InboxIQ does */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">What InboxIQ does for you</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {[
                'Polls your Outlook Sent Items every few minutes for flagged / categorized messages.',
                'Watches the conversation for a real reply (auto-replies and out-of-office are ignored).',
                'On the due date, drafts a short, polite follow-up in your tone — never pushy, never "just circling back".',
                'Caps at 2 attempts per email, then marks it as missed deadline.',
                'If you complete the flag or the recipient replies, the tracker cancels automatically.',
              ].map((line) => (
                <li key={line} className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                  <span className="text-muted-foreground">{line}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ToggleRow({
  icon, title, description, checked, onCheckedChange, disabled,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`flex items-start justify-between gap-4 rounded-lg border p-4 ${disabled ? 'opacity-60' : ''}`}>
      <div className="flex items-start gap-3 min-w-0">
        <div className="mt-0.5">{icon}</div>
        <div className="min-w-0">
          <Label className="text-sm font-medium">{title}</Label>
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        </div>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  );
}
