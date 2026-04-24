import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import {
  Loader2, Check, Globe, ShieldCheck, UserPlus, Plus, Trash2,
  ArrowRight, ArrowLeft, Sparkles
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

interface UserDraft {
  full_name: string;
  email: string;
  password: string;
  groupNames: string[]; // names of groups created in step 2 (or existing)
}

interface Props {
  invoke: (action: string, payload?: Record<string, unknown>) => Promise<any>;
  existingGroups: PermissionGroup[];
  organizationId: string | null;
  onCompleted: () => void;
}

const generatePassword = () => {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
};

const emptyGroup = (): GroupDraft => ({ name: '', description: '', features: {} });
// `email` here stores ONLY the local part (left of @). Full email is composed at submit time.
const emptyUser = (): UserDraft => ({ full_name: '', email: '', password: '', groupNames: [] });

export default function OnboardingWizard({ invoke, existingGroups, organizationId, onCompleted }: Props) {
  const { toast } = useToast();
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1
  const [domain, setDomain] = useState('');
  const [orgName, setOrgName] = useState('');
  const [domainSaved, setDomainSaved] = useState(false);
  const [savingDomain, setSavingDomain] = useState(false);

  // Step 2
  const [groupDrafts, setGroupDrafts] = useState<GroupDraft[]>([
    { name: 'Standard', description: 'Basic users', features: { ai_draft: true } },
    { name: 'Power User', description: 'Drafting + auto reply', features: { ai_draft: true, ai_auto_reply: true, reports: true } },
    { name: 'Executive', description: 'Full access', features: Object.fromEntries(FEATURE_KEYS.map(f => [f.key, true])) },
  ]);
  const [savingGroups, setSavingGroups] = useState(false);
  const [createdGroups, setCreatedGroups] = useState<PermissionGroup[]>([]);

  // Step 3
  const [userDrafts, setUserDrafts] = useState<UserDraft[]>([emptyUser('')]);
  const [submittingUsers, setSubmittingUsers] = useState(false);
  const [results, setResults] = useState<{ email: string; success: boolean; error?: string }[] | null>(null);

  // Combined view of available groups for assigning to users
  const allGroups = useMemo(() => {
    const map = new Map<string, PermissionGroup>();
    existingGroups.forEach(g => map.set(g.name.toLowerCase(), g));
    createdGroups.forEach(g => map.set(g.name.toLowerCase(), g));
    return Array.from(map.values());
  }, [existingGroups, createdGroups]);

  // ───────────────────────── Step 1: Domain ─────────────────────────
  const handleSaveDomain = async () => {
    const d = domain.trim().toLowerCase();
    if (!/^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,}$/.test(d)) {
      toast({ title: 'Invalid domain', description: 'Enter a valid domain like company.com', variant: 'destructive' });
      return;
    }
    setSavingDomain(true);
    try {
      const { error } = await supabase.from('allowed_domains').insert({
        domain: d,
        organization_name: orgName.trim() || null,
        is_active: true,
      });
      if (error && error.code !== '23505') throw error;
      if (error?.code === '23505') {
        toast({ title: 'Domain already authorized', description: `${d} was already added — continuing.` });
      } else {
        toast({ title: 'Domain added', description: `${d} is now authorized.` });
      }
      setDomain(d);
      setDomainSaved(true);
      setUserDrafts([{ full_name: '', email: `@${d}`, password: '', groupNames: [] }]);
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
      toast({ title: 'Add at least one group', description: 'Or skip to step 3 to use existing groups.', variant: 'destructive' });
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
        // Skip if a group with this name already exists
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
        // Apply feature toggles
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
      setStep(3);
    } catch (e: any) {
      toast({ title: 'Error creating groups', description: e.message, variant: 'destructive' });
    } finally {
      setSavingGroups(false);
    }
  };

  // ───────────────────────── Step 3: Users ─────────────────────────
  const updateUserDraft = (idx: number, patch: Partial<UserDraft>) => {
    setUserDrafts(prev => prev.map((u, i) => i === idx ? { ...u, ...patch } : u));
  };
  const toggleUserGroup = (idx: number, groupName: string) => {
    setUserDrafts(prev => prev.map((u, i) => {
      if (i !== idx) return u;
      const has = u.groupNames.includes(groupName);
      return { ...u, groupNames: has ? u.groupNames.filter(n => n !== groupName) : [...u.groupNames, groupName] };
    }));
  };
  const addUserDraft = () => setUserDrafts(prev => [...prev, emptyUser(domain)]);
  const removeUserDraft = (idx: number) => setUserDrafts(prev => prev.filter((_, i) => i !== idx));

  const handleSubmitUsers = async () => {
    const valid = userDrafts.filter(u => u.email.trim() && u.email.trim() !== `@${domain}` && u.full_name.trim());
    if (valid.length === 0) {
      toast({ title: 'No users to create', description: 'Add at least one user with name and email.', variant: 'destructive' });
      return;
    }
    // Validate domain match
    const wrongDomain = valid.find(u => !u.email.trim().toLowerCase().endsWith(`@${domain}`));
    if (wrongDomain) {
      toast({
        title: 'Email domain mismatch',
        description: `${wrongDomain.email} is not on @${domain}. All users in this wizard must use the authorized domain.`,
        variant: 'destructive',
      });
      return;
    }
    setSubmittingUsers(true);
    setResults(null);
    try {
      const payload = valid.map(u => ({
        email: u.email.trim().toLowerCase(),
        full_name: u.full_name.trim(),
        password: u.password.trim() || generatePassword(),
        group_ids: u.groupNames
          .map(n => allGroups.find(g => g.name.toLowerCase() === n.toLowerCase())?.id)
          .filter((v): v is string => Boolean(v)),
      }));
      const data = await invoke('bulk_create_users', { users: payload });
      setResults(data.results || []);
      const succeeded = data.summary?.succeeded ?? data.results?.filter((r: any) => r.success).length ?? 0;
      const failed = data.summary?.failed ?? data.results?.filter((r: any) => !r.success).length ?? 0;
      toast({
        title: 'Users created',
        description: `${succeeded} created, ${failed} failed.`,
        variant: failed > 0 ? 'destructive' : 'default',
      });
      if (succeeded > 0) onCompleted();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setSubmittingUsers(false);
    }
  };

  const resetWizard = () => {
    setStep(1);
    setDomain('');
    setOrgName('');
    setDomainSaved(false);
    setCreatedGroups([]);
    setUserDrafts([emptyUser('')]);
    setResults(null);
  };

  // ───────────────────────── Stepper UI ─────────────────────────
  const steps = [
    { n: 1, label: 'Add Domain', icon: Globe },
    { n: 2, label: 'Create Groups', icon: ShieldCheck },
    { n: 3, label: 'Add Users', icon: UserPlus },
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
            Authorize a domain, create permission groups for it, then add users assigned to those groups — all in 3 steps.
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
            <CardDescription>Only users whose email ends in this domain will be allowed to sign up and use the app.</CardDescription>
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
                {savingDomain ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Save & Continue <ArrowRight className="w-4 h-4 ml-2" />
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
                <Button variant="outline" onClick={() => setStep(3)}>
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

      {/* STEP 3 */}
      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><UserPlus className="w-5 h-5" /> Step 3 — Add Users to <span className="text-primary">@{domain}</span></CardTitle>
            <CardDescription>
              Add users one row at a time. Tick the groups each user should belong to. Passwords auto-generate if blank.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {allGroups.length === 0 ? (
              <p className="text-sm text-muted-foreground">No groups available — users will be created without group assignments. You can assign groups later from the Users tab.</p>
            ) : (
              <div className="text-xs text-muted-foreground">
                Available groups: {allGroups.map(g => g.name).join(', ')}
              </div>
            )}

            <div className="space-y-3">
              {userDrafts.map((u, idx) => (
                <div key={idx} className="p-4 rounded-lg border border-border bg-background space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-[1.5fr_2fr_1.5fr_auto] gap-2 items-end">
                    <div className="space-y-1">
                      <Label className="text-xs">Full Name</Label>
                      <Input placeholder="John Doe" value={u.full_name} onChange={e => updateUserDraft(idx, { full_name: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Email (must end in @{domain})</Label>
                      <Input type="email" placeholder={`john@${domain}`} value={u.email} onChange={e => updateUserDraft(idx, { email: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Password (auto if blank)</Label>
                      <Input type="text" placeholder="Auto-generate" value={u.password} onChange={e => updateUserDraft(idx, { password: e.target.value })} />
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => removeUserDraft(idx)} disabled={userDrafts.length === 1}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>

                  {allGroups.length > 0 && (
                    <div className="pt-2 border-t border-border/50">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Assign to groups</p>
                      <div className="flex flex-wrap gap-2">
                        {allGroups.map(g => {
                          const checked = u.groupNames.includes(g.name);
                          return (
                            <label key={g.id} className={cn(
                              'flex items-center gap-2 px-3 py-1.5 rounded-md border cursor-pointer transition-colors',
                              checked ? 'border-primary bg-primary/10' : 'border-border bg-background hover:bg-muted/50'
                            )}>
                              <Checkbox checked={checked} onCheckedChange={() => toggleUserGroup(idx, g.name)} />
                              <span className="text-sm">{g.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <Button variant="outline" size="sm" onClick={addUserDraft} className="gap-2">
              <Plus className="w-4 h-4" /> Add another user
            </Button>

            {results && (
              <div className="border-t border-border pt-3 space-y-1 max-h-48 overflow-y-auto">
                <p className="text-sm font-semibold">Results</p>
                {results.map((r, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span>{r.email}</span>
                    {r.success
                      ? <Badge variant="default">Created</Badge>
                      : <Badge variant="destructive" title={r.error}>{r.error || 'Failed'}</Badge>}
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => setStep(2)}>
                <ArrowLeft className="w-4 h-4 mr-2" /> Back
              </Button>
              <div className="flex gap-2">
                {results && results.some(r => r.success) && (
                  <Button variant="outline" onClick={resetWizard}>
                    Start over with another domain
                  </Button>
                )}
                <Button onClick={handleSubmitUsers} disabled={submittingUsers}>
                  {submittingUsers ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <UserPlus className="w-4 h-4 mr-2" />}
                  Create {userDrafts.filter(u => u.email.trim() && u.email.trim() !== `@${domain}`).length} User(s)
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
