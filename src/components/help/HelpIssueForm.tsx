import { useMemo, useRef, useState } from 'react';
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
import { Loader2, Send, CheckCircle2, Paperclip, X, ImageIcon, Mic, MicOff, Users } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useFeatureAccess, type FeatureKey } from '@/hooks/useFeatureAccess';

/**
 * Feature dropdown options. Each entry has a label and an optional
 * `requires` feature key — if the user doesn't have that feature, the
 * option is hidden from the dropdown. Entries with no `requires` are
 * always visible (Integrations is needed by everyone; "Other" is a
 * universal fallback).
 */
const FEATURE_OPTIONS: { label: string; requires?: FeatureKey }[] = [
  { label: 'AI Chat', requires: 'ai_chat' },
  { label: 'Email Intelligence', requires: 'email_intelligence' },
  { label: 'No Reply Tracker', requires: 'feature.follow_up_reminder' },
  { label: 'Meeting Copilot', requires: 'meeting_copilot' },
  { label: 'AI Activity Report', requires: 'reports' },
  { label: 'My Daily Brief', requires: 'daily_brief' },
  { label: 'My Profile & Signature' },
  { label: 'User Access' },
  { label: 'Integrations (Email & Calendar)' },
  { label: 'Other' },
];

export function HelpIssueForm() {
  const { user, profile } = useAuth();
  const location = useLocation();
  const { toast } = useToast();
  const { hasFeature } = useFeatureAccess();
  const isSuperAdmin = profile?.email?.toLowerCase() === 'arahimi@energyforward.com';

  const visibleOptions = useMemo(
    () =>
      FEATURE_OPTIONS.filter((o) => !o.requires || isSuperAdmin || hasFeature(o.requires)),
    [hasFeature, isSuperAdmin],
  );

  const [feature, setFeature] = useState<string>('');

  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [collaborators, setCollaborators] = useState('');
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  const MAX_FILES = 5;
  const MAX_BYTES = 10 * 1024 * 1024; // 10 MB each

  const toggleMic = () => {
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      toast({ title: 'Voice input not supported', description: 'Try Chrome, Edge, or Safari on desktop.', variant: 'destructive' });
      return;
    }
    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = navigator.language || 'en-US';
    rec.onresult = (e: any) => {
      let chunk = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) chunk += e.results[i][0].transcript;
      }
      if (chunk) setDescription((d) => (d ? d.trim() + ' ' : '') + chunk.trim());
    };
    rec.onerror = (e: any) => {
      toast({ title: 'Voice input error', description: e?.error || 'Mic permission denied.', variant: 'destructive' });
      setListening(false);
    };
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    rec.start();
    setListening(true);
  };


  const addFiles = (incoming: FileList | File[] | null) => {
    if (!incoming) return;
    const arr = Array.from(incoming);
    const accepted: File[] = [];
    for (const f of arr) {
      if (!f.type.startsWith('image/')) {
        toast({ title: 'Only images allowed', description: `${f.name} isn't an image.`, variant: 'destructive' });
        continue;
      }
      if (f.size > MAX_BYTES) {
        toast({ title: 'File too large', description: `${f.name} is over 10 MB.`, variant: 'destructive' });
        continue;
      }
      accepted.push(f);
    }
    setFiles((prev) => [...prev, ...accepted].slice(0, MAX_FILES));
  };

  const removeFile = (idx: number) => setFiles((prev) => prev.filter((_, i) => i !== idx));

  const submit = async () => {
    const s = subject.trim();
    const d = description.trim();
    if (!feature) {
      toast({
        title: 'Pick a feature',
        description: 'Tell us which feature your issue is about.',
        variant: 'destructive',
      });
      return;
    }
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
      // Upload screenshots first (if any) to support-attachments/{userId}/{issueTime}/
      let attachments: Array<{ path: string; name: string; size: number; type: string }> = [];
      if (files.length) {
        setUploading(true);
        const stamp = Date.now();
        for (const f of files) {
          const safe = f.name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);
          const path = `${user.id}/${stamp}-${Math.random().toString(36).slice(2, 8)}-${safe}`;
          const { error: upErr } = await supabase.storage
            .from('support-attachments')
            .upload(path, f, { contentType: f.type, upsert: false });
          if (upErr) throw upErr;
          attachments.push({ path, name: f.name, size: f.size, type: f.type });
        }
        setUploading(false);
      }

      const taggedSubject = `[${feature}] ${s}`.slice(0, 200);
      const taggedDescription = `Feature: ${feature}\n\n${d}`;
      const { data, error } = await supabase
        .from('support_issues')
        .insert({
          user_id: user.id,
          organization_id: profile.organization_id,
          user_email: profile.email || user.email || '',
          subject: taggedSubject,
          description: taggedDescription,
          page_url: `${location.pathname}${location.search}`,
          user_agent: navigator.userAgent,
          attachments,
        })
        .select('id')
        .single();

      if (error) throw error;

      setSubmittedId(data.id);
      setSubject('');
      setDescription('');
      setFeature('');
      setFiles([]);
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
      setUploading(false);
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
        <Label htmlFor="issue-feature" className="text-xs">
          Which feature is this about? <span className="text-destructive">*</span>
        </Label>
        <Select value={feature} onValueChange={(v) => setFeature(v)}>
          <SelectTrigger id="issue-feature">
            <SelectValue placeholder="Select a feature…" />
          </SelectTrigger>
          <SelectContent>
            {visibleOptions.map((f) => (
              <SelectItem key={f.label} value={f.label}>{f.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
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

      <div className="space-y-1.5">
        <Label className="text-xs flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5">
            <Paperclip className="h-3.5 w-3.5" /> Screenshots (optional)
          </span>
          <span className="text-[10px] font-normal text-muted-foreground">
            {files.length}/{MAX_FILES} · images up to 10 MB
          </span>
        </Label>

        <label
          htmlFor="issue-attachments"
          onDragOver={(e) => { e.preventDefault(); }}
          onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
          className="flex flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border bg-muted/20 px-3 py-4 text-xs text-muted-foreground cursor-pointer hover:bg-muted/40 transition"
        >
          <ImageIcon className="h-5 w-5" />
          <span><span className="font-medium text-foreground">Click to upload</span> or drag & drop</span>
          <span className="text-[10px]">PNG, JPG, GIF, WebP</span>
          <input
            id="issue-attachments"
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
            disabled={files.length >= MAX_FILES}
          />
        </label>

        {files.length > 0 && (
          <div className="grid grid-cols-3 gap-2 pt-1">
            {files.map((f, i) => {
              const url = URL.createObjectURL(f);
              return (
                <div key={i} className="relative group rounded-md overflow-hidden border border-border bg-background">
                  <img src={url} alt={f.name} className="w-full h-20 object-cover" onLoad={() => URL.revokeObjectURL(url)} />
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    className="absolute top-1 right-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                    aria-label={`Remove ${f.name}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                  <div className="px-1.5 py-1 text-[10px] text-muted-foreground truncate">{f.name}</div>
                </div>
              );
            })}
          </div>
        )}
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
        {uploading ? 'Uploading screenshots…' : submitting ? 'Submitting…' : 'Submit issue'}
      </Button>
    </div>
  );
}
