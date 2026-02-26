import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Plus, Trash2, Globe, Users, Shield, BarChart3, Settings } from 'lucide-react';

interface AllowedDomain {
  id: string;
  domain: string;
  organization_name: string | null;
  is_active: boolean;
  max_users: number;
  created_at: string;
}

interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  created_at: string;
  organization_id: string;
}

export default function AdminDashboard() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [domains, setDomains] = useState<AllowedDomain[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [newDomain, setNewDomain] = useState('');
  const [newOrgName, setNewOrgName] = useState('');
  const [addingDomain, setAddingDomain] = useState(false);
  const [stats, setStats] = useState({ totalUsers: 0, totalDomains: 0, activeConnections: 0 });

  const isSuperAdmin = profile?.email?.toLowerCase() === 'arahimi@energyforward.com';

  useEffect(() => {
    if (isSuperAdmin) {
      fetchData();
    }
  }, [isSuperAdmin]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch allowed domains
      const { data: domainsData } = await supabase
        .from('allowed_domains')
        .select('*')
        .order('created_at', { ascending: false });

      if (domainsData) setDomains(domainsData as AllowedDomain[]);

      // Get stats using RPC or direct queries
      setStats({
        totalDomains: domainsData?.length || 0,
        totalUsers: 0, // Will be populated if we add user listing
        activeConnections: 0,
      });
    } catch (error) {
      console.error('Error fetching admin data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddDomain = async () => {
    if (!newDomain.trim()) return;

    const domain = newDomain.trim().toLowerCase();
    // Basic domain validation
    if (!/^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,}$/.test(domain)) {
      toast({ title: 'Invalid domain', description: 'Please enter a valid domain (e.g., company.com)', variant: 'destructive' });
      return;
    }

    setAddingDomain(true);
    try {
      const { error } = await supabase
        .from('allowed_domains')
        .insert({
          domain,
          organization_name: newOrgName.trim() || null,
          is_active: true,
        });

      if (error) {
        if (error.code === '23505') {
          toast({ title: 'Domain exists', description: 'This domain is already in the list.', variant: 'destructive' });
        } else {
          throw error;
        }
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
      const { error } = await supabase
        .from('allowed_domains')
        .update({ is_active: !isActive })
        .eq('id', id);

      if (error) throw error;
      fetchData();
      toast({ title: isActive ? 'Domain disabled' : 'Domain enabled' });
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const handleDeleteDomain = async (id: string, domain: string) => {
    if (!confirm(`Are you sure you want to remove ${domain}? Users from this domain will no longer be able to sign up.`)) return;

    try {
      const { error } = await supabase
        .from('allowed_domains')
        .delete()
        .eq('id', id);

      if (error) throw error;
      fetchData();
      toast({ title: 'Domain removed', description: `${domain} has been removed.` });
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
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
            <CardDescription>
              You do not have administrator privileges to access this page.
            </CardDescription>
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
        <p className="text-muted-foreground mt-1">Manage domains, users, and system settings</p>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <Globe className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.totalDomains}</p>
                <p className="text-sm text-muted-foreground">Authorized Domains</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <Users className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{domains.reduce((sum, d) => sum + (d.max_users || 50), 0)}</p>
                <p className="text-sm text-muted-foreground">Max Users (Total)</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <Shield className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">Active</p>
                <p className="text-sm text-muted-foreground">System Status</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="domains">
        <TabsList>
          <TabsTrigger value="domains" className="gap-2">
            <Globe className="w-4 h-4" /> Domains
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-2">
            <Settings className="w-4 h-4" /> Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="domains" className="space-y-6">
          {/* Add Domain */}
          <Card>
            <CardHeader>
              <CardTitle>Add Authorized Domain</CardTitle>
              <CardDescription>
                Allow users from a specific email domain to sign up and use the platform
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1 space-y-1">
                  <Label htmlFor="domain">Domain</Label>
                  <Input
                    id="domain"
                    placeholder="company.com"
                    value={newDomain}
                    onChange={(e) => setNewDomain(e.target.value)}
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <Label htmlFor="orgName">Organization Name (optional)</Label>
                  <Input
                    id="orgName"
                    placeholder="Company Inc."
                    value={newOrgName}
                    onChange={(e) => setNewOrgName(e.target.value)}
                  />
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

          {/* Domain List */}
          <Card>
            <CardHeader>
              <CardTitle>Authorized Domains</CardTitle>
              <CardDescription>
                Users with email addresses from these domains can sign up
              </CardDescription>
            </CardHeader>
            <CardContent>
              {domains.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No domains configured yet</p>
              ) : (
                <div className="space-y-3">
                  {domains.map((domain) => (
                    <div
                      key={domain.id}
                      className="flex items-center justify-between p-4 rounded-lg border border-border bg-background"
                    >
                      <div className="flex items-center gap-3">
                        <Globe className="w-5 h-5 text-muted-foreground" />
                        <div>
                          <p className="font-medium text-foreground">{domain.domain}</p>
                          {domain.organization_name && (
                            <p className="text-sm text-muted-foreground">{domain.organization_name}</p>
                          )}
                        </div>
                        <Badge variant={domain.is_active ? 'default' : 'secondary'}>
                          {domain.is_active ? 'Active' : 'Disabled'}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleToggleDomain(domain.id, domain.is_active)}
                        >
                          {domain.is_active ? 'Disable' : 'Enable'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteDomain(domain.id, domain.domain)}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>System Settings</CardTitle>
              <CardDescription>Configure global platform settings</CardDescription>
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
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
