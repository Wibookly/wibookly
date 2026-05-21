import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Send, CheckCircle2 } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

const FEATURE_OPTIONS = [
  'AI Chat',
  'Email Intelligence',
  'No Reply Tracker',
  'My Profile & Signature',
  'Meeting Copilot',
  'AI Activity Report',
  'My Daily Brief',
  'User Access',
  'Integrations (Email & Calendar)',
  'Other',
] as const;
type FeatureOption = (typeof FEATURE_OPTIONS)[number];

export function HelpIssueForm() {
  const { user, profile } = useAuth();
  const location = useLocation();
  const { toast } = useToast();
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submittedId, setSubmittedId] = useState<string | null>(null);

  const submit = async () => {
    const s = subject.trim();
    const d = description.trim();
    if (!s || !d) {
      toast({
        title: 'Missing details',
        description: 'Please add a subject and a description.',
        variant: 'destructive',
      });
      return;
    }
    if (!user || !profile?.organization_id) {
      toast({
        title: 'Not signed in',
        description: 'Please sign in to submit an issue.',
        variant: 'destructive',
      });
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await supabase
        .from('support_issues')
        .insert({
          user_id: user.id,
          organization_id: profile.organization_id,
          user_email: profile.email || user.email || '',
          subject: s,
          description: d,
          page_url: `${location.pathname}${location.search}`,
          user_agent: navigator.userAgent,
        })
        .select('id')
        .single();

      if (error) throw error;

      setSubmittedId(data.id);
      setSubject('');
      setDescription('');
      toast({
        title: 'Issue submitted',
        description: 'Your admin team has been notified.',
      });
    } catch (err) {
      console.error('submit issue error', err);
      toast({
        title: 'Could not submit',
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (submittedId) {
    return (
      <div className="text-center py-8 space-y-4">
        <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-emerald-500/10 text-emerald-600">
          <CheckCircle2 className="h-6 w-6" />
        </div>
        <div>
          <p className="text-sm font-semibold">Thanks — your issue is in.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Your admin team can see it under <strong>/admin → Support Issues</strong>.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setSubmittedId(null)}
        >
          Submit another
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted-foreground">
          Stuck on something? Send your admin team a quick note and we'll include the page you're on.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="issue-subject" className="text-xs">Subject</Label>
        <Input
          id="issue-subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={200}
          placeholder="e.g. AI drafts not showing for the Customers category"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="issue-description" className="text-xs">What's happening?</Label>
        <Textarea
          id="issue-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={6}
          maxLength={4000}
          placeholder="Describe what you tried, what you expected, and what actually happened."
        />
        <p className="text-[10px] text-muted-foreground text-right">
          {description.length} / 4000
        </p>
      </div>
      <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground space-y-0.5">
        <p>
          <span className="font-medium text-foreground">Page:</span>{' '}
          {location.pathname}
        </p>
        <p>
          <span className="font-medium text-foreground">From:</span>{' '}
          {profile?.email || user?.email || 'unknown'}
        </p>
      </div>
      <Button
        type="button"
        onClick={submit}
        disabled={submitting}
        className="w-full"
      >
        {submitting ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <Send className="h-4 w-4 mr-2" />
        )}
        Submit issue
      </Button>
    </div>
  );
}
