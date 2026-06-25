import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { useFeatureAccess } from '@/hooks/useFeatureAccess';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Loader2, Plus, Trash2, Globe, Users, Shield, Settings, UserPlus, Ban, CheckCircle2, Key, Eye, EyeOff, KeyRound, ShieldCheck, ExternalLink, Building2 } from 'lucide-react';
import PermissionGroupsPanel, { type PermissionGroup } from '@/components/admin/PermissionGroupsPanel';
import BulkCreateUsersDialog from '@/components/admin/BulkCreateUsersDialog';
import UserGroupsAssignment from '@/components/admin/UserGroupsAssignment';
import OnboardingWizard from '@/components/admin/OnboardingWizard';
import DiscoveredUsersPanel from '@/components/admin/DiscoveredUsersPanel';
import AzurePermissionsCheck from '@/components/admin/AzurePermissionsCheck';
import AgentPanel from '@/components/admin/AgentPanel';
import CompanyLogoUploader from '@/components/admin/CompanyLogoUploader';
import FollowUpsPanel from '@/components/admin/FollowUpsPanel';
import SupportIssuesPanel from '@/components/admin/SupportIssuesPanel';
import PlansTab from '@/components/admin/PlansTab';
import AIUsageTab from '@/components/admin/AIUsageTab';
import ActivityReportTab from '@/components/admin/ActivityReportTab';
import RolesTab from '@/components/admin/RolesTab';
import { Bot, Clock, MessageSquareWarning, BellRing, Activity, BarChart3 } from 'lucide-react';

import { HelpDot } from '@/components/help/HelpDot';
import { PageHero } from '@/components/app/PageHero';
import { MicrosoftStatusPanel } from '@/components/integrations/MicrosoftStatusPanel';
import IntegrationsTab from '@/components/admin/integrations/IntegrationsTab';
import AlertNotificationsPanel from '@/components/admin/AlertNotificationsPanel';
import { ConnectionHealthPanel } from '@/components/follow-up/ConnectionHealthPanel';


const FEATURE_KEYS = [
  { key: 'ai_draft', label: 'AI Draft', description: 'AI-powered email draft generation' },
  { key: 'ai_auto_reply', label: 'AI Auto Reply', description: 'Automatic AI email replies' },
  { key: 'ai_assistant', label: 'AI Chat', description: 'AI chat assistant access' },
  { key: 'daily_brief', label: 'My Daily Brief', description: 'Daily Brief access and scheduling' },
  { key: 'reports', label: 'AI Activity Reports', description: 'AI activity reports & analytics' },
  { key: 'email_agent', label: 'Email Agent', description: 'AI replies to emails sent to the shared agent mailbox' },
  { key: 'teams_agent', label: 'Teams Agent', description: 'AI responds to @mentions and DMs in Microsoft Teams' },
  { key: 'feature.follow_up_reminder', label: 'Follow-Up Reminder', description: 'BCC-triggered Auto-Reminder feature: timer addresses, settings tab, and Pending Auto-Reminders view' },
] as const;

const AI_MODEL_KEYS = [
  { key: 'ai_model_chatgpt', label: 'ChatGPT', description: 'OpenAI ChatGPT model access' },
  { key: 'ai_model_claude', label: 'Claude', description: 'Anthropic Claude model access' },
] as const;

interface AllowedDomain {
  id: string;
  domain: string;
  organization_name: string | null;
  is_active: boolean;
  max_users: number;
  created_at: string;
  microsoft_tenant_id: string | null;
  microsoft_consent_granted: boolean;
  microsoft_consent_granted_at: string | null;
}

const MICROSOFT_ADMIN_CONSENT_CALLBACK = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/microsoft-admin-consent-callback`;
const MICROSOFT_REQUIRED_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'https://graph.microsoft.com/User.Read',
  'https://graph.microsoft.com/Mail.Read',
  'https://graph.microsoft.com/Mail.ReadWrite',
  'https://graph.microsoft.com/Mail.Send',
  'https://graph.microsoft.com/Calendars.ReadWrite',
].join(' ');

interface UserFeature {
  user_id: string;
  feature_key: string;
  is_enabled: boolean;
}

interface ManagedUser {
  id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  created_at: string;
  organization_id: string;
  domain_id?: string | null;
  is_disabled: boolean;
  features: UserFeature[];
  group_ids?: string[];
}

export default function AdminDashboard() {
  const { profile, session } = useAuth();
  const { hasFeature } = useFeatureAccess();
  const hasFollowUpReminder = hasFeature('feature.follow_up_reminder');
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<string>('setup');
  const [domains, setDomains] = useState<AllowedDomain[]>([]);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [groups, setGroups] = useState<PermissionGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [newDomain, setNewDomain] = useState('');
  const [newOrgName, setNewOrgName] = useState('');
  const [addingDomain, setAddingDomain] = useState(false);

  // API Keys state
  const [apiKeys, setApiKeys] = useState<{ key_name: string; updated_at: string; value?: string }[]>([]);
  const [openaiKey, setOpenaiKey] = useState('');
  const [claudeKey, setClaudeKey] = useState('');
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [showOpenaiKey, setShowOpenaiKey] = useState(false);
  const [showClaudeKey, setShowClaudeKey] = useState(false);
  // AI provider preference (Auto = OpenAI primary, Claude fallback)
  const [providerPref, setProviderPref] = useState<'auto' | 'openai' | 'claude'>('auto');
  const [openaiModel, setOpenaiModel] = useState<string>('gpt-4o-mini');
  const [claudeModel, setClaudeModel] = useState<string>('claude-3-5-sonnet-latest');
  const [enableWebSearch, setEnableWebSearch] = useState<boolean>(true);
  const [savingPref, setSavingPref] = useState(false);
  const [microsoftClientId, setMicrosoftClientId] = useState<string | null>(null);
  const [autoSyncDomainId, setAutoSyncDomainId] = useState<string | null>(null);
  const [autoSyncNonce, setAutoSyncNonce] = useState(0);
  const [autoCheckNonce, setAutoCheckNonce] = useState(0);

  // New user form
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [creatingUser, setCreatingUser] = useState(false);

  // Reset password state
  const [resetPasswordUserId, setResetPasswordUserId] = useState<string | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('');
  const [resettingPassword, setResettingPassword] = useState(false);

  const isSuperAdmin = profile?.email?.toLowerCase() === 'arahimi@energyforward.com';

  useEffect(() => {
    if (isSuperAdmin) {
      fetchData();
    }
  }, [isSuperAdmin]);

  useEffect(() => {
    if (!isSuperAdmin) return;

    void adminInvoke('get_microsoft_oauth_config')
      .then((res) => setMicrosoftClientId(res?.client_id || null))
      .catch(() => setMicrosoftClientId(null));
  }, [isSuperAdmin, session?.access_token]);

  // Detect Microsoft admin consent result after the backend callback redirects back here.
  useEffect(() => {
    if (loading) return;
    if (!isSuperAdmin) return;

    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    const consentStatus = params.get('ms_consent');
    const message = params.get('message');
    const domainId = params.get('domain_id');
    const shouldSync = params.get('auto_sync') === '1';
    const shouldRunCheck = params.get('run_check') === '1';

    if (tab === 'discovered') {
      setActiveTab('discovered');
    }

    if (consentStatus === 'success') {
      toast({
        title: 'Microsoft consent granted',
        description: message || 'Tenant authorization recorded.',
      });
      fetchData();
      if (tab === 'discovered' && domainId) {
        setAutoSyncDomainId(domainId);
      }
      if (tab === 'discovered' && shouldSync) {
        setAutoSyncNonce((value) => value + 1);
      }
      if (tab === 'discovered' && shouldRunCheck) {
        setAutoCheckNonce((value) => value + 1);
      }
      const nextUrl = tab === 'discovered' ? `${window.location.pathname}?tab=discovered` : window.location.pathname;
      window.history.replaceState({}, '', nextUrl);
    } else if (consentStatus === 'error') {
      toast({
        title: 'Microsoft consent failed',
        description: message || 'Unknown error',
        variant: 'destructive',
      });
      const nextUrl = tab === 'discovered' ? `${window.location.pathname}?tab=discovered` : window.location.pathname;
      window.history.replaceState({}, '', nextUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperAdmin, loading]);

  // Receive consent result from the popup window (renders an HTML page that
  // postMessages the result and self-closes).
  useEffect(() => {
    if (!isSuperAdmin) return;

    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; status?: string; message?: string; domainId?: string | null } | null;
      if (!data || data.type !== 'ms-admin-consent-result') return;

      if (data.status === 'success') {
        toast({
          title: 'Microsoft consent granted',
          description: data.message || 'Tenant authorization recorded.',
        });
        setActiveTab('discovered');
        fetchData();
        if (data.domainId) {
          setAutoSyncDomainId(data.domainId);
          setAutoSyncNonce((v) => v + 1);
        }
        setAutoCheckNonce((v) => v + 1);
      } else {
        toast({
          title: 'Microsoft consent failed',
          description: data.message || 'Unknown error',
          variant: 'destructive',
        });
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperAdmin]);

  const adminInvoke = async (action: string, payload: Record<string, any> = {}) => {
    const { data, error } = await supabase.functions.invoke('admin-api', {
      body: { action, ...payload },
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    return data;
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [domainsRes, usersRes, keysRes, groupsRes] = await Promise.all([
        supabase.from('allowed_domains').select('*').order('created_at', { ascending: false }),
        adminInvoke('list_users'),
        adminInvoke('get_api_keys'),
        adminInvoke('list_groups'),
      ]);

      if (domainsRes.data) setDomains(domainsRes.data as AllowedDomain[]);
      if (usersRes?.users) setUsers(usersRes.users);
      if (keysRes?.keys) { setApiKeys(keysRes.keys); hydrateAIPrefs(keysRes.keys); }
      if (groupsRes?.groups) setGroups(groupsRes.groups);
    } catch (error: any) {
      console.error('Error fetching admin data:', error);
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const refreshGroups = async () => {
    try {
      const groupsRes = await adminInvoke('list_groups');
      if (groupsRes?.groups) setGroups(groupsRes.groups);
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const handleAddDomain = async () => {
    if (!newDomain.trim()) return;
    const domain = newDomain.trim().toLowerCase();
    if (!/^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,}$/.test(domain)) {
      toast({ title: 'Invalid domain', description: 'Please enter a valid domain (e.g., company.com)', variant: 'destructive' });
      return;
    }
    setAddingDomain(true);
    try {
      const { error } = await supabase.from('allowed_domains').insert({
        domain, organization_name: newOrgName.trim() || null, is_active: true,
      });
      if (error) {
        if (error.code === '23505') toast({ title: 'Domain exists', description: 'This domain is already in the list.', variant: 'destructive' });
        else throw error;
      } else {
        toast({ title: 'Domain added', description: `${domain} has been authorized.` });
        setNewDomain('');
        setNewOrgName('');
        fetchData();
      }
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setAddingDomain(false);
    }
  };

  const handleToggleDomain = async (id: string, isActive: boolean) => {
    try {
      const { error } = await supabase.from('allowed_domains').update({ is_active: !isActive }).eq('id', id);
      if (error) throw error;
      fetchData();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const handleDeleteDomain = async (id: string, domain: string) => {
    try {
      const { error } = await supabase.from('allowed_domains').delete().eq('id', id);
      if (error) throw error;
      fetchData();
      toast({ title: 'Domain removed', description: `${domain} has been removed.` });
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const buildAdminConsentUrl = (domain: AllowedDomain) => {
    // Prefer the verified tenant id once we have it; otherwise let Microsoft
    // resolve the tenant from the signing-in admin via the "organizations"
    // endpoint. Passing the raw typed domain (which may be misspelled or not
    // yet verified in Azure) caused a white error page from login.microsoftonline.com.
    const tenant = domain.microsoft_tenant_id?.trim() || 'organizations';
    const state = btoa(JSON.stringify({
      domainId: domain.id,
      appOrigin: window.location.origin,
    }));

    if (!microsoftClientId) {
      throw new Error('Microsoft app configuration is missing.');
    }

    const params = new URLSearchParams({
      client_id: microsoftClientId,
      redirect_uri: MICROSOFT_ADMIN_CONSENT_CALLBACK,
      scope: MICROSOFT_REQUIRED_SCOPES,
      state,
    });
    return `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/v2.0/adminconsent?${params.toString()}`;
  };

  const handleGrantMicrosoftConsent = (domain: AllowedDomain) => {
    let url = '';
    try {
      url = buildAdminConsentUrl(domain);
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return;
    }
    // Open in a popup so the admin keeps their dashboard session.
    const popup = window.open(url, 'ms-admin-consent', 'width=600,height=720');
    if (!popup) {
      window.location.assign(url);
    }
  };

  const handleSetTenantId = async (id: string, tenantId: string) => {
    try {
      const { error } = await supabase
        .from('allowed_domains')
        .update({ microsoft_tenant_id: tenantId.trim() || null })
        .eq('id', id);
      if (error) throw error;
      fetchData();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const handleCreateUser = async () => {
    if (!newUserEmail || !newUserName || !newUserPassword) {
      toast({ title: 'Missing fields', description: 'All fields are required.', variant: 'destructive' });
      return;
    }
    if (newUserPassword.length < 8) {
      toast({ title: 'Weak password', description: 'Password must be at least 8 characters.', variant: 'destructive' });
      return;
    }
    setCreatingUser(true);
    try {
      await adminInvoke('create_user', {
        email: newUserEmail.trim().toLowerCase(),
        full_name: newUserName.trim(),
        password: newUserPassword,
      });
      toast({ title: 'User created', description: `${newUserEmail} has been created.` });
      setNewUserEmail('');
      setNewUserName('');
      setNewUserPassword('');
      fetchData();
    } catch (error: any) {
      toast({ title: 'Error creating user', description: error.message, variant: 'destructive' });
    } finally {
      setCreatingUser(false);
    }
  };

  const handleToggleUser = async (userId: string, isDisabled: boolean) => {
    try {
      await adminInvoke(isDisabled ? 'enable_user' : 'disable_user', { user_id: userId });
      toast({ title: isDisabled ? 'User enabled' : 'User disabled' });
      fetchData();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const handleDeleteUser = async (userId: string) => {
    try {
      await adminInvoke('delete_user', { user_id: userId });
      toast({ title: 'User deleted' });
      fetchData();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const handleResetPassword = async () => {
    if (!resetPasswordUserId || !resetPasswordValue) return;
    if (resetPasswordValue.length < 6) {
      toast({ title: 'Weak password', description: 'Password must be at least 6 characters.', variant: 'destructive' });
      return;
    }
    setResettingPassword(true);
    try {
      await adminInvoke('reset_password', { user_id: resetPasswordUserId, new_password: resetPasswordValue });
      toast({ title: 'Password updated', description: 'The user\'s password has been reset.' });
      setResetPasswordUserId(null);
      setResetPasswordValue('');
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setResettingPassword(false);
    }
  };

  const handleToggleFeature = async (userId: string, featureKey: string, currentlyEnabled: boolean) => {
    try {
      await adminInvoke('set_feature', {
        user_id: userId,
        feature_key: featureKey,
        is_enabled: !currentlyEnabled,
      });
      // Optimistic update
      setUsers(prev => prev.map(u => {
        if (u.user_id !== userId) return u;
        const existing = u.features.find(f => f.feature_key === featureKey);
        if (existing) {
          return { ...u, features: u.features.map(f => f.feature_key === featureKey ? { ...f, is_enabled: !currentlyEnabled } : f) };
        }
        return { ...u, features: [...u.features, { user_id: userId, feature_key: featureKey, is_enabled: !currentlyEnabled }] };
      }));
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      fetchData(); // Revert on error
    }
  };

  const handleSaveApiKey = async (keyName: string, keyValue: string) => {
    if (!keyValue.trim()) {
      toast({ title: 'Empty key', description: 'Please enter an API key value.', variant: 'destructive' });
      return;
    }
    setSavingKey(keyName);
    try {
      await adminInvoke('set_api_key', { key_name: keyName, key_value: keyValue.trim() });
      toast({ title: 'API Key saved', description: `${keyName === 'openai_api_key' ? 'OpenAI' : 'Claude'} API key has been saved.` });
      if (keyName === 'openai_api_key') setOpenaiKey('');
      else setClaudeKey('');
      setShowOpenaiKey(false);
      setShowClaudeKey(false);
      const keysRes = await adminInvoke('get_api_keys');
      if (keysRes?.keys) { setApiKeys(keysRes.keys); hydrateAIPrefs(keysRes.keys); }
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setSavingKey(null);
    }
  };

  const handleDeleteApiKey = async (keyName: string) => {
    try {
      await adminInvoke('delete_api_key', { key_name: keyName });
      toast({ title: 'API Key removed', description: `${keyName === 'openai_api_key' ? 'OpenAI' : 'Claude'} API key has been removed.` });
      const keysRes = await adminInvoke('get_api_keys');
      if (keysRes?.keys) { setApiKeys(keysRes.keys); hydrateAIPrefs(keysRes.keys); }
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const isKeyConfigured = (keyName: string) => apiKeys.some(k => k.key_name === keyName);
  const getKeyUpdatedAt = (keyName: string) => apiKeys.find(k => k.key_name === keyName)?.updated_at;

  // Hydrate non-secret AI preference rows from the get_api_keys response
  const hydrateAIPrefs = (rows: { key_name: string; value?: string }[]) => {
    const get = (k: string) => rows.find(r => r.key_name === k)?.value;
    const pref = (get('ai_provider_preference') || 'auto').toLowerCase();
    if (pref === 'auto' || pref === 'openai' || pref === 'claude') setProviderPref(pref as any);
    const om = get('ai_openai_model'); if (om) setOpenaiModel(om);
    const cm = get('ai_claude_model'); if (cm) setClaudeModel(cm);
    const ws = get('ai_enable_web_search'); if (ws !== undefined) setEnableWebSearch(ws !== 'false');
  };

  const handleSaveAIPrefs = async () => {
    setSavingPref(true);
    try {
      await Promise.all([
        adminInvoke('set_api_key', { key_name: 'ai_provider_preference', key_value: providerPref }),
        adminInvoke('set_api_key', { key_name: 'ai_openai_model', key_value: openaiModel }),
        adminInvoke('set_api_key', { key_name: 'ai_claude_model', key_value: claudeModel }),
        adminInvoke('set_api_key', { key_name: 'ai_enable_web_search', key_value: enableWebSearch ? 'true' : 'false' }),
      ]);
      toast({ title: 'AI preferences saved' });
      const keysRes = await adminInvoke('get_api_keys');
      if (keysRes?.keys) { setApiKeys(keysRes.keys); hydrateAIPrefs(keysRes.keys); }
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setSavingPref(false);
    }
  };

  const getUserFeatureState = (user: ManagedUser, featureKey: string) => {
    const directFeature = user.features.find((feature) => feature.feature_key === featureKey);
    if (directFeature?.is_enabled) {
      return { enabled: true, source: 'direct' as const };
    }

    for (const groupId of user.group_ids || []) {
      const group = groups.find((item) => item.id === groupId);
      if (!group) continue;

      const override = group.overrides?.find(
        (item) => item.domain_id === user.domain_id && item.feature_key === featureKey,
      );

      if (override) {
        if (override.is_enabled) {
          return { enabled: true, source: 'group' as const };
        }
        continue;
      }

      const groupFeature = group.features.find(
        (item) => item.feature_key === featureKey && item.is_enabled,
      );

      if (groupFeature) {
        return { enabled: true, source: 'group' as const };
      }
    }

    return { enabled: false, source: 'none' as const };
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isSuperAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-destructive" />
              Access Denied
            </CardTitle>
            <CardDescription>You do not have administrator privileges.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="page-shell space-y-6">
      <div className="page-shell-sticky">
        <PageHero
          eyebrow="Administration"
          title="Admin Dashboard"
          description="Manage users, authorized domains, and feature access for your organization."
          accent="pink"
          icon={<ShieldCheck className="w-5 h-5 text-white" strokeWidth={2} />}
        />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { icon: Users, value: users.length, label: 'Total Users' },
          { icon: Globe, value: domains.length, label: 'Authorized Domains' },
          { icon: CheckCircle2, value: users.filter(u => !u.is_disabled).length, label: 'Active Users' },
        ].map(({ icon: Icon, value, label }) => (
          <div
            key={label}
            className="bg-card border border-border rounded-xl p-5 flex items-center gap-4 hover:-translate-y-0.5 hover:border-ef-sky-soft transition-all"
          >
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-ef-blue/[0.14] to-ef-sky/[0.08] grid place-items-center text-ef-blue dark:text-ef-sky flex-shrink-0">
              <Icon className="w-5 h-5" />
            </div>
            <div>
              <p className="font-display text-3xl text-foreground tracking-tight leading-none">{value}</p>
              <p className="text-xs text-muted-foreground mt-1 tracking-wide">{label}</p>
            </div>
          </div>
        ))}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="setup" className="gap-2"><UserPlus className="w-4 h-4" /> Setup Wizard</TabsTrigger>
          <TabsTrigger value="discovered" className="gap-2"><Building2 className="w-4 h-4" /> M365 Users</TabsTrigger>
          <TabsTrigger value="integrations" className="gap-2"><Activity className="w-4 h-4" /> Integrations</TabsTrigger>
          <TabsTrigger value="alerts" className="gap-2"><BellRing className="w-4 h-4" /> Alerts</TabsTrigger>
          <TabsTrigger value="groups" className="gap-2"><ShieldCheck className="w-4 h-4" /> Plans</TabsTrigger>
          <TabsTrigger value="activity" className="gap-2"><BarChart3 className="w-4 h-4" /> Activity</TabsTrigger>
          <TabsTrigger value="roles" className="gap-2"><ShieldCheck className="w-4 h-4" /> Roles</TabsTrigger>
          <TabsTrigger value="ai-usage" className="gap-2"><Activity className="w-4 h-4" /> AI Usage</TabsTrigger>
          <TabsTrigger value="issues" className="gap-2"><MessageSquareWarning className="w-4 h-4" /> Support Issues</TabsTrigger>
          <TabsTrigger value="settings" className="gap-2"><Settings className="w-4 h-4" /> Settings</TabsTrigger>

        </TabsList>

        <TabsContent value="issues" className="space-y-6">
          <SupportIssuesPanel />
        </TabsContent>

        <TabsContent value="setup" className="space-y-6">
          <OnboardingWizard
            invoke={adminInvoke}
            existingGroups={groups}
            organizationId={profile?.organization_id ?? null}
            onCompleted={fetchData}
            onNavigateToTab={setActiveTab}
          />
        </TabsContent>

        <TabsContent value="discovered" className="space-y-6">
          <DiscoveredUsersPanel
            invoke={adminInvoke}
            domains={domains as any}
            initialDomainId={autoSyncDomainId}
            autoSyncNonce={autoSyncNonce}
          />
          <AzurePermissionsCheck invoke={adminInvoke} autoRunNonce={autoCheckNonce} />
        </TabsContent>

        <TabsContent value="integrations" className="space-y-6">
          <IntegrationsTab
            adminInvoke={adminInvoke}
            organizationId={profile?.organization_id ?? null}
          />
          <ConnectionHealthPanel />
        </TabsContent>


        <TabsContent value="alerts" className="space-y-6">
          <AlertNotificationsPanel />
        </TabsContent>

        <TabsContent value="groups" className="space-y-6">
          <PlansTab />
        </TabsContent>

        <TabsContent value="activity" className="space-y-6">
          <ActivityReportTab />
        </TabsContent>

        <TabsContent value="roles" className="space-y-6">
          <RolesTab />
        </TabsContent>

        <TabsContent value="ai-usage" className="space-y-6">
          <AIUsageTab organizationId={profile?.organization_id ?? null} />
        </TabsContent>


        {/* SETTINGS TAB — contains nested sections */}
        <TabsContent value="settings" className="space-y-6">
          <Tabs defaultValue="domains" className="w-full">
            <TabsList className="flex-wrap h-auto">
              <TabsTrigger value="domains" className="gap-2"><Globe className="w-4 h-4" /> Domains</TabsTrigger>
              <TabsTrigger value="ai-agent" className="gap-2"><Bot className="w-4 h-4" /> AI Agent</TabsTrigger>
              <TabsTrigger value="no-reply" className="gap-2"><BellRing className="w-4 h-4" /> No Reply Tracker</TabsTrigger>
              <TabsTrigger value="api-keys" className="gap-2"><Key className="w-4 h-4" /> AI APIs</TabsTrigger>
              <TabsTrigger value="general" className="gap-2"><Settings className="w-4 h-4" /> General</TabsTrigger>
            </TabsList>

            <TabsContent value="domains" className="space-y-6 mt-4">
          <Card className="border-primary/30 bg-primary/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="w-5 h-5 text-primary" />
                How tenant authorization works
              </CardTitle>
              <CardDescription className="text-foreground/80">
                When you add a customer's domain below, their <strong>Microsoft Global Admin</strong> can self-authorize
                InboxIQ for their entire tenant in one click — no work needed on their Azure portal. The flow:
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                <li>You add their domain here (e.g., <span className="font-mono">customer.com</span>).</li>
                <li>You share the <strong>Grant Microsoft Consent</strong> link with their Global Admin (or they click it themselves after signing in).</li>
                <li>They sign in to Microsoft with their Global Admin account and click <strong>Accept</strong> on Microsoft's consent screen.</li>
                <li>InboxIQ is automatically registered as an Enterprise Application in their tenant. All users from that domain can now sign in and connect their mailbox without seeing the "Need admin approval" message.</li>
              </ol>
              <p className="text-xs text-muted-foreground pt-2 border-t border-border/50">
                <strong>One-time prerequisite (already configured):</strong> The InboxIQ Azure app must declare the
                Microsoft Graph delegated permissions (<span className="font-mono">Mail.ReadWrite</span>, <span className="font-mono">Mail.Send</span>, <span className="font-mono">Calendars.ReadWrite</span>, <span className="font-mono">User.Read</span>, <span className="font-mono">offline_access</span>) and be set to <strong>multi-tenant</strong>. After that, every customer is fully self-serve.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Add Authorized Domain</CardTitle>
              <CardDescription>Allow users from a specific email domain to be added to the platform</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1 space-y-1">
                  <Label htmlFor="domain">Domain</Label>
                  <Input id="domain" placeholder="company.com" value={newDomain} onChange={e => setNewDomain(e.target.value)} />
                </div>
                <div className="flex-1 space-y-1">
                  <Label htmlFor="orgName">Organization Name (optional)</Label>
                  <Input id="orgName" placeholder="Company Inc." value={newOrgName} onChange={e => setNewOrgName(e.target.value)} />
                </div>
                <div className="flex items-end">
                  <Button onClick={handleAddDomain} disabled={addingDomain || !newDomain.trim()}>
                    {addingDomain ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                    Add Domain
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Authorized Domains</CardTitle>
            </CardHeader>
            <CardContent>
              {domains.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No domains configured yet</p>
              ) : (
                <div className="space-y-3">
                  {domains.map(domain => (
                    <div key={domain.id} className="p-4 rounded-lg border border-border bg-background space-y-3">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-3">
                          <Globe className="w-5 h-5 text-muted-foreground" />
                          <div>
                            <p className="font-medium text-foreground">{domain.domain}</p>
                            {domain.organization_name && <p className="text-sm text-muted-foreground">{domain.organization_name}</p>}
                          </div>
                          <Badge variant={domain.is_active ? 'default' : 'secondary'}>{domain.is_active ? 'Active' : 'Disabled'}</Badge>
                          {domain.microsoft_consent_granted && (
                            <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 gap-1">
                              <ShieldCheck className="w-3 h-3" /> MS Consent
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Button variant="outline" size="sm" onClick={() => handleToggleDomain(domain.id, domain.is_active)}>
                            {domain.is_active ? 'Disable' : 'Enable'}
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive"><Trash2 className="w-4 h-4" /></Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Remove domain?</AlertDialogTitle>
                                <AlertDialogDescription>Users from {domain.domain} will no longer be able to sign up.</AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => handleDeleteDomain(domain.id, domain.domain)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                  Remove
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>

                      {/* Microsoft Tenant Authorization */}
                      <div className="pt-3 border-t border-border/50 space-y-3">
                        <div className="flex items-start gap-2">
                          <ShieldCheck className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                          <div className="flex-1">
                            <p className="text-sm font-medium text-foreground">Microsoft Tenant Authorization</p>
                            <p className="text-xs text-muted-foreground">
                              The Global Admin of <span className="font-medium">{domain.domain}</span> must click below and sign in to grant InboxIQ tenant-wide access. Once granted, this status updates automatically and users from this domain can sign in with Microsoft and have Outlook mail/calendar connected automatically on first sign-in.
                            </p>
                          </div>
                        </div>

                        {/* Azure Redirect URI prerequisite — required or Microsoft returns a blank/error page */}
                        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
                          <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                            One-time Azure prerequisite — required or the consent screen returns a blank page
                          </p>
                          <p className="text-xs text-muted-foreground">
                            In your Azure App Registration {microsoftClientId ? <span className="font-mono">({microsoftClientId})</span> : null} → <span className="font-medium">Authentication</span> → <span className="font-medium">Web Redirect URIs</span>, add this exact URL:
                          </p>
                          <div className="flex items-center gap-2 rounded bg-background border border-border px-2 py-1.5">
                            <code className="text-xs flex-1 break-all font-mono">{MICROSOFT_ADMIN_CONSENT_CALLBACK}</code>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2"
                              onClick={() => {
                                navigator.clipboard.writeText(MICROSOFT_ADMIN_CONSENT_CALLBACK);
                                toast({ title: 'Copied', description: 'Redirect URI copied to clipboard.' });
                              }}
                            >
                              Copy
                            </Button>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2 items-end">
                          <div className="space-y-1">
                            <Label htmlFor={`tenant-${domain.id}`} className="text-xs">
                              Tenant ID or domain (optional, defaults to <span className="font-mono">{domain.domain}</span>)
                            </Label>
                            <Input
                              id={`tenant-${domain.id}`}
                              placeholder={domain.domain}
                              defaultValue={domain.microsoft_tenant_id || ''}
                              onBlur={(e) => {
                                if ((e.target.value || '') !== (domain.microsoft_tenant_id || '')) {
                                  handleSetTenantId(domain.id, e.target.value);
                                }
                              }}
                              className="h-9 text-sm"
                            />
                          </div>
                          <Button
                            size="sm"
                            onClick={() => handleGrantMicrosoftConsent(domain)}
                            className="gap-2"
                          >
                            <ExternalLink className="w-4 h-4" />
                            Grant Microsoft Consent
                          </Button>
                        </div>

                        {domain.microsoft_consent_granted_at && (
                          <p className="text-xs text-muted-foreground">
                            Consent granted {new Date(domain.microsoft_consent_granted_at).toLocaleString()}
                          </p>
                        )}

                        {!domain.microsoft_consent_granted && (
                          <p className="text-xs text-amber-700 dark:text-amber-400">
                            This only changes to granted after Microsoft returns to the callback successfully. Manual marking is disabled.
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <MicrosoftStatusPanel />
            </TabsContent>

            <TabsContent value="ai-agent" className="space-y-6 mt-4">
              <AgentPanel organizationId={profile?.organization_id ?? null} />
            </TabsContent>

            <TabsContent value="no-reply" className="space-y-6 mt-4">
              {hasFollowUpReminder ? (
                <FollowUpsPanel organizationId={profile?.organization_id ?? null} />
              ) : (
                <Card><CardContent className="p-6 text-sm text-muted-foreground">
                  No Reply Tracker is not enabled for this organization.
                </CardContent></Card>
              )}
            </TabsContent>

            <TabsContent value="general" className="space-y-6 mt-4">
              {/* Company Logo (shown in app sidebar + transactional emails) */}
              <CompanyLogoUploader organizationId={profile?.organization_id ?? null} />
            </TabsContent>

            <TabsContent value="api-keys" className="space-y-6 mt-4">

          {/* API Keys */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Key className="w-5 h-5" /> API Keys</CardTitle>
              <CardDescription>Configure API keys for AI services used by this platform</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* OpenAI */}
              <div className="p-4 rounded-lg border border-border space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-foreground">OpenAI API Key</p>
                    <p className="text-sm text-muted-foreground">Used for ChatGPT-powered features</p>
                  </div>
                  {isKeyConfigured('openai_api_key') ? (
                    <Badge className="bg-green-500/10 text-green-600 border-green-500/20">Configured</Badge>
                  ) : (
                    <Badge variant="secondary">Not Set</Badge>
                  )}
                </div>
                {isKeyConfigured('openai_api_key') && (
                  <p className="text-xs text-muted-foreground">
                    Last updated: {new Date(getKeyUpdatedAt('openai_api_key')!).toLocaleDateString()}
                  </p>
                )}
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={showOpenaiKey ? 'text' : 'password'}
                      placeholder={isKeyConfigured('openai_api_key') ? 'Enter new key to update...' : 'sk-...'}
                      value={openaiKey}
                      onChange={e => setOpenaiKey(e.target.value)}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                      onClick={() => setShowOpenaiKey(!showOpenaiKey)}
                    >
                      {showOpenaiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </Button>
                  </div>
                  <Button
                    onClick={() => handleSaveApiKey('openai_api_key', openaiKey)}
                    disabled={!openaiKey.trim() || savingKey === 'openai_api_key'}
                  >
                    {savingKey === 'openai_api_key' ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                    Save
                  </Button>
                  {isKeyConfigured('openai_api_key') && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remove OpenAI API Key?</AlertDialogTitle>
                          <AlertDialogDescription>This will remove the OpenAI API key. AI features using ChatGPT will stop working.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleDeleteApiKey('openai_api_key')} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Remove</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              </div>

              {/* Claude */}
              <div className="p-4 rounded-lg border border-border space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-foreground">Claude API Key (Anthropic)</p>
                    <p className="text-sm text-muted-foreground">Used for Claude-powered features</p>
                  </div>
                  {isKeyConfigured('claude_api_key') ? (
                    <Badge className="bg-green-500/10 text-green-600 border-green-500/20">Configured</Badge>
                  ) : (
                    <Badge variant="secondary">Not Set</Badge>
                  )}
                </div>
                {isKeyConfigured('claude_api_key') && (
                  <p className="text-xs text-muted-foreground">
                    Last updated: {new Date(getKeyUpdatedAt('claude_api_key')!).toLocaleDateString()}
                  </p>
                )}
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={showClaudeKey ? 'text' : 'password'}
                      placeholder={isKeyConfigured('claude_api_key') ? 'Enter new key to update...' : 'sk-ant-...'}
                      value={claudeKey}
                      onChange={e => setClaudeKey(e.target.value)}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                      onClick={() => setShowClaudeKey(!showClaudeKey)}
                    >
                      {showClaudeKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </Button>
                  </div>
                  <Button
                    onClick={() => handleSaveApiKey('claude_api_key', claudeKey)}
                    disabled={!claudeKey.trim() || savingKey === 'claude_api_key'}
                  >
                    {savingKey === 'claude_api_key' ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                    Save
                  </Button>
                  {isKeyConfigured('claude_api_key') && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remove Claude API Key?</AlertDialogTitle>
                          <AlertDialogDescription>This will remove the Claude API key. AI features using Claude will stop working.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleDeleteApiKey('claude_api_key')} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Remove</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* AI Provider Preference */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Bot className="w-5 h-5" /> AI Provider Preference</CardTitle>
              <CardDescription>
                Choose which AI engine powers auto-drafts, auto-replies, and the email agent
                (agent@energyforward.com). Applies to AI Chat / Daily Brief as well.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Provider</Label>
                  <Select value={providerPref} onValueChange={(v: any) => setProviderPref(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto (OpenAI primary, Claude fallback)</SelectItem>
                      <SelectItem value="openai">OpenAI only (ChatGPT)</SelectItem>
                      <SelectItem value="claude">Claude only (Anthropic)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    "Auto" tries the first provider, then falls back if it fails or runs out of credits.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>General-knowledge reasoning</Label>
                  <div className="flex items-center gap-3 p-3 rounded-md border border-border">
                    <Switch checked={enableWebSearch} onCheckedChange={setEnableWebSearch} id="ws" />
                    <Label htmlFor="ws" className="cursor-pointer flex-1">
                      Allow agent to answer broad / technical questions using general knowledge
                    </Label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    When ON, the agent answers technology / strategy questions even when the email
                    body alone is not enough. When OFF, it stays strictly within email content.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>OpenAI model</Label>
                  <Select value={openaiModel} onValueChange={setOpenaiModel}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gpt-4o-mini">gpt-4o-mini (fast, cheap)</SelectItem>
                      <SelectItem value="gpt-4o">gpt-4o (highest quality)</SelectItem>
                      <SelectItem value="gpt-4.1-mini">gpt-4.1-mini</SelectItem>
                      <SelectItem value="gpt-4.1">gpt-4.1</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Claude model</Label>
                  <Select value={claudeModel} onValueChange={setClaudeModel}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="claude-3-5-sonnet-latest">Claude 3.5 Sonnet (balanced)</SelectItem>
                      <SelectItem value="claude-3-5-haiku-latest">Claude 3.5 Haiku (fast)</SelectItem>
                      <SelectItem value="claude-3-opus-latest">Claude 3 Opus (highest quality)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex justify-end">
                <Button onClick={handleSaveAIPrefs} disabled={savingPref}>
                  {savingPref ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                  Save AI Preferences
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>System Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 rounded-lg border border-border">
                <p className="font-medium text-foreground">Super Admin</p>
                <p className="text-sm text-muted-foreground">arahimi@energyforward.com</p>
              </div>
              <div className="p-4 rounded-lg border border-border">
                <p className="font-medium text-foreground">Authentication Methods</p>
                <div className="flex gap-2 mt-2">
                  <Badge>Email/Password</Badge>
                  <Badge>Microsoft SSO</Badge>
                  <Badge>Google OAuth</Badge>
                </div>
              </div>
              <div className="p-4 rounded-lg border border-border">
                <p className="font-medium text-foreground">Controllable Features</p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {FEATURE_KEYS.map(f => (
                    <Badge key={f.key} variant="outline">{f.label}</Badge>
                  ))}
                </div>
              </div>
              <div className="p-4 rounded-lg border border-border">
                <p className="font-medium text-foreground">AI Models</p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {AI_MODEL_KEYS.map(m => (
                    <Badge key={m.key} variant="outline">{m.label}</Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
            </TabsContent>
          </Tabs>
        </TabsContent>
      </Tabs>

      {/* Reset Password Dialog */}
      <Dialog open={!!resetPasswordUserId} onOpenChange={(open) => { if (!open) { setResetPasswordUserId(null); setResetPasswordValue(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset User Password</DialogTitle>
            <DialogDescription>
              Set a new password for {users.find(u => u.user_id === resetPasswordUserId)?.email || 'this user'}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="resetPassword">New Password</Label>
            <Input id="resetPassword" type="password" placeholder="Min 8 characters" value={resetPasswordValue} onChange={e => setResetPasswordValue(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setResetPasswordUserId(null); setResetPasswordValue(''); }}>Cancel</Button>
            <Button onClick={handleResetPassword} disabled={resettingPassword || resetPasswordValue.length < 6}>
              {resettingPassword ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <KeyRound className="w-4 h-4 mr-2" />}
              Update Password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
