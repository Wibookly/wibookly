import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Crown, ShieldCheck, User as UserIcon, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/lib/auth';

type RoleChoice = 'super_admin' | 'org_admin' | 'standard';

const SUPER_ADMIN_EMAIL = 'arahimi@energyforward.com';

interface Props {
  userId: string;
  userEmail: string;
  organizationId: string;
}

export default function RoleInlinePicker({ userId, userEmail, organizationId }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [current, setCurrent] = useState<RoleChoice>('standard');
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  const iAmSuper = (user?.email ?? '').toLowerCase() === SUPER_ADMIN_EMAIL;
  const targetIsSuper = userEmail.toLowerCase() === SUPER_ADMIN_EMAIL;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (targetIsSuper) { setCurrent('super_admin'); return; }
      const { data } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .eq('organization_id', organizationId);
      if (cancelled) return;
      const roles = (data ?? []).map((r: any) => String(r.role));
      if (roles.includes('org_admin') || roles.includes('admin')) setCurrent('org_admin');
      else setCurrent('standard');
    })();
    return () => { cancelled = true; };
  }, [userId, organizationId, targetIsSuper]);

  const setRole = async (next: RoleChoice) => {
    if (next === 'super_admin' || targetIsSuper) return;
    if (next === 'org_admin' && !iAmSuper) {
      toast({ title: 'Only Super Admin can grant Org Admin', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await supabase
        .from('user_roles')
        .delete()
        .eq('user_id', userId)
        .eq('organization_id', organizationId)
        .in('role', ['admin', 'org_admin']);
      if (next === 'org_admin') {
        const { error } = await supabase
          .from('user_roles')
          .insert({ user_id: userId, organization_id: organizationId, role: 'org_admin', departments: [] });
        if (error) throw error;
      }
      setCurrent(next);
      toast({ title: 'Role updated' });
      setOpen(false);
    } catch (e: any) {
      toast({ title: 'Failed to update role', description: e?.message ?? String(e), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const label =
    current === 'super_admin' ? 'Super Admin' :
    current === 'org_admin' ? 'Org Admin' : 'Standard User';
  const Icon =
    current === 'super_admin' ? Crown :
    current === 'org_admin' ? ShieldCheck : UserIcon;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 h-7" disabled={targetIsSuper}>
          <Icon className="w-3 h-3" />
          <span className="text-xs">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1.5" align="end">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground px-2 py-1">Assign role</div>
        <RoleOption icon={<Crown className="w-3.5 h-3.5" />} label="Super Admin" active={current === 'super_admin'} disabled note="Locked to arahimi@energyforward.com" onClick={() => {}} />
        <RoleOption icon={<ShieldCheck className="w-3.5 h-3.5" />} label="Org Admin" active={current === 'org_admin'} disabled={!iAmSuper || saving} note={iAmSuper ? undefined : 'Super Admin only'} onClick={() => setRole('org_admin')} />
        <RoleOption icon={<UserIcon className="w-3.5 h-3.5" />} label="Standard User" active={current === 'standard'} disabled={saving} onClick={() => setRole('standard')} />
        {saving && <div className="px-2 py-1 text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Saving…</div>}
      </PopoverContent>
    </Popover>
  );
}

function RoleOption({ icon, label, active, disabled, note, onClick }: {
  icon: React.ReactNode; label: string; active: boolean; disabled?: boolean; note?: string; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full text-left px-2 py-1.5 rounded-md text-sm flex items-center gap-2 ${
        active ? 'bg-primary/10 text-primary' : 'hover:bg-muted'
      } disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      {icon}
      <span className="flex-1">
        {label}
        {note && <div className="text-[10px] text-muted-foreground">{note}</div>}
      </span>
      {active && <Badge variant="secondary" className="text-[10px] h-4">Current</Badge>}
    </button>
  );
}
