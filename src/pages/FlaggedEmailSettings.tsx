import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { PageHero } from '@/components/app/PageHero';
import { BellRing, Flag, Sparkles, Send, ShieldAlert, CheckCircle2, Wand2, Save, Loader2, Pencil, Trash2, Check } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { toast } from 'sonner';

type Tone = { style: string; format: string; instructions: string; example: string };
type Prefs = {
  enabled: boolean;
  autoReply: boolean;
  autoSend: boolean;
  tone: Tone;
};

const DEFAULTS: Prefs = {
  enabled: true,
  autoReply: false,
  autoSend: false,
  tone: { style: 'professional', format: 'concise', instructions: '', example: '' },
};

const WRITING_STYLES = [
  { value: 'professional', label: 'Professional & Polished' },
  { value: 'friendly', label: 'Friendly & Approachable' },
  { value: 'concierge', label: 'Concierge / White-Glove' },
  { value: 'direct', label: 'Direct & Efficient' },
  { value: 'empathetic', label: 'Empathetic & Supportive' },
];
const FORMAT_OPTIONS = [
  { value: 'concise', label: 'Concise (Short & Direct)' },
  { value: 'detailed', label: 'Detailed (Full Explanation)' },
  { value: 'bullet-points', label: 'Bullet Points' },
  { value: 'highlights', label: 'Key Highlights Only' },
];

const DEFAULT_TONE: Tone = { style: 'professional', format: 'concise', instructions: '', example: '' };
const isToneCustomized = (t: Tone) =>
  t.style !== DEFAULT_TONE.style || t.format !== DEFAULT_TONE.format ||
  (t.instructions || '').trim().length > 0 || (t.example || '').trim().length > 0;

export default function FlaggedEmailSettings() {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toneEditing, setToneEditing] = useState(false);
  const [toneSavedAt, setToneSavedAt] = useState<Date | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const { data } = await supabase
        .from('follow_up_settings' as any)
        .select('is_enabled, auto_draft_enabled, auto_reply_enabled, tone_settings, updated_at')
        .eq('user_id', user.id)
        .maybeSingle();
      const row: any = data || {};
      const tone = { ...DEFAULT_TONE, ...(row.tone_settings || {}) };
      setPrefs({
        enabled: row.is_enabled ?? true,
        autoReply: !!row.auto_draft_enabled,
        autoSend: !!row.auto_reply_enabled,
        tone,
      });
      const customized = isToneCustomized(tone);
      setToneEditing(!customized);
      if (customized && row.updated_at) setToneSavedAt(new Date(row.updated_at));
      setLoading(false);
    })();
  }, [user?.id]);

  const persist = async (next: Prefs) => {
    if (!user?.id) return;
    setSaving(true);
    const payload: any = {
      user_id: user.id,
      is_enabled: next.enabled,
      auto_draft_enabled: next.autoReply,
      auto_reply_enabled: next.autoSend,
      tone_settings: next.tone,
      reminder_max_count: 3,
    };
    const { data: existing } = await supabase
      .from('follow_up_settings' as any)
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (existing) {
      await supabase.from('follow_up_settings' as any).update(payload).eq('user_id', user.id);
    } else {
      await supabase.from('follow_up_settings' as any).insert(payload);
    }
    setSaving(false);
  };

  const update = (patch: Partial<Prefs>) => {
    const next = { ...prefs, ...patch };
    if (!next.autoReply) next.autoSend = false;
    if (!next.enabled) { next.autoReply = false; next.autoSend = false; }
    setPrefs(next);
    persist(next).then(() => toast.success('Preferences saved'));
  };

  const updateTone = (patch: Partial<Tone>) => {
    setPrefs(p => ({ ...p, tone: { ...p.tone, ...patch } }));
  };

  const saveTone = async () => {
    await persist(prefs);
    setToneSavedAt(new Date());
    setToneEditing(false);
    toast.success('AI tone saved', {
      description: `${styleLabel(prefs.tone.style)} · ${formatLabel(prefs.tone.format)}`,
    });
  };

  const deleteTone = async () => {
    const next = { ...prefs, tone: { ...DEFAULT_TONE } };
    setPrefs(next);
    await persist(next);
    setToneSavedAt(null);
    setToneEditing(true);
    toast.success('AI tone reset to defaults');
  };


  return (
    <div className="page-shell">
      <div className="page-shell-sticky">
        <PageHero
          eyebrow="AI Intelligence"
          title="Flagged Email Tracker"
          description="Turn the tracker on or off, decide whether AI should automatically draft or even send polite follow-ups, and tune the AI's writing tone."
          accent="purple"
          icon={<BellRing className="w-5 h-5 text-white" strokeWidth={2} />}
        />
      </div>

      <div className="page-shell-content w-full animate-fade-in space-y-6">
        {/* Controls */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tracker controls</CardTitle>
            <CardDescription>These settings only affect your account. Recipients never see flags — they're private to your mailbox.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <ToggleRow
              icon={<Sparkles className="w-4 h-4 text-purple-500" />}
              title="Enable Flagged Email Tracker"
              description="Scan your Outlook Sent Items for flagged messages and surface them in Flagged Email Reports."
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
              description="Send the AI-drafted follow-up automatically. Capped at 3 attempts (3 days apart). After the 3rd attempt the thread is marked Missed and automation stops."
              checked={prefs.autoSend}
              onCheckedChange={(v) => update({ autoSend: v })}
              disabled={!prefs.enabled || !prefs.autoReply}
            />

            {prefs.autoSend && (
              <Alert variant="destructive">
                <ShieldAlert className="h-4 w-4" />
                <AlertTitle>Auto-send is on</AlertTitle>
                <AlertDescription>
                  Follow-ups will be sent on your behalf from your connected Outlook account, up to 3 times. After 3 attempts the thread is closed as missed and no further automation runs.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* AI Tone */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Wand2 className="w-4 h-4 text-purple-500" /> AI tone for auto-replies</CardTitle>
            <CardDescription>Control exactly how the AI writes your follow-up emails — same controls as your category tones.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
            ) : (
              <>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm">Writing style</Label>
                    <Select value={prefs.tone.style} onValueChange={(v) => updateTone({ style: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {WRITING_STYLES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-sm">Format</Label>
                    <Select value={prefs.tone.format} onValueChange={(v) => updateTone({ format: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {FORMAT_OPTIONS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label className="text-sm">Custom instructions (optional)</Label>
                  <Textarea
                    rows={3}
                    placeholder="e.g. Always sign with my first name. Mention I'm based in Pacific Time. Keep under 80 words."
                    value={prefs.tone.instructions}
                    onChange={(e) => updateTone({ instructions: e.target.value })}
                  />
                </div>
                <div>
                  <Label className="text-sm">Example reply template (optional)</Label>
                  <Textarea
                    rows={4}
                    placeholder="Paste a sample follow-up you've written before — the AI will mirror its voice."
                    value={prefs.tone.example}
                    onChange={(e) => updateTone({ example: e.target.value })}
                  />
                </div>
                <div className="flex justify-end">
                  <Button onClick={saveTone} disabled={saving}>
                    {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                    Save tone
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* How it works */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">How to flag an email</CardTitle>
            <CardDescription>One zero-config gesture in Outlook.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            <div className="rounded-lg border p-4">
              <div className="flex items-center gap-2 font-medium mb-1"><Flag className="w-4 h-4 text-amber-500" /> Flag + due date</div>
              <ol className="list-decimal pl-5 text-muted-foreground space-y-1">
                <li>Send your email as usual.</li>
                <li>Open the message in <strong>Sent Items</strong>.</li>
                <li>Click the flag icon and pick <strong>Custom… → Due date</strong>.</li>
                <li>InboxIQ drafts a polite follow-up on that date if no reply has arrived.</li>
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
                'Polls your Outlook Sent Items every few minutes for flagged messages.',
                'Watches the conversation for a real reply (auto-replies and out-of-office are ignored).',
                'On the due date, drafts a short, polite follow-up in your tone — never pushy.',
                'Caps at 3 attempts per email, then marks it as Missed and stops automation.',
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
