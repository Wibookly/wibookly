import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useUserRoles } from '@/hooks/useUserRoles';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Building, Save } from 'lucide-react';
import { toast } from 'sonner';
import { PageHero } from '@/components/app/PageHero';
import { OrgEnvironmentCard } from '@/components/admin/OrgEnvironmentCard';


interface OrgRow { user_id: string; email: string; full_name: string | null; title: string | null; roles: string[]; }

const ROLE_OPTIONS = [
  { value: 'org_admin', label: 'Org Admin' },
  { value: 'admin', label: 'Admin' },
  { value: 'dept_admin', label: 'Department Admin' },
  { value: 'member', label: 'Member' },
];

export default function OrgAdmin() {
  const navigate = useNavigate();
  const { profile, organization } = useAuth();
  const { isOrgAdmin, loading } = useUserRoles();
  const [users, setUsers] = useState<OrgRow[]>([]);
  const [org, setOrg] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!loading && !isOrgAdmin) navigate('/admin', { replace: true });
  }, [loading, isOrgAdmin, navigate]);

  const load = async () => {
    const [uRes, oRes] = await Promise.all([
      supabase.rpc('org_admin_list_users'),
      supabase.from('organizations')
        .select('id, name, legal_name, address_street, address_city, address_state, address_zip, address_country, phone, contact_email, logo_url, status, plan_id, environment_type')
        .eq('id', organization?.id ?? profile?.organization_id ?? '')
        .maybeSingle(),
    ]);
    if (uRes.data) setUsers(uRes.data as any);
    if (oRes.data) setOrg(oRes.data);
  };

  useEffect(() => { if (isOrgAdmin) load(); /* eslint-disable-next-line */ }, [isOrgAdmin]);

  const updateRole = async (userId: string, role: string) => {
    const { error } = await supabase.rpc('org_admin_set_user_role', { _target_user: userId, _role: role });
    if (error) { toast.error(error.message); return; }
    toast.success('Role updated');
    load();
  };

  const saveOrg = async () => {
    if (!org?.id) return;
    setSaving(true);
    // Strip immutable fields (plan_id, status) — guard trigger blocks these for non-super
    const { plan_id, status, id, environment_type, ...payload } = org;
    const { error } = await supabase.from('organizations').update(payload).eq('id', id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Organization profile saved');
  };

  if (loading) return <div className="p-8">Loading…</div>;
  if (!isOrgAdmin) return null;

  return (
    <div className="p-6 space-y-6">
      <PageHero
        icon={<Building className="w-6 h-6" />}
        title="Org Admin"
        description="Manage users and your organization profile"
      />

      <Card>
        <CardHeader><CardTitle>Organization profile</CardTitle></CardHeader>
        <CardContent>
          {!org ? <div className="text-muted-foreground">Loading…</div> : (
            <div className="grid grid-cols-2 gap-3">
              <F label="Name"><Input value={org.name ?? ''} onChange={e => setOrg({ ...org, name: e.target.value })} /></F>
              <F label="Legal name"><Input value={org.legal_name ?? ''} onChange={e => setOrg({ ...org, legal_name: e.target.value })} /></F>
              <F label="Street" full><Input value={org.address_street ?? ''} onChange={e => setOrg({ ...org, address_street: e.target.value })} /></F>
              <F label="City"><Input value={org.address_city ?? ''} onChange={e => setOrg({ ...org, address_city: e.target.value })} /></F>
              <F label="State"><Input value={org.address_state ?? ''} onChange={e => setOrg({ ...org, address_state: e.target.value })} /></F>
              <F label="Zip"><Input value={org.address_zip ?? ''} onChange={e => setOrg({ ...org, address_zip: e.target.value })} /></F>
              <F label="Country"><Input value={org.address_country ?? ''} onChange={e => setOrg({ ...org, address_country: e.target.value })} /></F>
              <F label="Phone"><Input value={org.phone ?? ''} onChange={e => setOrg({ ...org, phone: e.target.value })} /></F>
              <F label="Contact email" full><Input value={org.contact_email ?? ''} onChange={e => setOrg({ ...org, contact_email: e.target.value })} /></F>
              <F label="Plan (read-only)"><Input value={org.plan_id ? 'Managed by Super Admin' : '—'} disabled /></F>
              <F label="Status (read-only)"><Input value={org.status} disabled /></F>
              <div className="col-span-2 flex justify-end">
                <Button onClick={saveOrg} disabled={saving}><Save className="w-4 h-4 mr-1" />{saving ? 'Saving…' : 'Save profile'}</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Users in your organization ({users.length})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead className="w-[200px]">Change role</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map(u => (
                <TableRow key={u.user_id}>
                  <TableCell>{u.full_name ?? '—'}</TableCell>
                  <TableCell>{u.email}</TableCell>
                  <TableCell>{u.title ?? '—'}</TableCell>
                  <TableCell className="space-x-1">
                    {(u.roles ?? []).map(r => <Badge key={r} variant="secondary">{r}</Badge>)}
                  </TableCell>
                  <TableCell>
                    <Select onValueChange={(v) => updateRole(u.user_id, v)}>
                      <SelectTrigger><SelectValue placeholder="Set role" /></SelectTrigger>
                      <SelectContent>
                        {ROLE_OPTIONS.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
              {users.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No users in your organization</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function F({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? 'col-span-2' : ''}>
      <Label className="text-xs">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
