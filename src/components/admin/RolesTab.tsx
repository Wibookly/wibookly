import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Loader2, ShieldCheck, Crown, Building, User as UserIcon } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';

type RoleKind = 'super_admin' | 'org_admin' | 'dept_admin' | 'member';

interface OrgUser {
  user_id: string;
  email: string;
  full_name: string | null;
  department: string | null;
  roles: string[];
  departments_admin: string[];
}

interface ClientStatusRow {
  user_id: string;
  browser_name: string | null;
  browser_version: string | null;
  os_name: string | null;
  device_type: string | null;
  tts_state: 'ready' | 'loading' | 'error' | 'unused' | string;
  tts_error: string | null;
  last_seen_at: string | null;
}

const SUPER_ADMIN_EMAIL = 'arahimi@energyforward.com';

export default function RolesTab() {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [editTarget, setEditTarget] = useState<OrgUser | null>(null);

  const isSuper = (user?.email ?? '').toLowerCase() === SUPER_ADMIN_EMAIL;

  const load = async () => {
    if (!profile?.organization_id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_list_org_users', {
        _organization_id: profile.organization_id,
      });
      if (error) throw error;
      setUsers((data ?? []) as OrgUser[]);
    } catch (e: any) {
      toast({ title: 'Failed to load users', description: e?.message ?? String(e), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [profile?.organization_id]);

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return users;
    return users.filter((u) =>
      u.email.toLowerCase().includes(f) ||
      (u.full_name ?? '').toLowerCase().includes(f) ||
      (u.department ?? '').toLowerCase().includes(f),
    );
  }, [users, filter]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="w-5 h-5 text-primary" /> Admin Roles
          </CardTitle>
          <CardDescription>
            Grant elevated access to teammates. <strong>Org Admin</strong> sees the entire organization;{' '}
            <strong>Department Admin</strong> only sees users in their assigned departments.
            Only the Super Admin can grant Org Admin.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Input
            placeholder="Search by name, email, or department…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="max-w-md"
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 overflow-x-auto">
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-border text-xs uppercase text-muted-foreground">
                  <th className="py-2 pr-3">User</th>
                  <th className="py-2 pr-3">Department</th>
                  <th className="py-2 pr-3">Roles</th>
                  <th className="py-2 pr-3">Dept-admin scope</th>
                  <th className="py-2 pr-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">No users found.</td></tr>
                ) : filtered.map((u) => (
                  <tr key={u.user_id} className="border-b border-border/40">
                    <td className="py-3 pr-3">
                      <div className="font-medium">{u.full_name || u.email}</div>
                      {u.full_name && <div className="text-xs text-muted-foreground">{u.email}</div>}
                    </td>
                    <td className="py-3 pr-3 text-muted-foreground">{u.department || '—'}</td>
                    <td className="py-3 pr-3">
                      <div className="flex gap-1 flex-wrap">
                        {u.email.toLowerCase() === SUPER_ADMIN_EMAIL && (
                          <Badge variant="default" className="gap-1"><Crown className="w-3 h-3" /> Super Admin</Badge>
                        )}
                        {u.roles.includes('org_admin') || u.roles.includes('admin') ? (
                          <Badge variant="secondary" className="gap-1"><ShieldCheck className="w-3 h-3" /> Org Admin</Badge>
                        ) : null}
                        {u.roles.includes('dept_admin') && (
                          <Badge variant="outline" className="gap-1"><Building className="w-3 h-3" /> Dept Admin</Badge>
                        )}
                        {u.roles.length === 0 && (
                          <Badge variant="outline" className="gap-1 text-muted-foreground"><UserIcon className="w-3 h-3" /> Member</Badge>
                        )}
                      </div>
                    </td>
                    <td className="py-3 pr-3 text-xs text-muted-foreground">
                      {u.departments_admin.length > 0 ? u.departments_admin.join(', ') : '—'}
                    </td>
                    <td className="py-3 pr-3 text-right">
                      <Button size="sm" variant="outline" onClick={() => setEditTarget(u)}>
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {editTarget && (
        <EditRoleDialog
          user={editTarget}
          organizationId={profile!.organization_id}
          isSuper={isSuper}
          allDepartments={Array.from(new Set(users.map((u) => u.department).filter(Boolean) as string[])).sort()}
          onClose={() => setEditTarget(null)}
          onSaved={() => { setEditTarget(null); load(); }}
        />
      )}
    </div>
  );
}

function EditRoleDialog({
  user, organizationId, isSuper, allDepartments, onClose, onSaved,
}: {
  user: OrgUser;
  organizationId: string;
  isSuper: boolean;
  allDepartments: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const initialOrgAdmin = user.roles.includes('org_admin') || user.roles.includes('admin');
  const initialDeptAdmin = user.roles.includes('dept_admin');
  const [orgAdmin, setOrgAdmin] = useState(initialOrgAdmin);
  const [deptAdmin, setDeptAdmin] = useState(initialDeptAdmin);
  const [scopes, setScopes] = useState<string[]>(user.departments_admin);

  const toggleScope = (d: string) =>
    setScopes((s) => (s.includes(d) ? s.filter((x) => x !== d) : [...s, d]));

  const save = async () => {
    setSaving(true);
    try {
      // Wipe existing admin/org_admin/dept_admin rows for this user+org so the
      // new selections are authoritative.
      const { error: delErr } = await supabase
        .from('user_roles')
        .delete()
        .eq('user_id', user.user_id)
        .eq('organization_id', organizationId)
        .in('role', ['admin', 'org_admin', 'dept_admin']);
      if (delErr) throw delErr;

      const inserts: any[] = [];
      if (orgAdmin) {
        if (!isSuper) {
          throw new Error('Only the Super Admin can grant Org Admin.');
        }
        inserts.push({ user_id: user.user_id, organization_id: organizationId, role: 'org_admin', departments: [] });
      }
      if (deptAdmin) {
        if (scopes.length === 0) throw new Error('Pick at least one department for Dept Admin.');
        inserts.push({ user_id: user.user_id, organization_id: organizationId, role: 'dept_admin', departments: scopes });
      }
      if (inserts.length > 0) {
        const { error: insErr } = await supabase.from('user_roles').insert(inserts);
        if (insErr) throw insErr;
      }
      // Always ensure a member row exists.
      await supabase
        .from('user_roles')
        .insert({ user_id: user.user_id, organization_id: organizationId, role: 'member' })
        .then(() => undefined, () => undefined); // ignore unique conflicts
      toast({ title: 'Roles updated' });
      onSaved();
    } catch (e: any) {
      toast({ title: 'Failed to update roles', description: e?.message ?? String(e), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit roles — {user.full_name || user.email}</DialogTitle>
          <DialogDescription>{user.email}{user.department ? ` · ${user.department}` : ''}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <label className="flex items-start gap-3 p-3 rounded-lg border border-border cursor-pointer hover:bg-muted/40">
            <input
              type="checkbox"
              checked={orgAdmin}
              disabled={!isSuper}
              onChange={(e) => setOrgAdmin(e.target.checked)}
              className="mt-1"
            />
            <div>
              <div className="font-medium flex items-center gap-2">
                <ShieldCheck className="w-4 h-4" /> Org Admin
                {!isSuper && <span className="text-xs text-muted-foreground">(super admin only)</span>}
              </div>
              <div className="text-xs text-muted-foreground">Full access across the entire organization.</div>
            </div>
          </label>

          <label className="flex items-start gap-3 p-3 rounded-lg border border-border cursor-pointer hover:bg-muted/40">
            <input
              type="checkbox"
              checked={deptAdmin}
              onChange={(e) => setDeptAdmin(e.target.checked)}
              className="mt-1"
            />
            <div className="flex-1">
              <div className="font-medium flex items-center gap-2"><Building className="w-4 h-4" /> Department Admin</div>
              <div className="text-xs text-muted-foreground mb-2">Sees activity only for the selected departments.</div>
              {deptAdmin && (
                <div className="flex flex-wrap gap-2">
                  {allDepartments.length === 0 ? (
                    <span className="text-xs text-muted-foreground">No departments synced yet.</span>
                  ) : allDepartments.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleScope(d)}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                        scopes.includes(d)
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'border-border bg-background hover:bg-muted'
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
