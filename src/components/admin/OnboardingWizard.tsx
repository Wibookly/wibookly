import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import {
  Loader2, Check, Globe, ShieldCheck, Plus, Trash2,
  ArrowRight, ArrowLeft, Sparkles, Building2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PermissionGroup } from './PermissionGroupsPanel';

const FEATURE_KEYS = [
  { key: 'ai_draft', label: 'AI Draft' },
  { key: 'ai_auto_reply', label: 'AI Auto Reply' },
  { key: 'ai_assistant', label: 'AI Assistant' },
  { key: 'reports', label: 'Reports' },
  { key: 'ai_model_chatgpt', label: 'ChatGPT Model' },
  { key: 'ai_model_claude', label: 'Claude Model' },
] as const;

interface GroupDraft {
  name: string;
  description: string;
  features: Record<string, boolean>;
}

interface Props {
  invoke: (action: string, payload?: Record<string, unknown>) => Promise<any>;
  existingGroups: PermissionGroup[];
  organizationId: string | null;
  onCompleted: () => void;
  onNavigateToTab?: (tab: string) => void;
}

const MICROSOFT_CLIENT_ID = 'a72108fc-2c1f-43a2-8ed6-0d99839c618b';
const MICROSOFT_ADMIN_CONSENT_CALLBACK = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/microsoft-admin-consent-callback`;
const MICROSOFT_REQUIRED_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'https://graph.microsoft.com/User.Read',
  'https://graph.microsoft.com/Mail.ReadWrite',
  'https://graph.microsoft.com/Mail.Send',
  'https://graph.microsoft.com/Calendars.ReadWrite',
].join(' ');

const emptyGroup = (): GroupDraft => ({ name: '', description: '', features: {} });

export default function OnboardingWizard({ invoke, existingGroups, organizationId, onCompleted, onNavigateToTab }: Props) {
  const { toast } = useToast();
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1 — Domain + auto-consent
  const [domain, setDomain] = useState('');
  const [orgName, setOrgName] = useState('');
  const [savedDomainId, setSavedDomainId] = useState<string | null>(null);
  const [savingDomain, setSavingDomain] = useState(false);

  // Step 2 — Groups
  const [groupDrafts, setGroupDrafts] = useState<GroupDraft[]>([
    { name: 'Standard', description: 'Basic users', features: { ai_draft: true } },
    { name: 'Power User', description: 'Drafting + auto reply', features: { ai_draft: true, ai_auto_reply: true, reports: true } },
    { name: 'Executive', description: 'Full access', features: Object.fromEntries(FEATURE_KEYS.map(f => [f.key, true])) },
  ]);
  const [savingGroups, setSavingGroups] = useState(false);
  const [createdGroups, setCreatedGroups] = useState<PermissionGroup[]>([]);

  // ───────────────────────── Step 1: Domain + Microsoft consent ─────────────────────────
  const buildAdminConsentUrl = (domainName: string, domainRowId: string) => {
    const state = btoa(JSON.stringify({
      domainId: domainRowId,
      appOrigin: window.location.origin,
    }));
    const params = new URLSearchParams({
      client_id: MICROSOFT_CLIENT_ID,
      redirect_uri: MICROSOFT_ADMIN_CONSENT_CALLBACK,
      scope: MICROSOFT_REQUIRED_SCOPES,
      state,
    });
    return `https://login.microsoftonline.com/${encodeURIComponent(domainName)}/v2.0/adminconsent?${params.toString()}`;
  };

  const handleSaveDomain = async () => {
    const d = domain.trim().toLowerCase();
    if (!/^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,}$/.test(d)) {
      toast({ title: 'Invalid domain', description: 'Enter a valid domain like company.com', variant: 'destructive' });
      return;
    }
    setSavingDomain(true);
    try {
      // Insert (or fetch existing) domain row
      let domainRowId: string | null = null;
      const { data: inserted, error } = await supabase
        .from('allowed_domains')
        .insert({
          domain: d,
          organization_name: orgName.trim() || null,
          is_active: true,
        })
        .select('id')
        .single();

      if (error && error.code !== '23505') throw error;

      if (error?.code === '23505') {
        // Already exists — fetch it
        const { data: existing } = await supabase
          .from('allowed_domains')
          .select('id')
          .eq('domain', d)
          .maybeSingle();
        domainRowId = existing?.id ?? null;
        toast({ title: 'Domain already authorized', description: `${d} was already added — continuing to consent.` });
      } else {
        domainRowId = inserted?.id ?? null;
        toast({ title: 'Domain added', description: `${d} is now authorized.` });
      }

      if (!domainRowId) throw new Error('Could not resolve domain row id.');

      setDomain(d);
      setSavedDomainId(domainRowId);

      // Auto-launch Microsoft consent flow in a new tab
      const consentUrl = buildAdminConsentUrl(d, domainRowId);
      const popup = window.open(consentUrl, '_blank', 'noopener,noreferrer');
      if (!popup) {
        // Popup blocked — fall back to top-level redirect
        toast({
          title: 'Allow popups to continue',
          description: 'Redirecting to Microsoft consent in this tab…',
        });
        window.location.assign(consentUrl);
        return;
      }

      toast({
        title: 'Microsoft consent opened',
        description: `Sign in with a Global Admin of ${d} and click Accept. Then come back and continue to Groups.`,
      });

      // Move to step 2 immediately so admin can prep groups while consent is signed
      setStep(2);
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setSavingDomain(false);
    }
  };

  // ───────────────────────── Step 2: Groups ─────────────────────────
  const updateGroupDraft = (idx: number, patch: Partial<GroupDraft>) => {
    setGroupDrafts(prev => prev.map((g, i) => i === idx ? { ...g, ...patch } : g));
  };
  const toggleGroupFeature = (idx: number, key: string, val: boolean) => {
    setGroupDrafts(prev => prev.map((g, i) => i === idx ? { ...g, features: { ...g.features, [key]: val } } : g));
  };
  const addGroupDraft = () => setGroupDrafts(prev => [...prev, emptyGroup()]);
  const removeGroupDraft = (idx: number) => setGroupDrafts(prev => prev.filter((_, i) => i !== idx));

  const handleSaveGroups = async () => {
    const valid = groupDrafts.filter(g => g.name.trim());
    if (valid.length === 0 && existingGroups.length === 0) {
      toast({ title: 'Add at least one group', description: 'Define at least one permission group, or skip to finish.', variant: 'destructive' });
      return;
    }
    if (!organizationId) {
      toast({ title: 'Missing organization', description: 'Cannot create groups without an organization context.', variant: 'destructive' });
      return;
    }
    setSavingGroups(true);
    try {
      const created: PermissionGroup[] = [];
      for (const g of valid) {
        const dup = existingGroups.find(x => x.name.toLowerCase() === g.name.trim().toLowerCase())
                  || createdGroups.find(x => x.name.toLowerCase() === g.name.trim().toLowerCase());
        if (dup) {
          created.push(dup);
          continue;
        }
        const res = await invoke('create_group', {
          name: g.name.trim(),
          description: g.description.trim() || null,
          organization_id: organizationId,
        });
        const newGroup: PermissionGroup = res?.group || { id: res?.id, name: g.name.trim(), description: g.description.trim() || null, organization_id: '', features: [], member_count: 0 };
        for (const feat of FEATURE_KEYS) {
          const enabled = g.features[feat.key];
          if (enabled) {
            await invoke('set_group_feature', { group_id: newGroup.id, feature_key: feat.key, is_enabled: true });
          }
        }
        newGroup.features = FEATURE_KEYS
          .filter(f => g.features[f.key])
          .map(f => ({ feature_key: f.key, is_enabled: true }));
        created.push(newGroup);
      }
      setCreatedGroups(prev => {
        const merged = [...prev];
        created.forEach(c => { if (!merged.find(m => m.id === c.id)) merged.push(c); });
        return merged;
      });
      toast({ title: 'Groups ready', description: `${created.length} group(s) configured.` });
      onCompleted();
      setStep(3);
    } catch (e: any) {
      toast({ title: 'Error creating groups', description: e.message, variant: 'destructive' });
    } finally {
      setSavingGroups(false);
    }
  };

  const resetWizard = () => {
    setStep(1);
    setDomain('');
    setOrgName('');
    setSavedDomainId(null);
    setCreatedGroups([]);
  };

  // ───────────────────────── Stepper UI ─────────────────────────
  const steps = [
    { n: 1, label: 'Add Domain & Consent', icon: Globe },
    { n: 2, label: 'Create Groups', icon: ShieldCheck },
    { n: 3, label: 'Sync M365 Users', icon: Building2 },
  ];

  return (
    <div className="space-y-6">
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            Guided Onboarding
          </CardTitle>
          <CardDescription>
            Authorize a domain (Microsoft consent runs automatically), define permission groups, then sync users from the customer's Microsoft 365 directory.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-2">
            {steps.map((s, i) => {
              const isActive = step === s.n;
              const isDone = step > s.n;
              const Icon = s.icon;
              return (
                <div key={s.n} className="flex-1 flex items-center gap-2">
                  <div className={cn(
                    'flex items-center gap-2 px-3 py-2 rounded-lg border flex-1',
                    isActive && 'border-primary bg-background shadow-sm',
                    isDone && 'border-emerald-500/40 bg-emerald-500/10',
                    !isActive && !isDone && 'border-border bg-background/50 opacity-60'
                  )}>
                    <div className={cn(
                      'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold',
                      isActive && 'bg-primary text-primary-foreground',
                      isDone && 'bg-emerald-500 text-white',
                      !isActive && !isDone && 'bg-muted text-muted-foreground'
                    )}>
                      {isDone ? <Check className="w-4 h-4" /> : s.n}
                    </div>
                    <div className="flex items-center gap-2">
                      <Icon className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{s.label}</span>
                    </div>
                  </div>
                  {i < steps.length - 1 && <ArrowRight className="w-4 h-4 text-muted-foreground" />}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* STEP 1 */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Globe className="w-5 h-5" /> Step 1 — Authorize Domain</CardTitle>
            <CardDescription>
              Only users whose email ends in this domain will be allowed to use the app. After saving, the Microsoft Global Admin consent screen will open automatically in a new tab — sign in once and approve to grant tenant-wide access.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="wiz-domain">Domain</Label>
                <Input id="wiz-domain" placeholder="company.com" value={domain} onChange={e => setDomain(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="wiz-org">Organization name (optional)</Label>
                <Input id="wiz-org" placeholder="Company Inc." value={orgName} onChange={e => setOrgName(e.target.value)} />
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={handleSaveDomain} disabled={savingDomain || !domain.trim()}>
                {savingDomain ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
                Save & Grant Microsoft Consent <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* STEP 2 */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ShieldCheck className="w-5 h-5" /> Step 2 — Create Groups for <span className="text-primary">@{domain}</span></CardTitle>
            <CardDescription>
              Define permission tiers (e.g. Standard, Power User, Executive). Each group bundles features so you can assign users to a group instead of toggling features one-by-one.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {existingGroups.length > 0 && (
              <div className="p-3 rounded-md bg-muted/40 border border-border/50">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Existing groups (will be reused)</p>
                <div className="flex flex-wrap gap-2">
                  {existingGroups.map(g => (
                    <Badge key={g.id} variant="secondary" className="gap-1">
                      <ShieldCheck className="w-3 h-3" /> {g.name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-3">
              {groupDrafts.map((g, idx) => (
                <div key={idx} className="p-4 rounded-lg border border-border bg-background space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_2fr_auto] gap-2 items-end">
                    <div className="space-y-1">
                      <Label className="text-xs">Group name</Label>
                      <Input placeholder="Standard" value={g.name} onChange={e => updateGroupDraft(idx, { name: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Description (optional)</Label>
                      <Input placeholder="Basic users" value={g.description} onChange={e => updateGroupDraft(idx, { description: e.target.value })} />
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => removeGroupDraft(idx)} disabled={groupDrafts.length === 1}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 pt-2 border-t border-border/50">
                    {FEATURE_KEYS.map(f => (
                      <div key={f.key} className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted/30">
                        <span className="text-xs font-medium">{f.label}</span>
                        <Switch
                          checked={!!g.features[f.key]}
                          onCheckedChange={(v) => toggleGroupFeature(idx, f.key, v)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <Button variant="outline" size="sm" onClick={addGroupDraft} className="gap-2">
              <Plus className="w-4 h-4" /> Add another group
            </Button>

            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => setStep(1)}>
                <ArrowLeft className="w-4 h-4 mr-2" /> Back
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => { onCompleted(); setStep(3); }}>
                  Skip groups <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
                <Button onClick={handleSaveGroups} disabled={savingGroups}>
                  {savingGroups ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Save Groups & Continue <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* STEP 3 — Done; point to M365 Directory tab */}
      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Building2 className="w-5 h-5" /> Step 3 — Sync users from Microsoft 365</CardTitle>
            <CardDescription>
              Domain authorized and groups configured. Now head to the <strong>M365 Directory</strong> tab and click <strong>Sync now</strong> to pull licensed users from the customer's tenant directory. Each user can then be invited with one click — no password setup required.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 space-y-2">
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                <Check className="w-5 h-5" /> <span className="font-semibold">Setup complete for @{domain || 'your domain'}</span>
              </div>
              <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
                <li>Domain saved and Microsoft consent launched.</li>
                <li>{createdGroups.length > 0 ? `${createdGroups.length} permission group(s) configured.` : 'Groups skipped (you can add them later).'}</li>
                <li>Ready to discover and invite Microsoft 365 users.</li>
              </ul>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <Button variant="ghost" onClick={resetWizard}>
                <ArrowLeft className="w-4 h-4 mr-2" /> Onboard another domain
              </Button>
              <Button
                onClick={() => {
                  // Switch to M365 Directory tab (radix Tabs uses data-value triggers)
                  const trigger = document.querySelector<HTMLButtonElement>('[role="tab"][data-state][value="discovered"]')
                    || document.querySelector<HTMLButtonElement>('[role="tab"][data-radix-collection-item][value="discovered"]')
                    || Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(el => el.textContent?.toLowerCase().includes('m365'));
                  trigger?.click();
                }}
              >
                <Building2 className="w-4 h-4 mr-2" /> Go to M365 Directory
              </Button>
            </div>

            <p className="text-xs text-muted-foreground border-t border-border/50 pt-3">
              If the consent tab is still open, finish approval there first. The <strong>Domains</strong> tab will automatically show the green “MS Consent” badge once Microsoft confirms.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
