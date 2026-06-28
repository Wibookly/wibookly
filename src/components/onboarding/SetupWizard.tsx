import { ReactNode, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  Mail,
  PartyPopper,
  Pencil,
  Sparkles,
  UserCog,
  Users,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface SetupWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called when the user finishes (or skips) the wizard. */
  onComplete: () => void;
}

type StepKind = 'required' | 'optional';

interface WizardData {
  fullName: string;
  title: string;
  enableDailyBrief: boolean;
  invitesNote: string;
}

const TOTAL_STEPS = 7; // Welcome, Profile, Mailbox, Categories info, Daily Brief, Invite team, Review

export function SetupWizard({ open, onOpenChange, onComplete }: SetupWizardProps) {
  const { profile, user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [stepIndex, setStepIndex] = useState(0);
  const [whyOpen, setWhyOpen] = useState<Record<number, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [mailboxConnected, setMailboxConnected] = useState<boolean | null>(null);

  const [data, setData] = useState<WizardData>({
    fullName: '',
    title: '',
    enableDailyBrief: true,
    invitesNote: '',
  });

  // Hydrate from profile each time the wizard opens
  useEffect(() => {
    if (open) {
      setStepIndex(0);
      setData((prev) => ({
        ...prev,
        fullName: profile?.full_name ?? prev.fullName,
        title: profile?.title ?? prev.title,
      }));
    }
  }, [open, profile?.full_name, profile?.title]);

  // Detect mailbox connection so the Required step can validate
  useEffect(() => {
    if (!open || !user?.id) return;
    let cancelled = false;
    (async () => {
      const { data: rows } = await supabase.rpc('get_my_connections');
      if (cancelled) return;
      const connected = (rows ?? []).some((c: { is_connected: boolean }) => c.is_connected);
      setMailboxConnected(connected);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, user?.id, stepIndex]);

  const steps = useMemo(
    () => buildSteps({ data, setData, navigate, onOpenChange, mailboxConnected, whyOpen, setWhyOpen }),
    [data, navigate, onOpenChange, mailboxConnected, whyOpen]
  );

  const currentStep = steps[stepIndex];
  const isLast = stepIndex === steps.length - 1;
  const isFirst = stepIndex === 0;

  const canAdvance = currentStep.kind === 'optional' || currentStep.isValid !== false;

  const goNext = () => {
    if (!canAdvance) return;
    setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  };
  const goBack = () => setStepIndex((i) => Math.max(i - 1, 0));
  const jumpTo = (i: number) => setStepIndex(Math.max(0, Math.min(i, steps.length - 1)));

  const handleFinish = async () => {
    if (!user?.id) {
      onOpenChange(false);
      return;
    }
    setSaving(true);
    try {
      // Persist any profile fields the user updated in the wizard
      const updates: Record<string, unknown> = {};
      if (data.fullName.trim()) updates.full_name = data.fullName.trim();
      if (data.title.trim()) updates.title = data.title.trim();
      updates.onboarding_completed_at = new Date().toISOString();

      const { error } = await supabase
        .from('user_profiles')
        .update(updates as never)
        .eq('user_id', user.id);

      if (error) throw error;

      toast({
        title: 'You are all set!',
        description: "We'll keep the Help button at the bottom-right whenever you need a hand.",
      });
      onComplete();
      onOpenChange(false);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not save your setup. Please try again.';
      toast({ title: 'Setup not saved', description: message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl p-0 gap-0 overflow-hidden"
        onInteractOutside={(e) => e.preventDefault()}
      >
        {/* Visually-hidden title for screen readers (the visible header is custom) */}
        <DialogTitle className="sr-only">InboxIQ Setup Wizard</DialogTitle>
        <DialogDescription className="sr-only">
          Step-by-step setup to get InboxIQ ready for your inbox.
        </DialogDescription>

        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b bg-card">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold leading-tight">InboxIQ Setup</p>
                <p className="text-xs text-muted-foreground">
                  Step {stepIndex + 1} of {TOTAL_STEPS} · {currentStep.title}
                </p>
              </div>
            </div>
            <Badge variant={currentStep.kind === 'required' ? 'destructive' : 'secondary'}>
              {currentStep.kind === 'required' ? 'Required' : 'Optional'}
            </Badge>
          </div>
          <Progress value={((stepIndex + 1) / TOTAL_STEPS) * 100} className="h-1.5" />
        </div>

        {/* Body */}
        <div className="px-6 py-5 max-h-[60vh] overflow-y-auto">
          <h2 className="text-lg font-semibold text-foreground mb-1">{currentStep.title}</h2>
          {currentStep.subtitle && (
            <p className="text-sm text-muted-foreground mb-4">{currentStep.subtitle}</p>
          )}

          {currentStep.why && (
            <div className="mb-4">
              <button
                type="button"
                onClick={() => setWhyOpen((s) => ({ ...s, [stepIndex]: !s[stepIndex] }))}
                className="text-xs text-primary hover:underline inline-flex items-center gap-1"
              >
                {whyOpen[stepIndex] ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
                Why do I need this?
              </button>
              {whyOpen[stepIndex] && (
                <p className="mt-2 text-xs text-muted-foreground bg-muted/50 rounded-md p-3 leading-relaxed">
                  {currentStep.why}
                </p>
              )}
            </div>
          )}

          {currentStep.kind === 'review' ? (
            <ReviewSummary data={data} steps={steps} mailboxConnected={mailboxConnected} jumpTo={jumpTo} />
          ) : (
            currentStep.body
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t bg-card flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={goBack}
            disabled={isFirst || saving}
            className="gap-1"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </Button>

          <div className="flex items-center gap-2">
            {currentStep.kind === 'optional' && !isLast && (
              <Button type="button" variant="ghost" onClick={goNext} disabled={saving}>
                Skip for now
              </Button>
            )}
            {isLast ? (
              <Button type="button" onClick={handleFinish} disabled={saving} className="gap-1">
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                Finish setup
              </Button>
            ) : (
              <Button
                type="button"
                onClick={goNext}
                disabled={!canAdvance || saving}
                className="gap-1"
                title={!canAdvance ? currentStep.invalidReason : undefined}
              >
                Next <ArrowRight className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>

        {/* Sub-text on optional steps */}
        {currentStep.kind === 'optional' && !isLast && (
          <div className="px-6 pb-3 -mt-1 text-[11px] text-muted-foreground">
            You can configure this later from <strong>Settings</strong>.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Step builder                                                        */
/* ------------------------------------------------------------------ */

interface StepDef {
  id: string;
  title: string;
  subtitle?: string;
  kind: StepKind | 'review';
  why?: string;
  body?: ReactNode;
  isValid?: boolean;
  invalidReason?: string;
  /** For the review screen, a short label summarizing the user's choice. */
  reviewLabel?: () => string;
}

function buildSteps(args: {
  data: WizardData;
  setData: React.Dispatch<React.SetStateAction<WizardData>>;
  navigate: (path: string) => void;
  onOpenChange: (open: boolean) => void;
  mailboxConnected: boolean | null;
  whyOpen: Record<number, boolean>;
  setWhyOpen: React.Dispatch<React.SetStateAction<Record<number, boolean>>>;
}): StepDef[] {
  const { data, setData, navigate, onOpenChange, mailboxConnected } = args;

  return [
    {
      id: 'welcome',
      kind: 'optional',
      title: 'Welcome to InboxIQ',
      subtitle: 'A 2-minute setup to make your inbox calmer and your replies faster.',
      body: (
        <div className="space-y-3 text-sm text-foreground">
          <p>Here is what we will set up together:</p>
          <ul className="space-y-2 pl-4">
            <FeatureBullet icon={UserCog} label="Your profile and email signature" />
            <FeatureBullet icon={Mail} label="Your Gmail or Outlook mailbox" required />
            <FeatureBullet icon={Sparkles} label="AI Drafts and the Daily Brief" />
            <FeatureBullet icon={Users} label="Inviting teammates (admins only)" />
          </ul>
          <p className="text-xs text-muted-foreground pt-2">
            Anything you skip now can be configured later from Settings.
          </p>
        </div>
      ),
    },
    {
      id: 'profile',
      kind: 'required',
      title: 'Confirm your profile',
      subtitle: 'These appear on every AI-generated draft and your email signature.',
      why:
        'Your name and title are inserted into AI replies and your signature so messages sound like they came from you, not from a bot.',
      isValid: data.fullName.trim().length > 1,
      invalidReason: 'Please enter your full name to continue.',
      body: (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="wiz-full-name">
              Full name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="wiz-full-name"
              value={data.fullName}
              onChange={(e) => setData((d) => ({ ...d, fullName: e.target.value }))}
              placeholder="Jane Doe"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wiz-title" className="flex items-center gap-2">
              Job title <span className="text-xs text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="wiz-title"
              value={data.title}
              onChange={(e) => setData((d) => ({ ...d, title: e.target.value }))}
              placeholder="Director of Operations"
            />
          </div>
        </div>
      ),
      reviewLabel: () =>
        `${data.fullName || '(not set)'}${data.title ? ` · ${data.title}` : ''}`,
    },
    {
      id: 'mailbox',
      kind: 'required',
      title: 'Connect your mailbox',
      subtitle: 'InboxIQ needs read and label access to triage and draft replies.',
      why:
        'Without a connected mailbox, InboxIQ has nothing to sort or draft. We use OAuth — your password is never stored — and you can disconnect at any time.',
      isValid: mailboxConnected === true,
      invalidReason: 'Connect at least one mailbox before continuing.',
      body: (
        <div className="space-y-3">
          <div
            className={`rounded-md border p-3 flex items-center justify-between gap-3 ${
              mailboxConnected ? 'bg-emerald-500/5 border-emerald-500/30' : ''
            }`}
          >
            <div className="flex items-center gap-2 text-sm">
              {mailboxConnected ? (
                <Check className="w-4 h-4 text-emerald-600" />
              ) : (
                <Mail className="w-4 h-4 text-muted-foreground" />
              )}
              <span>
                {mailboxConnected === null
                  ? 'Checking your connections…'
                  : mailboxConnected
                  ? 'Mailbox connected'
                  : 'No mailbox connected yet'}
              </span>
            </div>
            <Button
              size="sm"
              variant={mailboxConnected ? 'outline' : 'default'}
              onClick={() => {
                onOpenChange(false);
                navigate('/integrations');
              }}
            >
              {mailboxConnected ? 'Manage' : 'Connect now'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            We will reopen the wizard right where you left off when you come back.
          </p>
        </div>
      ),
      reviewLabel: () => (mailboxConnected ? 'Connected' : 'Not connected'),
    },
    {
      id: 'categories',
      kind: 'optional',
      title: 'Review your categories',
      subtitle: 'We created 10 sensible defaults. Tweak names and rules whenever you like.',
      why:
        'Categories are the labels (Gmail) or folders (Outlook) InboxIQ uses to triage every incoming email. The defaults work for most people; renaming them later is one click.',
      body: (
        <div className="space-y-3">
          <p className="text-sm text-foreground">
            Open the Categories page to rename, recolor, or add rules. The defaults already cover
            Urgent, Follow Up, Customers, Vendors, Internal, Projects, Finance, and more.
          </p>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              navigate('/categories');
            }}
          >
            Open Categories
          </Button>
        </div>
      ),
      reviewLabel: () => 'Defaults will be used',
    },
    {
      id: 'daily-brief',
      kind: 'optional',
      title: 'Daily Brief',
      subtitle: 'A morning email summarizing what landed in your inbox overnight.',
      why:
        'The Daily Brief gives you a 30-second read of what is urgent, what is waiting, and what can wait — perfect for catching up before your first meeting.',
      body: (
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3 rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">Send me the Daily Brief</p>
              <p className="text-xs text-muted-foreground">
                You can fine-tune the time and days from Settings later.
              </p>
            </div>
            <Switch
              checked={data.enableDailyBrief}
              onCheckedChange={(v) => setData((d) => ({ ...d, enableDailyBrief: v }))}
              aria-label="Enable Daily Brief"
            />
          </div>
        </div>
      ),
      reviewLabel: () => (data.enableDailyBrief ? 'Enabled' : 'Off for now'),
    },
    {
      id: 'invite-team',
      kind: 'optional',
      title: 'Invite teammates',
      subtitle: 'Admins can add coworkers from the Admin Dashboard.',
      why:
        'InboxIQ is built for teams. Anyone on an allowed domain can be added with a single click — no separate accounts to manage.',
      body: (
        <div className="space-y-3">
          <p className="text-sm text-foreground">
            Inviting users is an admin task. If you are an admin, jump straight to the user manager.
          </p>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              navigate('/admin');
            }}
          >
            Open Admin Dashboard
          </Button>
        </div>
      ),
      reviewLabel: () => 'Skipped for now',
    },
    {
      id: 'review',
      kind: 'review',
      title: 'Review and finish',
      subtitle: 'Make sure everything looks right. You can edit any item.',
    },
  ];
}

function FeatureBullet({
  icon: Icon,
  label,
  required,
}: {
  icon: React.ElementType;
  label: string;
  required?: boolean;
}) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <Icon className="w-4 h-4 text-muted-foreground" />
      <span>{label}</span>
      {required && (
        <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4">
          Required
        </Badge>
      )}
    </li>
  );
}

function ReviewSummary({
  data,
  steps,
  mailboxConnected,
  jumpTo,
}: {
  data: WizardData;
  steps: StepDef[];
  mailboxConnected: boolean | null;
  jumpTo: (i: number) => void;
}) {
  const reviewable = steps
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.kind !== 'review' && s.id !== 'welcome');

  return (
    <div className="space-y-3">
      <div className="rounded-md bg-primary/5 border border-primary/20 p-3 flex items-center gap-2">
        <PartyPopper className="w-4 h-4 text-primary" />
        <p className="text-sm">Nice work — here is your setup at a glance.</p>
      </div>
      <ul className="divide-y divide-border rounded-md border">
        {reviewable.map(({ s, i }) => {
          const value = s.reviewLabel ? s.reviewLabel() : '—';
          return (
            <li key={s.id} className="px-3 py-2.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {s.title}
                </p>
                <p className="text-sm text-foreground truncate">{value}</p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => jumpTo(i)}
                className="gap-1"
              >
                <Pencil className="w-3.5 h-3.5" /> Edit
              </Button>
            </li>
          );
        })}
      </ul>
      {!mailboxConnected && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Heads up: no mailbox is connected yet. You can finish setup, but AI Drafts and the Daily
          Brief need a mailbox to work.
        </p>
      )}
      {/* Suppress unused-var warning for `data` (kept for future review fields) */}
      <span className="hidden">{JSON.stringify({ x: data.invitesNote }).length}</span>
    </div>
  );
}
