import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Loader2, Plus, Trash2, Send, BellRing, MessageSquare, Mail } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

type Recipient = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  email_enabled: boolean;
  sms_enabled: boolean;
  min_severity: 'warning' | 'failed';
  is_active: boolean;
};

type SmsConfig = {
  id: string;
  provider: 'twilio';
  from_number: string | null;
  account_sid_hint: string | null;
  enabled: boolean;
};

export default function AlertNotificationsPanel() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [smsCfg, setSmsCfg] = useState<SmsConfig | null>(null);
  const [draft, setDraft] = useState({ name: '', email: '', phone: '', email_enabled: true, sms_enabled: false, min_severity: 'failed' as 'warning' | 'failed' });
  const [testing, setTesting] = useState<'email' | 'sms' | 'both' | null>(null);

  const load = async () => {
    setLoading(true);
    const [{ data: rec }, { data: cfg }] = await Promise.all([
      supabase.from('alert_recipients').select('*').order('created_at', { ascending: true }),
      supabase.from('sms_provider_config').select('*').limit(1).maybeSingle(),
    ]);
    setRecipients((rec ?? []) as Recipient[]);
    setSmsCfg(cfg as SmsConfig | null);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const addRecipient = async () => {
    if (!draft.email && !draft.phone) {
      toast({ title: 'Add an email or phone', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('alert_recipients').insert({
      name: draft.name || null,
      email: draft.email || null,
      phone: draft.phone || null,
      email_enabled: draft.email_enabled,
      sms_enabled: draft.sms_enabled,
      min_severity: draft.min_severity,
    });
    setSaving(false);
    if (error) { toast({ title: 'Failed to add', description: error.message, variant: 'destructive' }); return; }
    setDraft({ name: '', email: '', phone: '', email_enabled: true, sms_enabled: false, min_severity: 'failed' });
    await load();
  };

  const updateRecipient = async (id: string, patch: Partial<Recipient>) => {
    const { error } = await supabase.from('alert_recipients').update(patch).eq('id', id);
    if (error) { toast({ title: 'Update failed', description: error.message, variant: 'destructive' }); return; }
    setRecipients((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const removeRecipient = async (id: string) => {
    const { error } = await supabase.from('alert_recipients').delete().eq('id', id);
    if (error) { toast({ title: 'Delete failed', description: error.message, variant: 'destructive' }); return; }
    setRecipients((rs) => rs.filter((r) => r.id !== id));
  };

  const saveSmsCfg = async (patch: Partial<SmsConfig>) => {
    if (!smsCfg) return;
    const { error } = await supabase.from('sms_provider_config').update(patch).eq('id', smsCfg.id);
    if (error) { toast({ title: 'Save failed', description: error.message, variant: 'destructive' }); return; }
    setSmsCfg({ ...smsCfg, ...patch });
  };

  const sendTest = async (r: Recipient, channel: 'email' | 'sms' | 'both') => {
    setTesting(channel);
    try {
      const { data, error } = await supabase.functions.invoke('admin-send-test-alert', {
        body: { email: r.email, phone: r.phone, channel },
      });
      if (error) throw error;
      const okEmail = data?.results?.email?.ok;
      const okSms = data?.results?.sms?.ok;
      toast({
        title: 'Test dispatched',
        description: [
          channel !== 'sms' && (okEmail ? 'Email: sent' : `Email: ${data?.results?.email?.message ?? 'skipped'}`),
          channel !== 'email' && (okSms ? 'SMS: sent' : `SMS: ${data?.results?.sms?.message ?? 'skipped'}`),
        ].filter(Boolean).join(' · '),
      });
    } catch (e: any) {
      toast({ title: 'Test failed', description: e?.message ?? String(e), variant: 'destructive' });
    } finally { setTesting(null); }
  };

  if (loading) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading alert settings…</div>;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><BellRing className="h-5 w-5" /> Alert recipients</CardTitle>
          <CardDescription>
            People who get notified when an integration health probe flips to <Badge variant="outline" className="border-amber-500 text-amber-600 mx-1">warning</Badge>
            or <Badge variant="outline" className="border-rose-500 text-rose-600 mx-1">failed</Badge>.
            Email uses the built-in transactional template; SMS uses Twilio (configure below).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {recipients.length === 0 && (
            <p className="text-sm text-muted-foreground">No recipients yet. Add one below.</p>
          )}
          {recipients.map((r) => (
            <div key={r.id} className="rounded-md border p-3 space-y-3">
              <div className="grid md:grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">Name</Label>
                  <Input value={r.name ?? ''} onChange={(e) => updateRecipient(r.id, { name: e.target.value })} placeholder="A. Rahimi" />
                </div>
                <div>
                  <Label className="text-xs flex items-center gap-1"><Mail className="h-3 w-3" /> Email</Label>
                  <Input value={r.email ?? ''} onChange={(e) => updateRecipient(r.id, { email: e.target.value })} placeholder="admin@company.com" />
                </div>
                <div>
                  <Label className="text-xs flex items-center gap-1"><MessageSquare className="h-3 w-3" /> Phone (E.164)</Label>
                  <Input value={r.phone ?? ''} onChange={(e) => updateRecipient(r.id, { phone: e.target.value })} placeholder="+14155551234" />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={r.email_enabled} onCheckedChange={(v) => updateRecipient(r.id, { email_enabled: v })} /> Email alerts
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={r.sms_enabled} onCheckedChange={(v) => updateRecipient(r.id, { sms_enabled: v })} /> SMS alerts
                </label>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Min severity:</span>
                  <Select value={r.min_severity} onValueChange={(v) => updateRecipient(r.id, { min_severity: v as any })}>
                    <SelectTrigger className="h-8 w-[140px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="warning">Warning &amp; up</SelectItem>
                      <SelectItem value="failed">Failed only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={r.is_active} onCheckedChange={(v) => updateRecipient(r.id, { is_active: v })} /> Active
                </label>
                <div className="ml-auto flex gap-2">
                  <Button variant="outline" size="sm" disabled={!r.email || !!testing} onClick={() => sendTest(r, 'email')}>
                    {testing === 'email' ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Send className="h-3 w-3 mr-1" />} Test email
                  </Button>
                  <Button variant="outline" size="sm" disabled={!r.phone || !smsCfg?.enabled || !!testing} onClick={() => sendTest(r, 'sms')}>
                    {testing === 'sms' ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Send className="h-3 w-3 mr-1" />} Test SMS
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => removeRecipient(r.id)} aria-label="Remove">
                    <Trash2 className="h-4 w-4 text-rose-500" />
                  </Button>
                </div>
              </div>
            </div>
          ))}

          <div className="rounded-md border border-dashed p-3 space-y-3">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Add recipient</div>
            <div className="grid md:grid-cols-3 gap-3">
              <Input placeholder="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              <Input placeholder="email@company.com" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
              <Input placeholder="+14155551234" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-sm"><Switch checked={draft.email_enabled} onCheckedChange={(v) => setDraft({ ...draft, email_enabled: v })} /> Email</label>
              <label className="flex items-center gap-2 text-sm"><Switch checked={draft.sms_enabled} onCheckedChange={(v) => setDraft({ ...draft, sms_enabled: v })} /> SMS</label>
              <Select value={draft.min_severity} onValueChange={(v) => setDraft({ ...draft, min_severity: v as any })}>
                <SelectTrigger className="h-9 w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="warning">Warning &amp; up</SelectItem>
                  <SelectItem value="failed">Failed only</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={addRecipient} disabled={saving} className="ml-auto">
                {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Plus className="h-3 w-3 mr-1" />} Add recipient
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><MessageSquare className="h-5 w-5" /> SMS provider (Twilio)</CardTitle>
          <CardDescription>
            Configure the SMS provider used for alerts. Secret credentials (Account SID, Auth Token, From number)
            are stored as project secrets — manage them under <strong>Integrations → Notifications → Twilio</strong>.
            This panel controls whether SMS dispatch is enabled and shows non-secret display values.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!smsCfg ? (
            <p className="text-sm text-muted-foreground">No SMS config row found.</p>
          ) : (
            <div className="space-y-3">
              <label className="flex items-center gap-3">
                <Switch checked={smsCfg.enabled} onCheckedChange={(v) => saveSmsCfg({ enabled: v })} />
                <span className="text-sm">SMS dispatch enabled{smsCfg.enabled ? '' : ' (off — no SMS will be sent)'}</span>
              </label>
              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">From number (display, E.164)</Label>
                  <Input
                    value={smsCfg.from_number ?? ''}
                    onChange={(e) => setSmsCfg({ ...smsCfg, from_number: e.target.value })}
                    onBlur={() => saveSmsCfg({ from_number: smsCfg.from_number })}
                    placeholder="+14155551234"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Cosmetic. Actual sending uses the <code className="text-[10px]">TWILIO_FROM_NUMBER</code> secret.
                  </p>
                </div>
                <div>
                  <Label className="text-xs">Account SID hint</Label>
                  <Input
                    value={smsCfg.account_sid_hint ?? ''}
                    onChange={(e) => setSmsCfg({ ...smsCfg, account_sid_hint: e.target.value })}
                    onBlur={() => saveSmsCfg({ account_sid_hint: smsCfg.account_sid_hint })}
                    placeholder="AC… (last 4)"
                  />
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
