import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Bot, Mail, MessageSquare, RefreshCw, Send } from 'lucide-react';

interface AgentSettings {
  id?: string;
  organization_id: string;
  email_agent_enabled: boolean;
  teams_agent_enabled: boolean;
  shared_mailbox_address: string | null;
  shared_mailbox_user_id: string | null;
  teams_tenant_id: string | null;
  teams_bot_app_id: string | null;
  allowed_sender_domains: string[];
  graph_subscription_id: string | null;
  graph_subscription_expires_at: string | null;
}

interface AgentMessage {
  id: string;
  channel: string;
  direction: string;
  sender_email: string | null;
  subject: string | null;
  content: string | null;
  status: string;
  rejected_reason: string | null;
  created_at: string;
}

export default function AgentPanel({ organizationId }: { organizationId: string | null }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [settings, setSettings] = useState<AgentSettings | null>(null);
  const [savedSettings, setSavedSettings] = useState<AgentSettings | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [domainsInput, setDomainsInput] = useState('');

  async function loadSettings() {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke('agent-setup', {
      body: { action: 'get' },
    });
    if (!error && data?.settings) {
      setSettings(data.settings);
      setSavedSettings(data.settings);
      setDomainsInput((data.settings.allowed_sender_domains ?? []).join(', '));
    } else if (organizationId) {
      // Initialize empty
      setSettings({
        organization_id: organizationId,
        email_agent_enabled: false,
        teams_agent_enabled: false,
        shared_mailbox_address: null,
        shared_mailbox_user_id: null,
        teams_tenant_id: null,
        teams_bot_app_id: null,
        allowed_sender_domains: [],
        graph_subscription_id: null,
        graph_subscription_expires_at: null,
      });
      setSavedSettings(null);
    }
    setLoading(false);
  }

  async function loadMessages() {
    if (!organizationId) return;
    const { data } = await supabase
      .from('agent_messages')
      .select('id,channel,direction,sender_email,subject,content,status,rejected_reason,created_at')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .limit(20);
    setMessages(data ?? []);
  }

  useEffect(() => {
    if (organizationId) {
      loadSettings();
      loadMessages();
    }
  }, [organizationId]);

  async function handleSave() {
    if (!settings) return;
    setSaving(true);
    const domains = domainsInput
      .split(/[\s,]+/)
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);

    const { data, error } = await supabase.functions.invoke('agent-setup', {
      body: {
        action: 'save',
        email_agent_enabled: settings.email_agent_enabled,
        teams_agent_enabled: settings.teams_agent_enabled,
        shared_mailbox_address: settings.shared_mailbox_address,
        shared_mailbox_user_id: settings.shared_mailbox_user_id,
        teams_tenant_id: settings.teams_tenant_id,
        teams_bot_app_id: settings.teams_bot_app_id,
        allowed_sender_domains: domains,
      },
    });
    setSaving(false);
    if (error || data?.error) {
      toast({ title: 'Save failed', description: error?.message || data?.error, variant: 'destructive' });
      return;
    }
    setSettings(data.settings);
    setSavedSettings(data.settings);
    setDomainsInput((data.settings.allowed_sender_domains ?? []).join(', '));
    toast({ title: 'Settings saved' });
  }

  async function handleCreateSubscription() {
    if (!hasSavedSubscriptionFields) {
      toast({
        title: 'Save settings first',
        description: 'Enter the shared mailbox user ID and Microsoft tenant ID, then click Save settings before creating the webhook.',
        variant: 'destructive',
      });
      return;
    }

    if (hasUnsavedSubscriptionChanges) {
      toast({
        title: 'Unsaved changes',
        description: 'Your mailbox or tenant IDs changed locally. Click Save settings, then create the webhook.',
        variant: 'destructive',
      });
      return;
    }

    setCreating(true);
    const { data, error } = await supabase.functions.invoke('agent-setup', {
      body: { action: 'create_subscription' },
    });
    setCreating(false);
    if (error || data?.error) {
      toast({
        title: 'Subscription failed',
        description: error?.message || data?.error || JSON.stringify(data?.detail ?? {}),
        variant: 'destructive',
      });
      return;
    }
    toast({ title: 'Webhook subscription created', description: `Expires ${data.subscription?.expirationDateTime}` });
    loadSettings();
  }

  if (loading || !settings) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const subActive = settings.graph_subscription_id && settings.graph_subscription_expires_at &&
    new Date(settings.graph_subscription_expires_at) > new Date();

  const hasLocalSubscriptionFields = Boolean(
    settings.shared_mailbox_user_id?.trim() && settings.teams_tenant_id?.trim()
  );

  const hasSavedSubscriptionFields = Boolean(
    savedSettings?.shared_mailbox_user_id?.trim() && savedSettings?.teams_tenant_id?.trim()
  );

  const hasUnsavedSubscriptionChanges =
    (settings.shared_mailbox_user_id?.trim() ?? '') !== (savedSettings?.shared_mailbox_user_id?.trim() ?? '') ||
    (settings.teams_tenant_id?.trim() ?? '') !== (savedSettings?.teams_tenant_id?.trim() ?? '') ||
    (settings.shared_mailbox_address?.trim() ?? '') !== (savedSettings?.shared_mailbox_address?.trim() ?? '');

  const canCreateSubscription = hasSavedSubscriptionFields && !hasUnsavedSubscriptionChanges;

  return (
    <div className="space-y-6">
      {/* Email Agent */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5" /> Email Agent
          </CardTitle>
          <CardDescription>
            Anyone in your allowed domains can email the shared mailbox and the AI replies with full company context (rules, categories, recent emails).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <Label className="text-base">Enable Email Agent</Label>
              <p className="text-sm text-muted-foreground">AI auto-replies to emails sent to the shared mailbox</p>
            </div>
            <Switch
              checked={settings.email_agent_enabled}
              onCheckedChange={(v) => setSettings({ ...settings, email_agent_enabled: v })}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Shared mailbox address</Label>
              <Input
                placeholder="agent@energyforward.com"
                value={settings.shared_mailbox_address ?? ''}
                onChange={(e) => setSettings({ ...settings, shared_mailbox_address: e.target.value })}
              />
            </div>
            <div>
              <Label>Shared mailbox user ID (Azure AD object ID)</Label>
              <Input
                placeholder="GUID from Entra ID"
                value={settings.shared_mailbox_user_id ?? ''}
                onChange={(e) => setSettings({ ...settings, shared_mailbox_user_id: e.target.value })}
              />
            </div>
            <div>
              <Label>Microsoft tenant ID</Label>
              <Input
                placeholder="GUID"
                value={settings.teams_tenant_id ?? ''}
                onChange={(e) => setSettings({ ...settings, teams_tenant_id: e.target.value })}
              />
            </div>
            <div>
              <Label>Allowed sender domains (comma-separated)</Label>
              <Input
                placeholder="energyforward.com, partner.com"
                value={domainsInput}
                onChange={(e) => setDomainsInput(e.target.value)}
              />
            </div>
          </div>

          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <RefreshCw className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="font-medium text-sm">Microsoft Graph webhook</p>
                  <p className="text-xs text-muted-foreground">
                    {subActive ? (
                      <>Active — expires {new Date(settings.graph_subscription_expires_at!).toLocaleString()}</>
                    ) : (
                      'Not active — create one to start receiving emails'
                    )}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {subActive ? <Badge variant="secondary">Active</Badge> : <Badge variant="outline">Inactive</Badge>}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCreateSubscription}
                  disabled={creating || !canCreateSubscription}
                >
                  {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : (subActive ? 'Renew' : 'Create')}
                </Button>
              </div>
            </div>
            {!canCreateSubscription && (
              <p className="text-xs text-destructive">
                {!hasLocalSubscriptionFields
                  ? <><strong>Shared mailbox user ID</strong> and <strong>Microsoft tenant ID</strong> are required before you can create the webhook.</>
                  : !hasSavedSubscriptionFields || hasUnsavedSubscriptionChanges
                    ? <>Click <strong>Save settings</strong> to persist the mailbox details before creating the webhook.</>
                    : null}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Teams Agent */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5" /> Teams Agent
          </CardTitle>
          <CardDescription>
            Users @-mention the bot in Microsoft Teams to chat with the AI. Requires Azure Bot Service registration.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <Label className="text-base">Enable Teams Agent</Label>
              <p className="text-sm text-muted-foreground">AI responds to @mentions and DMs</p>
            </div>
            <Switch
              checked={settings.teams_agent_enabled}
              onCheckedChange={(v) => setSettings({ ...settings, teams_agent_enabled: v })}
            />
          </div>
          <div>
            <Label>Bot Framework App ID</Label>
            <Input
              placeholder="GUID from Azure Bot Service"
              value={settings.teams_bot_app_id ?? ''}
              onChange={(e) => setSettings({ ...settings, teams_bot_app_id: e.target.value })}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Set the bot's messaging endpoint to:{' '}
              <code className="bg-muted px-1 py-0.5 rounded text-[11px]">
                {import.meta.env.VITE_SUPABASE_URL}/functions/v1/teams-bot
              </code>
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
          Save settings
        </Button>
      </div>

      {/* Activity */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="w-5 h-5" /> Recent agent activity
          </CardTitle>
          <CardDescription>Last 20 inbound and outbound messages handled by the agent</CardDescription>
        </CardHeader>
        <CardContent>
          {messages.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No activity yet</p>
          ) : (
            <div className="space-y-2">
              {messages.map((m) => (
                <div key={m.id} className="flex items-start gap-3 rounded-lg border p-3 text-sm">
                  <div className="mt-0.5">
                    {m.direction === 'inbound' ? (
                      <Mail className="w-4 h-4 text-blue-500" />
                    ) : (
                      <Send className="w-4 h-4 text-green-500" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-[10px] uppercase">{m.channel}</Badge>
                      <Badge
                        variant={m.status === 'sent' || m.status === 'received' ? 'secondary' : 'destructive'}
                        className="text-[10px]"
                      >
                        {m.status}
                      </Badge>
                      {m.sender_email && <span className="text-xs text-muted-foreground">{m.sender_email}</span>}
                      <span className="text-xs text-muted-foreground ml-auto">
                        {new Date(m.created_at).toLocaleString()}
                      </span>
                    </div>
                    {m.subject && <p className="font-medium mt-1 truncate">{m.subject}</p>}
                    {m.content && (
                      <p className="text-muted-foreground line-clamp-2 mt-1">{m.content}</p>
                    )}
                    {m.rejected_reason && (
                      <p className="text-destructive text-xs mt-1">Rejected: {m.rejected_reason}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
