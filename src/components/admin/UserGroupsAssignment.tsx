import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { PermissionGroup } from './PermissionGroupsPanel';

interface Props {
  userId: string;
  currentGroupIds: string[];
  groups: PermissionGroup[];
  invoke: (action: string, payload?: Record<string, unknown>) => Promise<any>;
  onChanged: () => void;
}

export default function UserGroupsAssignment({ userId, currentGroupIds, groups, invoke, onChanged }: Props) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<string[]>(currentGroupIds);

  const toggle = (id: string) => {
    setSelected(prev => prev[0] === id ? [] : [id]);
  };

  const save = async () => {
    setSaving(true);
    try {
      await invoke('set_user_groups', { user_id: userId, group_ids: selected });
      toast({ title: 'Groups updated' });
      onChanged();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const currentNames = currentGroupIds
    .map(id => groups.find(g => g.id === id)?.name)
    .filter(Boolean) as string[];

  return (
    <div className="pt-3 border-t border-border/50">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Assigned Plan</p>
        {currentNames.length === 0 ? (
          <span className="text-xs text-muted-foreground">No plan assigned</span>
        ) : (
          currentNames.slice(0, 1).map(name => (
            <Badge key={name} variant="secondary" className="gap-1">
              <ShieldCheck className="w-3 h-3" /> {name}
            </Badge>
          ))
        )}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">Manage plan</Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 space-y-2" align="end">
            {groups.length === 0 ? (
              <p className="text-sm text-muted-foreground">No plans available. Create one in the Plans tab.</p>
            ) : (
              <>
                {groups.map(g => (
                  <div key={g.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`grp-${userId}-${g.id}`}
                      checked={selected.includes(g.id)}
                      onCheckedChange={() => toggle(g.id)}
                    />
                    <Label htmlFor={`grp-${userId}-${g.id}`} className="text-sm cursor-pointer flex-1">
                      {g.name}
                    </Label>
                  </div>
                ))}
                <Button onClick={save} disabled={saving} size="sm" className="w-full mt-2">
                  {saving ? <Loader2 className="w-3 h-3 animate-spin mr-2" /> : null}
                  Save
                </Button>
              </>
            )}
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
