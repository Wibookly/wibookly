import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Loader2, Plus, Trash2, ShieldCheck, Users as UsersIcon } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const FEATURE_KEYS = [
  { key: 'ai_draft', label: 'AI Draft' },
  { key: 'ai_auto_reply', label: 'AI Auto Reply' },
  { key: 'ai_assistant', label: 'AI Assistant' },
  { key: 'reports', label: 'Reports' },
  { key: 'ai_model_chatgpt', label: 'ChatGPT Model' },
  { key: 'ai_model_claude', label: 'Claude Model' },
] as const;

export interface PermissionGroup {
  id: string;
  name: string;
  description: string | null;
  organization_id: string;
  features: { feature_key: string; is_enabled: boolean }[];
  member_count: number;
}

interface Props {
  organizationId: string | null;
  invoke: (action: string, payload?: Record<string, unknown>) => Promise<any>;
  groups: PermissionGroup[];
  onChanged: () => void;
}

export default function PermissionGroupsPanel({ organizationId, invoke, groups, onChanged }: Props) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!name.trim() || !organizationId) return;
    setCreating(true);
    try {
      await invoke('create_group', { name: name.trim(), description: description.trim() || null, organization_id: organizationId });
      toast({ title: 'Group created', description: `${name} is ready to configure.` });
      setName('');
      setDescription('');
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

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Plus className="w-5 h-5" /> Create Permission Group</CardTitle>
          <CardDescription>Bundle features together (e.g. Standard, Power User, Executive) and assign users to groups instead of toggling features one-by-one.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="group-name">Group name</Label>
              <Input id="group-name" placeholder="Power User" value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="group-desc">Description (optional)</Label>
              <Input id="group-desc" placeholder="Has AI drafting and auto-reply" value={description} onChange={e => setDescription(e.target.value)} />
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
          <CardTitle>Groups</CardTitle>
          <CardDescription>Toggle which features each group grants. Changes apply immediately to all members.</CardDescription>
        </CardHeader>
        <CardContent>
          {groups.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No groups yet. Create one above.</p>
          ) : (
            <div className="space-y-4">
              {groups.map(group => (
                <div key={group.id} className="p-4 rounded-lg border border-border bg-background space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-3">
                      <ShieldCheck className="w-5 h-5 text-primary" />
                      <div>
                        <p className="font-medium text-foreground">{group.name}</p>
                        {group.description && <p className="text-sm text-muted-foreground">{group.description}</p>}
                      </div>
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
