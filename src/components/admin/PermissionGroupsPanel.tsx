import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Loader2, Plus, Trash2, ShieldCheck, Users as UsersIcon, Globe } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const FEATURE_KEYS = [
  { key: 'ai_draft', label: 'AI Draft' },
  { key: 'ai_auto_reply', label: 'AI Auto Reply' },
  { key: 'ai_assistant', label: 'AI Assistant' },
  { key: 'reports', label: 'Reports' },
  { key: 'ai_model_chatgpt', label: 'ChatGPT Model' },
  { key: 'ai_model_claude', label: 'Claude Model' },
] as const;

const GLOBAL_GROUP_VALUE = '__global__';

export interface PermissionGroup {
  id: string;
  name: string;
  description: string | null;
  organization_id: string;
  domain_id: string | null;
  features: { feature_key: string; is_enabled: boolean }[];
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
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [domainId, setDomainId] = useState<string>(GLOBAL_GROUP_VALUE);
  const [filterDomain, setFilterDomain] = useState<string>('all');
  const [creating, setCreating] = useState(false);

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

  const visibleGroups = filterDomain === 'all'
    ? groups
    : filterDomain === GLOBAL_GROUP_VALUE
      ? groups.filter(g => !g.domain_id)
      : groups.filter(g => g.domain_id === filterDomain);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Plus className="w-5 h-5" /> Create Permission Group</CardTitle>
          <CardDescription>
            Bundle features together (e.g. Standard, Power User, Executive) and scope each group to a specific authorized domain — or leave it global to apply across all domains.
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
              <CardDescription>Toggle which features each group grants. Changes apply immediately to all members.</CardDescription>
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
                <div key={group.id} className="p-4 rounded-lg border border-border bg-background space-y-3">
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
                          <AlertDialogAction onClick={() => handleDelete(group.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 pt-2 border-t border-border/50">
                    {FEATURE_KEYS.map(feat => {
                      const enabled = isFeatureEnabled(group, feat.key);
                      return (
                        <div key={feat.key} className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted/30">
                          <p className="text-xs font-medium text-foreground">{feat.label}</p>
                          <Switch checked={enabled} onCheckedChange={(v) => handleToggleFeature(group.id, feat.key, v)} />
                        </div>
                      );
                    })}
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
