import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Loader2, Plus, Trash2, Globe, Users, Shield, Settings, UserPlus, Ban, CheckCircle2 } from 'lucide-react';

const FEATURE_KEYS = [
  { key: 'ai_draft', label: 'AI Draft', description: 'AI-powered email draft generation' },
  { key: 'ai_auto_reply', label: 'AI Auto Reply', description: 'Automatic AI email replies' },
  { key: 'ai_assistant', label: 'AI Assistant', description: 'Daily Brief & AI Chat' },
  { key: 'reports', label: 'Reports', description: 'AI activity reports & analytics' },
] as const;

const AI_MODEL_KEYS = [
  { key: 'ai_model_chatgpt', label: 'ChatGPT', description: 'OpenAI ChatGPT model access' },
  { key: 'ai_model_claude', label: 'Claude', description: 'Anthropic Claude model access' },
] as const;

interface AllowedDomain {
  id: string;
  domain: string;
  organization_name: string | null;
  is_active: boolean;
  max_users: number;
  created_at: string;
}

interface UserFeature {
  user_id: string;
  feature_key: string;
  is_enabled: boolean;
}

interface ManagedUser {
  id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  created_at: string;
  organization_id: string;
  is_disabled: boolean;
  features: UserFeature[];
}

export default function AdminDashboard() {
  const { profile, session } = useAuth();
  const { toast } = useToast();
  const [domains, setDomains] = useState<AllowedDomain[]>([]);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [newDomain, setNewDomain] = useState('');
  const [newOrgName, setNewOrgName] = useState('');
  const [addingDomain, setAddingDomain] = useState(false);

  // New user form
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [creatingUser, setCreatingUser] = useState(false);

  const isSuperAdmin = profile?.email?.toLowerCase() === 'arahimi@energyforward.com';

  useEffect(() => {
    if (isSuperAdmin) {
      fetchData();
    }
  }, [isSuperAdmin]);

  const adminInvoke = async (action: string, payload: Record<string, any> = {}) => {
    const { data, error } = await supabase.functions.invoke('admin-api', {
      body: { action, ...payload },
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    return data;
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [domainsRes, usersRes] = await Promise.all([
        supabase.from('allowed_domains').select('*').order('created_at', { ascending: false }),
        adminInvoke('list_users'),
      ]);

      if (domainsRes.data) setDomains(domainsRes.data as AllowedDomain[]);
      if (usersRes?.users) setUsers(usersRes.users);
    } catch (error: any) {
      console.error('Error fetching admin data:', error);
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleAddDomain = async () => {
    if (!newDomain.trim()) return;
    const domain = newDomain.trim().toLowerCase();
    if (!/^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,}$/.test(domain)) {
      toast({ title: 'Invalid domain', description: 'Please enter a valid domain (e.g., company.com)', variant: 'destructive' });
      return;
    }
    setAddingDomain(true);
    try {
      const { error } = await supabase.from('allowed_domains').insert({
        domain, organization_name: newOrgName.trim() || null, is_active: true,
      });
      if (error) {
        if (error.code === '23505') toast({ title: 'Domain exists', description: 'This domain is already in the list.', variant: 'destructive' });
        else throw error;
      } else {
        toast({ title: 'Domain added', description: `${domain} has been authorized.` });
        setNewDomain('');
        setNewOrgName('');
        fetchData();
      }
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setAddingDomain(false);
    }
  };

  const handleToggleDomain = async (id: string, isActive: boolean) => {
    try {
      const { error } = await supabase.from('allowed_domains').update({ is_active: !isActive }).eq('id', id);
      if (error) throw error;
      fetchData();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const handleDeleteDomain = async (id: string, domain: string) => {
    try {
      const { error } = await supabase.from('allowed_domains').delete().eq('id', id);
      if (error) throw error;
      fetchData();
      toast({ title: 'Domain removed', description: `${domain} has been removed.` });
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const handleCreateUser = async () => {
    if (!newUserEmail || !newUserName || !newUserPassword) {
      toast({ title: 'Missing fields', description: 'All fields are required.', variant: 'destructive' });
      return;
    }
    if (newUserPassword.length < 8) {
      toast({ title: 'Weak password', description: 'Password must be at least 8 characters.', variant: 'destructive' });
      return;
    }
    setCreatingUser(true);
    try {
      await adminInvoke('create_user', {
        email: newUserEmail.trim().toLowerCase(),
        full_name: newUserName.trim(),
        password: newUserPassword,
      });
      toast({ title: 'User created', description: `${newUserEmail} has been created.` });
      setNewUserEmail('');
      setNewUserName('');
      setNewUserPassword('');
      fetchData();
    } catch (error: any) {
      toast({ title: 'Error creating user', description: error.message, variant: 'destructive' });
    } finally {
      setCreatingUser(false);
    }
  };

  const handleToggleUser = async (userId: string, isDisabled: boolean) => {
    try {
      await adminInvoke(isDisabled ? 'enable_user' : 'disable_user', { user_id: userId });
      toast({ title: isDisabled ? 'User enabled' : 'User disabled' });
      fetchData();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const handleDeleteUser = async (userId: string) => {
    try {
      await adminInvoke('delete_user', { user_id: userId });
      toast({ title: 'User deleted' });
      fetchData();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const handleToggleFeature = async (userId: string, featureKey: string, currentlyEnabled: boolean) => {
    try {
      await adminInvoke('set_feature', {
        user_id: userId,
        feature_key: featureKey,
        is_enabled: !currentlyEnabled,
      });
      // Optimistic update
      setUsers(prev => prev.map(u => {
        if (u.user_id !== userId) return u;
        const existing = u.features.find(f => f.feature_key === featureKey);
        if (existing) {
          return { ...u, features: u.features.map(f => f.feature_key === featureKey ? { ...f, is_enabled: !currentlyEnabled } : f) };
        }
        return { ...u, features: [...u.features, { user_id: userId, feature_key: featureKey, is_enabled: !currentlyEnabled }] };
      }));
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      fetchData(); // Revert on error
    }
  };

  const getUserFeatureEnabled = (user: ManagedUser, featureKey: string) => {
    const feature = user.features.find(f => f.feature_key === featureKey);
    return feature?.is_enabled ?? false;
  };

  if (!isSuperAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-destructive" />
              Access Denied
            </CardTitle>
            <CardDescription>You do not have administrator privileges.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Admin Dashboard</h1>
        <p className="text-muted-foreground mt-1">Manage users, domains, and feature access</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <Users className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{users.length}</p>
                <p className="text-sm text-muted-foreground">Total Users</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <Globe className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{domains.length}</p>
                <p className="text-sm text-muted-foreground">Authorized Domains</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{users.filter(u => !u.is_disabled).length}</p>
                <p className="text-sm text-muted-foreground">Active Users</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users" className="gap-2"><Users className="w-4 h-4" /> Users</TabsTrigger>
          <TabsTrigger value="domains" className="gap-2"><Globe className="w-4 h-4" /> Domains</TabsTrigger>
          <TabsTrigger value="settings" className="gap-2"><Settings className="w-4 h-4" /> Settings</TabsTrigger>
        </TabsList>

        {/* USERS TAB */}
        <TabsContent value="users" className="space-y-6">
          {/* Create User */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><UserPlus className="w-5 h-5" /> Create New User</CardTitle>
              <CardDescription>Create an account for a team member. Their domain must be authorized.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="newUserName">Full Name</Label>
                  <Input id="newUserName" placeholder="John Doe" value={newUserName} onChange={e => setNewUserName(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="newUserEmail">Email</Label>
                  <Input id="newUserEmail" type="email" placeholder="john@company.com" value={newUserEmail} onChange={e => setNewUserEmail(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="newUserPassword">Password</Label>
                  <Input id="newUserPassword" type="password" placeholder="Min 8 characters" value={newUserPassword} onChange={e => setNewUserPassword(e.target.value)} />
                </div>
              </div>
              <Button onClick={handleCreateUser} disabled={creatingUser} className="mt-4">
                {creatingUser ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <UserPlus className="w-4 h-4 mr-2" />}
                Create User
              </Button>
            </CardContent>
          </Card>

          {/* User List with Feature Toggles */}
          <Card>
            <CardHeader>
              <CardTitle>Team Members</CardTitle>
              <CardDescription>Manage user access and feature assignments</CardDescription>
            </CardHeader>
            <CardContent>
              {users.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No users yet</p>
              ) : (
                <div className="space-y-4">
                  {users.map(user => {
                    const isSelf = user.email.toLowerCase() === 'arahimi@energyforward.com';
                    return (
                      <div key={user.user_id} className="p-4 rounded-lg border border-border bg-background space-y-3">
                        {/* User Header */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                              {(user.full_name || user.email)[0]?.toUpperCase()}
                            </div>
                            <div>
                              <p className="font-medium text-foreground">{user.full_name || 'No name'}</p>
                              <p className="text-sm text-muted-foreground">{user.email}</p>
                            </div>
                            {isSelf && <Badge variant="default">Super Admin</Badge>}
                            {user.is_disabled && <Badge variant="destructive">Disabled</Badge>}
                          </div>
                          {!isSelf && (
                            <div className="flex items-center gap-2">
                              <Button variant="outline" size="sm" onClick={() => handleToggleUser(user.user_id, user.is_disabled)}>
                                {user.is_disabled ? <><CheckCircle2 className="w-4 h-4 mr-1" /> Enable</> : <><Ban className="w-4 h-4 mr-1" /> Disable</>}
                              </Button>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Delete user?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      This will permanently delete {user.email} and all their data. This cannot be undone.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => handleDeleteUser(user.user_id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                      Delete
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          )}
                        </div>

                        {/* Feature Toggles */}
                        {!isSelf && (
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2 border-t border-border/50">
                            {FEATURE_KEYS.map(feat => {
                              const enabled = getUserFeatureEnabled(user, feat.key);
                              return (
                                <div key={feat.key} className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted/30">
                                  <div>
                                    <p className="text-xs font-medium text-foreground">{feat.label}</p>
                                  </div>
                                  <Switch
                                    checked={enabled}
                                    onCheckedChange={() => handleToggleFeature(user.user_id, feat.key, enabled)}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {isSelf && (
                          <p className="text-xs text-muted-foreground pt-2 border-t border-border/50">
                            Super admin has access to all features.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* DOMAINS TAB */}
        <TabsContent value="domains" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Add Authorized Domain</CardTitle>
              <CardDescription>Allow users from a specific email domain to be added to the platform</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1 space-y-1">
                  <Label htmlFor="domain">Domain</Label>
                  <Input id="domain" placeholder="company.com" value={newDomain} onChange={e => setNewDomain(e.target.value)} />
                </div>
                <div className="flex-1 space-y-1">
                  <Label htmlFor="orgName">Organization Name (optional)</Label>
                  <Input id="orgName" placeholder="Company Inc." value={newOrgName} onChange={e => setNewOrgName(e.target.value)} />
                </div>
                <div className="flex items-end">
                  <Button onClick={handleAddDomain} disabled={addingDomain || !newDomain.trim()}>
                    {addingDomain ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                    Add Domain
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Authorized Domains</CardTitle>
            </CardHeader>
            <CardContent>
              {domains.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No domains configured yet</p>
              ) : (
                <div className="space-y-3">
                  {domains.map(domain => (
                    <div key={domain.id} className="flex items-center justify-between p-4 rounded-lg border border-border bg-background">
                      <div className="flex items-center gap-3">
                        <Globe className="w-5 h-5 text-muted-foreground" />
                        <div>
                          <p className="font-medium text-foreground">{domain.domain}</p>
                          {domain.organization_name && <p className="text-sm text-muted-foreground">{domain.organization_name}</p>}
                        </div>
                        <Badge variant={domain.is_active ? 'default' : 'secondary'}>{domain.is_active ? 'Active' : 'Disabled'}</Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => handleToggleDomain(domain.id, domain.is_active)}>
                          {domain.is_active ? 'Disable' : 'Enable'}
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive"><Trash2 className="w-4 h-4" /></Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remove domain?</AlertDialogTitle>
                              <AlertDialogDescription>Users from {domain.domain} will no longer be able to sign up.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDeleteDomain(domain.id, domain.domain)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                Remove
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* SETTINGS TAB */}
        <TabsContent value="settings" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>System Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 rounded-lg border border-border">
                <p className="font-medium text-foreground">Super Admin</p>
                <p className="text-sm text-muted-foreground">arahimi@energyforward.com</p>
              </div>
              <div className="p-4 rounded-lg border border-border">
                <p className="font-medium text-foreground">Authentication Methods</p>
                <div className="flex gap-2 mt-2">
                  <Badge>Email/Password</Badge>
                  <Badge>Microsoft SSO</Badge>
                  <Badge>Google OAuth</Badge>
                </div>
              </div>
              <div className="p-4 rounded-lg border border-border">
                <p className="font-medium text-foreground">Controllable Features</p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {FEATURE_KEYS.map(f => (
                    <Badge key={f.key} variant="outline">{f.label}</Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
