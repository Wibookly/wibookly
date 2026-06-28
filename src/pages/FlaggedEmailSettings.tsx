import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { PageHero } from '@/components/app/PageHero';
import { BellRing, Flag, Sparkles, Send, ShieldAlert, CheckCircle2, Wand2, Save, Loader2, Pencil, Trash2, Check, AlarmClock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { toast } from 'sonner';

type Tone = { style: string; format: string; instructions: string; example: string };
type Prefs = {
  enabled: boolean;
  autoReply: boolean;
  autoSend: boolean;
  businessHoursOnly: boolean;
  businessHoursStart: number;
  businessHoursEnd: number;
  businessDays: number[];
  timezone: string;
  tone: Tone;
};

const DEFAULTS: Prefs = {
  enabled: true,
  autoReply: false,
  autoSend: false,
  businessHoursOnly: true,
  businessHoursStart: 8,
  businessHoursEnd: 17,
  businessDays: [1, 2, 3, 4, 5],
  timezone: '',
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
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function fmtHour(h: number): string {
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:00 ${ampm}`;
}

function browserTimezone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York'; }
  catch { return 'America/New_York'; }
}

const isToneCustomized = (t: Tone) =>
  t.style !== DEFAULT_TONE.style || t.format !== DEFAULT_TONE.format ||
  (t.instructions || '').trim().length > 0 || (t.example || '').trim().length > 0;
const styleLabel = (v: string) => WRITING_STYLES.find(s => s.value === v)?.label ?? v;
const formatLabel = (v: string) => FORMAT_OPTIONS.find(s => s.value === v)?.label ?? v;

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
        .select('is_enabled, auto_draft_enabled, auto_reply_enabled, tone_settings, updated_at, business_hours_only, business_hours_start, business_hours_end, business_days, timezone')
        .eq('user_id', user.id)
        .maybeSingle();
      const row: any = data || {};
      const tone = { ...DEFAULT_TONE, ...(row.tone_settings || {}) };
      setPrefs({
        enabled: row.is_enabled ?? true,
        autoReply: !!row.auto_draft_enabled,
        autoSend: !!row.auto_reply_enabled,
        businessHoursOnly: row.business_hours_only ?? true,
        businessHoursStart: row.business_hours_start ?? 8,
        businessHoursEnd: row.business_hours_end ?? 17,
        businessDays: Array.isArray(row.business_days) ? row.business_days : [1, 2, 3, 4, 5],
        timezone: row.timezone || browserTimezone(),
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
      business_hours_only: next.businessHoursOnly,
      business_hours_start: next.businessHoursStart,
      business_hours_end: next.businessHoursEnd,
      business_days: next.businessDays,
      timezone: next.timezone || browserTimezone(),
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

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlarmClock className="w-4 h-4 text-primary" /> Auto-send schedule
                  {prefs.businessHoursOnly ? <Badge variant="secondary">Business-hours guard on</Badge> : <Badge variant="outline">Anytime sending</Badge>}
                </CardTitle>
                <CardDescription>
                  Default is ON: auto-sent follow-ups wait for your work hours and skip weekends/off-days. Turn it OFF to send immediately when a due date arrives and no reply is found.
                </CardDescription>
              </div>
              <Switch
                checked={prefs.businessHoursOnly}
                disabled={!prefs.enabled || saving}
                onCheckedChange={(v) => update({ businessHoursOnly: v })}
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className={`grid md:grid-cols-3 gap-3 ${!prefs.businessHoursOnly ? 'opacity-60' : ''}`}>
              <div className="space-y-1.5">
                <Label>Start</Label>
                <select
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={prefs.businessHoursStart}
                  disabled={!prefs.enabled || !prefs.businessHoursOnly || saving}
                  onChange={(e) => update({ businessHoursStart: parseInt(e.target.value, 10) })}
                >
                  {Array.from({ length: 24 }, (_, h) => <option key={h} value={h} disabled={h >= prefs.businessHoursEnd}>{fmtHour(h)}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>End</Label>
                <select
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={prefs.businessHoursEnd}
                  disabled={!prefs.enabled || !prefs.businessHoursOnly || saving}
                  onChange={(e) => update({ businessHoursEnd: parseInt(e.target.value, 10) })}
                >
                  {Array.from({ length: 24 }, (_, h) => h + 1).map((h) => <option key={h} value={h} disabled={h <= prefs.businessHoursStart}>{h === 24 ? '12:00 AM (next day)' : fmtHour(h)}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Timezone</Label>
                <div className="flex gap-2">
                  <Input
                    value={prefs.timezone}
                    disabled={!prefs.enabled || !prefs.businessHoursOnly || saving}
                    placeholder="America/New_York"
                    onChange={(e) => setPrefs((p) => ({ ...p, timezone: e.target.value }))}
                    onBlur={() => update({ timezone: prefs.timezone || browserTimezone() })}
                  />
                  <Button variant="outline" size="sm" disabled={!prefs.enabled || !prefs.businessHoursOnly || saving} onClick={() => update({ timezone: browserTimezone() })}>Use mine</Button>
                </div>
              </div>
            </div>
            <div className={`${!prefs.businessHoursOnly ? 'opacity-60' : ''}`}>
              <Label>Business days</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {DAY_LABELS.map((label, idx) => {
                  const active = prefs.businessDays.includes(idx);
                  return (
                    <Button
                      key={label}
                      type="button"
                      size="sm"
                      variant={active ? 'default' : 'outline'}
                      disabled={!prefs.enabled || !prefs.businessHoursOnly || saving}
                      onClick={() => update({ businessDays: active ? prefs.businessDays.filter((d) => d !== idx) : [...prefs.businessDays, idx].sort() })}
                    >
                      {label}
                    </Button>
                  );
                })}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Current rule: {prefs.businessHoursOnly
                ? `queued follow-ups send during ${fmtHour(prefs.businessHoursStart)}–${prefs.businessHoursEnd === 24 ? '12:00 AM' : fmtHour(prefs.businessHoursEnd)}${prefs.timezone ? ` (${prefs.timezone})` : ''}; off-hours and weekends stay queued.`
                : 'auto-send runs immediately at the due date once no recipient reply is found.'}
            </p>
          </CardContent>
        </Card>

        {/* AI Tone — only relevant when tracker + auto-reply are on */}
        {prefs.enabled && (
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base flex items-center gap-2"><Wand2 className="w-4 h-4 text-purple-500" /> AI tone for auto-replies</CardTitle>
                  <CardDescription>Control exactly how the AI writes your follow-up emails — same controls as your category tones.</CardDescription>
                </div>
                {toneSavedAt && !toneEditing && (
                  <Badge variant="secondary" className="gap-1 shrink-0">
                    <Check className="w-3 h-3 text-emerald-500" /> Saved
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {loading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
              ) : !toneEditing ? (
                <div className="rounded-lg border p-4 space-y-3 bg-muted/30">
                  <div className="grid sm:grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">Writing style</div>
                      <div className="font-medium">{styleLabel(prefs.tone.style)}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">Format</div>
                      <div className="font-medium">{formatLabel(prefs.tone.format)}</div>
                    </div>
                  </div>
                  {prefs.tone.instructions?.trim() && (
                    <div className="text-sm">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Custom instructions</div>
                      <div className="whitespace-pre-wrap text-muted-foreground">{prefs.tone.instructions}</div>
                    </div>
                  )}
                  {prefs.tone.example?.trim() && (
                    <div className="text-sm">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Example reply</div>
                      <div className="whitespace-pre-wrap text-muted-foreground">{prefs.tone.example}</div>
                    </div>
                  )}
                  <div className="flex items-center justify-between pt-2 border-t">
                    <div className="text-xs text-muted-foreground">
                      {toneSavedAt ? `Saved ${toneSavedAt.toLocaleString()}` : 'Using defaults'}
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setToneEditing(true)}>
                        <Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit
                      </Button>
                      <Button variant="ghost" size="sm" onClick={deleteTone} className="text-destructive hover:text-destructive">
                        <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete
                      </Button>
                    </div>
                  </div>
                </div>
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
                  <div className="flex justify-end gap-2">
                    {toneSavedAt && (
                      <Button variant="outline" onClick={() => setToneEditing(false)} disabled={saving}>
                        Cancel
                      </Button>
                    )}
                    <Button onClick={saveTone} disabled={saving}>
                      {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                      Save tone
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}


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
