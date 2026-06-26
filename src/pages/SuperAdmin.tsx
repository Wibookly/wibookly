import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useUserRoles } from '@/hooks/useUserRoles';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Building2, Plus, Pause, Play, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { PageHero } from '@/components/app/PageHero';

interface OrgRow {
  id: string;
  name: string;
  legal_name: string | null;
  status: string;
  environment_type: string;
  plan_slug: string | null;
  plan_name: string | null;
  user_count: number;
  created_at: string;
}

interface Plan { id: string; slug: string; name: string }

const blankForm = {
  name: '', legal_name: '', address_street: '', address_city: '', address_state: '',
  address_zip: '', address_country: '', phone: '', contact_email: '',
  environment_type: 'none', plan_slug: 'starter', status: 'active',
  admin_invite_email: '', logo_url: '',
};

export default function SuperAdmin() {
  const navigate = useNavigate();
  const { isSuperAdmin, loading } = useUserRoles();
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...blankForm });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && !isSuperAdmin) navigate('/admin', { replace: true });
  }, [loading, isSuperAdmin, navigate]);

  const load = async () => {
    setRefreshing(true);
    const [orgRes, planRes] = await Promise.all([
      supabase.rpc('admin_list_organizations'),
      supabase.from('plans').select('id, slug, name').order('display_order'),
    ]);
    if (orgRes.error) toast.error(orgRes.error.message);
    if (orgRes.data) setOrgs(orgRes.data as any);
    if (planRes.data) setPlans(planRes.data as any);
    setRefreshing(false);
  };

  useEffect(() => { if (isSuperAdmin) load(); /* eslint-disable-next-line */ }, [isSuperAdmin]);

  const handleLogoUpload = async (file: File) => {
    const path = `org-logos/${crypto.randomUUID()}-${file.name}`;
    const { data, error } = await supabase.storage.from('company-logos').upload(path, file, { upsert: true });
    if (error) { toast.error('Logo upload failed: ' + error.message); return; }
    const { data: pub } = supabase.storage.from('company-logos').getPublicUrl(data.path);
    setForm(f => ({ ...f, logo_url: pub.publicUrl }));
    toast.success('Logo uploaded');
  };

  const submit = async () => {
    if (!form.name.trim()) { toast.error('Organization name required'); return; }
    setSubmitting(true);
    const { data, error } = await supabase.rpc('admin_create_organization', {
      _name: form.name,
      _legal_name: form.legal_name || null,
      _address_street: form.address_street || null,
      _address_city: form.address_city || null,
      _address_state: form.address_state || null,
      _address_zip: form.address_zip || null,
      _address_country: form.address_country || null,
      _phone: form.phone || null,
      _contact_email: form.contact_email || null,
      _logo_url: form.logo_url || null,
      _environment_type: form.environment_type,
      _plan_slug: form.plan_slug,
      _status: form.status,
      _admin_invite_email: form.admin_invite_email || null,
    });
    setSubmitting(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Organization created' + (form.admin_invite_email ? ' and admin invitation queued' : ''));
    setOpen(false);
    setForm({ ...blankForm });
    load();
    console.log('Created org:', data);
  };

  const toggleStatus = async (org: OrgRow) => {
    const next = org.status === 'active' ? 'suspended' : 'active';
    const { error } = await supabase.rpc('admin_set_org_status', { _org_id: org.id, _status: next });
    if (error) { toast.error(error.message); return; }
    toast.success(`Organization ${next}`);
    load();
  };

  if (loading) return <div className="p-8">Loading…</div>;
  if (!isSuperAdmin) return null;

  return (
    <div className="p-6 space-y-6">
      <PageHero
        icon={Building2}
        title="Super Admin"
        subtitle="Platform-level management across all organizations"
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Organizations ({orgs.length})</CardTitle>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="w-4 h-4 mr-1" />Create Organization</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Create Organization</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-3 py-2">
                <Field label="Organization name *"><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
                <Field label="Legal name"><Input value={form.legal_name} onChange={e => setForm({ ...form, legal_name: e.target.value })} /></Field>
                <Field label="Street" full><Input value={form.address_street} onChange={e => setForm({ ...form, address_street: e.target.value })} /></Field>
                <Field label="City"><Input value={form.address_city} onChange={e => setForm({ ...form, address_city: e.target.value })} /></Field>
                <Field label="State / Province"><Input value={form.address_state} onChange={e => setForm({ ...form, address_state: e.target.value })} /></Field>
                <Field label="Zip / Postal"><Input value={form.address_zip} onChange={e => setForm({ ...form, address_zip: e.target.value })} /></Field>
                <Field label="Country"><Input value={form.address_country} onChange={e => setForm({ ...form, address_country: e.target.value })} /></Field>
                <Field label="Phone"><Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></Field>
                <Field label="Contact email"><Input type="email" value={form.contact_email} onChange={e => setForm({ ...form, contact_email: e.target.value })} /></Field>
                <Field label="Environment">
                  <Select value={form.environment_type} onValueChange={v => setForm({ ...form, environment_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="microsoft">Microsoft 365</SelectItem>
                      <SelectItem value="google">Google Workspace</SelectItem>
                      <SelectItem value="none">None</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Plan">
                  <Select value={form.plan_slug} onValueChange={v => setForm({ ...form, plan_slug: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {plans.map(p => <SelectItem key={p.id} value={p.slug}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Status">
                  <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="suspended">Suspended</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Logo (PNG/SVG)" full>
                  <div className="flex items-center gap-3">
                    <Input type="file" accept="image/*" onChange={e => e.target.files?.[0] && handleLogoUpload(e.target.files[0])} />
                    {form.logo_url && <img src={form.logo_url} alt="logo" className="h-10 w-10 object-contain rounded border" />}
                  </div>
                </Field>
                <Field label="Org Admin invite email" full>
                  <Input type="email" placeholder="admin@neworg.com" value={form.admin_invite_email} onChange={e => setForm({ ...form, admin_invite_email: e.target.value })} />
                  <p className="text-xs text-muted-foreground mt-1">If provided, an org_admin invitation will be created for this email.</p>
                </Field>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={submit} disabled={submitting}>{submitting ? 'Creating…' : 'Create'}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Environment</TableHead>
                <TableHead className="text-right">Users</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orgs.map(o => (
                <TableRow key={o.id}>
                  <TableCell>
                    <div className="font-medium">{o.name}</div>
                    {o.legal_name && <div className="text-xs text-muted-foreground">{o.legal_name}</div>}
                  </TableCell>
                  <TableCell>{o.plan_name ?? '—'}</TableCell>
                  <TableCell><Badge variant={o.status === 'active' ? 'default' : 'secondary'}>{o.status}</Badge></TableCell>
                  <TableCell className="capitalize">{o.environment_type}</TableCell>
                  <TableCell className="text-right">{Number(o.user_count)}</TableCell>
                  <TableCell>{new Date(o.created_at).toLocaleDateString()}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => toggleStatus(o)}>
                      {o.status === 'active'
                        ? <><Pause className="w-3 h-3 mr-1" />Suspend</>
                        : <><Play className="w-3 h-3 mr-1" />Reactivate</>}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {orgs.length === 0 && !refreshing && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No organizations</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? 'col-span-2' : ''}>
      <Label className="text-xs">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
