import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Loader2, Plus, Trash2, ShieldCheck, Users as UsersIcon, Globe, RotateCcw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const FEATURE_KEYS = [
  { key: 'ai_draft', label: 'AI Draft' },
  { key: 'ai_auto_reply', label: 'AI Auto Reply' },
  { key: 'ai_assistant', label: 'AI Chat' },
  { key: 'daily_brief', label: 'My Daily Brief' },
  { key: 'reports', label: 'AI Activity Reports' },
  { key: 'ai_model_chatgpt', label: 'ChatGPT Model' },
  { key: 'ai_model_claude', label: 'Claude Model' },
  { key: 'email_agent', label: 'Email Agent' },
  { key: 'teams_agent', label: 'Teams Agent' },
] as const;

const GLOBAL_GROUP_VALUE = '__global__';

export interface PermissionGroup {
  id: string;
  name: string;
  description: string | null;
  organization_id: string;
  domain_id: string | null;
  features: { feature_key: string; is_enabled: boolean }[];
  /** Per-domain overrides — only populated for global groups. */
  overrides?: { domain_id: string; feature_key: string; is_enabled: boolean }[];
  member_count: number;
}

export interface AdminDomain {
  id: string;
  domain: string;
}

interface Props {
  organizationId: string | null;
  invoke: (action: string, payload?: Record<string, unknown>) => Promise<any>;
  groups: PermissionGroup[];
  domains: AdminDomain[];
  onChanged: () => void;
}

export default function PermissionGroupsPanel({ organizationId, invoke, groups, domains, onChanged }: Props) {
  const { toast } = useToast();
  const [localGroups, setLocalGroups] = useState<PermissionGroup[]>(groups);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [domainId, setDomainId] = useState<string>(GLOBAL_GROUP_VALUE);
  const [filterDomain, setFilterDomain] = useState<string>('all');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    setLocalGroups(groups);
  }, [groups]);

  const domainLabel = (id: string | null) => {
    if (!id) return 'All domains';
    return domains.find(d => d.id === id)?.domain ?? 'Unknown domain';
  };

  const handleCreate = async () => {
    if (!name.trim() || !organizationId) return;
    setCreating(true);
    try {
      await invoke('create_group', {
        name: name.trim(),
        description: description.trim() || null,
        organization_id: organizationId,
        domain_id: domainId === GLOBAL_GROUP_VALUE ? null : domainId,
      });
      toast({ title: 'Group created', description: `${name} is ready to configure.` });
      setName('');
      setDescription('');
      setDomainId(GLOBAL_GROUP_VALUE);
      onChanged();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  const handleToggleFeature = async (groupId: string, featureKey: string, enabled: boolean) => {
    try {
      await invoke('set_group_feature', { group_id: groupId, feature_key: featureKey, is_enabled: enabled });
      setLocalGroups((prev) => prev.map((group) => (
        group.id !== groupId
          ? group
          : {
              ...group,
              features: group.features.some((feature) => feature.feature_key === featureKey)
                ? group.features.map((feature) => (
                    feature.feature_key === featureKey ? { ...feature, is_enabled: enabled } : feature
                  ))
                : [...group.features, { feature_key: featureKey, is_enabled: enabled }],
            }
      )));
      onChanged();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  const handleSetOverride = async (groupId: string, domainIdValue: string, featureKey: string, enabled: boolean) => {
    try {
      await invoke('set_group_feature_override', {
        group_id: groupId,
        domain_id: domainIdValue,
        feature_key: featureKey,
        is_enabled: enabled,
      });
      setLocalGroups((prev) => prev.map((group) => {
        if (group.id !== groupId) return group;
        const nextOverrides = group.overrides || [];
        const hasOverride = nextOverrides.some(
          (override) => override.domain_id === domainIdValue && override.feature_key === featureKey,
        );

        return {
          ...group,
          overrides: hasOverride
            ? nextOverrides.map((override) => (
                override.domain_id === domainIdValue && override.feature_key === featureKey
                  ? { ...override, is_enabled: enabled }
                  : override
              ))
            : [...nextOverrides, { domain_id: domainIdValue, feature_key: featureKey, is_enabled: enabled }],
        };
      }));
      onChanged();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  const handleClearOverride = async (groupId: string, domainIdValue: string, featureKey: string) => {
    try {
      await invoke('clear_group_feature_override', {
        group_id: groupId,
        domain_id: domainIdValue,
        feature_key: featureKey,
      });
      setLocalGroups((prev) => prev.map((group) => (
        group.id !== groupId
          ? group
          : {
              ...group,
              overrides: (group.overrides || []).filter(
                (override) => !(override.domain_id === domainIdValue && override.feature_key === featureKey),
              ),
            }
      )));
      onChanged();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  const handleDelete = async (groupId: string) => {
    try {
      await invoke('delete_group', { group_id: groupId });
      toast({ title: 'Group deleted' });
      onChanged();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  const isFeatureEnabled = (group: PermissionGroup, key: string) =>
    group.features.find(f => f.feature_key === key)?.is_enabled ?? false;

  // When filtering by a specific domain, also include Global groups since
  // they apply to that domain too (just with their default values, unless
  // overridden). This way switching the filter to "@energyforward.com"
  // still surfaces the existing global Standard / Power User / Executive
  // groups so admins can configure per-domain overrides on them.
  const visibleGroups = filterDomain === 'all'
    ? localGroups
    : filterDomain === GLOBAL_GROUP_VALUE
      ? localGroups.filter(g => !g.domain_id)
      : localGroups.filter(g => g.domain_id === filterDomain || g.domain_id === null);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Plus className="w-5 h-5" /> Create Permission Group</CardTitle>
          <CardDescription>
            Bundle features together (e.g. Standard, Power User, Executive) and scope each group to a specific
            authorized domain — or leave it global to apply across all domains. Global groups can be tweaked
            per-domain after creation.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="group-name">Group name</Label>
              <Input id="group-name" placeholder="Power User" value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="group-desc">Description (optional)</Label>
              <Input id="group-desc" placeholder="Has AI drafting and auto-reply" value={description} onChange={e => setDescription(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="group-domain">Domain</Label>
              <Select value={domainId} onValueChange={setDomainId}>
                <SelectTrigger id="group-domain">
                  <SelectValue placeholder="Select domain" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={GLOBAL_GROUP_VALUE}>All domains (global)</SelectItem>
                  {domains.map(d => (
                    <SelectItem key={d.id} value={d.id}>@{d.domain}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button onClick={handleCreate} disabled={creating || !name.trim() || !organizationId}>
            {creating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
            Create Group
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle>Groups</CardTitle>
              <CardDescription>
                Toggle which features each group grants. For global groups, switch the "Configure for"
                dropdown to a specific domain to override the defaults just for that domain.
              </CardDescription>
            </div>
            {domains.length > 0 && (
              <div className="min-w-[200px]">
                <Select value={filterDomain} onValueChange={setFilterDomain}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All groups</SelectItem>
                    <SelectItem value={GLOBAL_GROUP_VALUE}>Global only</SelectItem>
                    {domains.map(d => (
                      <SelectItem key={d.id} value={d.id}>@{d.domain}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {visibleGroups.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No groups for this filter. Create one above.</p>
          ) : (
              <div className="space-y-4">
               {visibleGroups.map(group => (
                <GroupCard
                   key={group.id}
                  group={group}
                  domains={domains}
                  isFeatureEnabled={isFeatureEnabled}
                  onToggleFeature={handleToggleFeature}
                   onSetOverride={handleSetOverride}
                   onClearOverride={handleClearOverride}
                  onDelete={handleDelete}
                  invoke={invoke}
                  onChanged={onChanged}
                  domainLabel={domainLabel}
                  initialScope={
                    filterDomain !== 'all' && filterDomain !== GLOBAL_GROUP_VALUE
                      ? filterDomain
                      : GLOBAL_GROUP_VALUE
                  }
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * One group's editor. For domain-scoped groups this is just the standard
 * feature switches. For Global groups, the admin can also choose a specific
 * domain in the "Configure for" dropdown to flip features on/off for that
 * domain only — the underlying storage is `group_feature_overrides`.
 */
function GroupCard({
  group,
  domains,
  isFeatureEnabled,
  onToggleFeature,
  onSetOverride,
  onClearOverride,
  onDelete,
  invoke,
  onChanged,
  domainLabel,
  initialScope = GLOBAL_GROUP_VALUE,
}: {
  group: PermissionGroup;
  domains: AdminDomain[];
  isFeatureEnabled: (group: PermissionGroup, key: string) => boolean;
  onToggleFeature: (groupId: string, featureKey: string, enabled: boolean) => Promise<void>;
  onSetOverride: (groupId: string, domainIdValue: string, featureKey: string, enabled: boolean) => Promise<void>;
  onClearOverride: (groupId: string, domainIdValue: string, featureKey: string) => Promise<void>;
  onDelete: (groupId: string) => Promise<void>;
  invoke: (action: string, payload?: Record<string, unknown>) => Promise<any>;
  onChanged: () => void;
  domainLabel: (id: string | null) => string;
  initialScope?: string;
}) {
  const isGlobal = !group.domain_id;
  // For global groups, admins can toggle the editor between "global defaults"
  // and "override for domain X". For non-global groups, this is fixed.
  const [editScope, setEditScope] = useState<string>(initialScope);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    if (!isGlobal) return;
    setEditScope(initialScope);
  }, [initialScope, isGlobal]);

  const overridesForScope = useMemo(() => {
    if (!isGlobal || editScope === GLOBAL_GROUP_VALUE) return new Map<string, boolean>();
    const m = new Map<string, boolean>();
    (group.overrides || [])
      .filter(o => o.domain_id === editScope)
      .forEach(o => m.set(o.feature_key, o.is_enabled));
    return m;
  }, [group.overrides, editScope, isGlobal]);

  const overriddenDomains = useMemo(() => {
    const ids = new Set<string>();
    (group.overrides || []).forEach(o => ids.add(o.domain_id));
    return ids;
  }, [group.overrides]);

  const editingOverride = isGlobal && editScope !== GLOBAL_GROUP_VALUE;

  const effectiveValue = (key: string) => {
    if (editingOverride && overridesForScope.has(key)) return overridesForScope.get(key)!;
    return isFeatureEnabled(group, key);
  };

  const handleToggle = async (key: string, value: boolean) => {
    if (!editingOverride) {
      await onToggleFeature(group.id, key, value);
      return;
    }
    setBusyKey(key);
    try {
      await onSetOverride(group.id, editScope, key, value);
    } finally {
      setBusyKey(null);
    }
  };

  const handleClearOverride = async (key: string) => {
    if (!editingOverride) return;
    setBusyKey(key);
    try {
      await onClearOverride(group.id, editScope, key);
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="p-4 rounded-lg border border-border bg-background space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <ShieldCheck className="w-5 h-5 text-primary" />
          <div>
            <p className="font-medium text-foreground">{group.name}</p>
            {group.description && <p className="text-sm text-muted-foreground">{group.description}</p>}
          </div>
          <Badge variant={group.domain_id ? 'default' : 'outline'} className="gap-1">
            <Globe className="w-3 h-3" /> {domainLabel(group.domain_id)}
          </Badge>
          <Badge variant="secondary" className="gap-1">
            <UsersIcon className="w-3 h-3" /> {group.member_count} {group.member_count === 1 ? 'member' : 'members'}
          </Badge>
          {isGlobal && overriddenDomains.size > 0 && (
            <Badge variant="outline" className="text-amber-600 border-amber-500/40">
              {overriddenDomains.size} domain {overriddenDomains.size === 1 ? 'override' : 'overrides'}
            </Badge>
          )}
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
              <Trash2 className="w-4 h-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete group?</AlertDialogTitle>
              <AlertDialogDescription>
                All {group.member_count} member(s) will lose any features granted by this group. Per-user grants are kept.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => onDelete(group.id)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* Scope selector — only for global groups */}
      {isGlobal && domains.length > 0 && (
        <div className="flex items-center gap-2 pt-1">
          <Label className="text-xs text-muted-foreground whitespace-nowrap">Configure for:</Label>
          <Select value={editScope} onValueChange={setEditScope}>
            <SelectTrigger className="h-8 w-[240px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={GLOBAL_GROUP_VALUE}>All domains (global default)</SelectItem>
              {domains.map(d => (
                <SelectItem key={d.id} value={d.id}>
                  @{d.domain}
                  {overriddenDomains.has(d.id) ? ' · customized' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {editingOverride && (
            <span className="text-xs text-muted-foreground">
              Changes here apply only to <span className="font-medium">@{domainLabel(editScope)}</span>.
            </span>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 pt-2 border-t border-border/50">
        {FEATURE_KEYS.map(feat => {
          const enabled = effectiveValue(feat.key);
          const overridden = editingOverride && overridesForScope.has(feat.key);
          const busy = busyKey === feat.key;
          return (
            <div
              key={feat.key}
              className={`flex items-center justify-between gap-2 p-2 rounded-md ${
                overridden ? 'bg-amber-500/10 ring-1 ring-amber-500/30' : 'bg-muted/30'
              }`}
            >
              <div className="min-w-0">
                <p className="text-xs font-medium text-foreground">{feat.label}</p>
                {overridden && (
                  <p className="text-[10px] text-amber-700 dark:text-amber-400">Overridden for this domain</p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {overridden && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    title="Reset to global default"
                    disabled={busy}
                    onClick={() => handleClearOverride(feat.key)}
                  >
                    <RotateCcw className="w-3 h-3" />
                  </Button>
                )}
                {busy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                ) : (
                  <Switch
                    checked={enabled}
                    onCheckedChange={(v) => handleToggle(feat.key, v)}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
