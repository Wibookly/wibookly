import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Loader2, Users, RefreshCw, Send, Search, CheckCircle2, Mail, UserCheck,
  Pause, Play, Trash2, UsersRound,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import RoleInlinePicker from './RoleInlinePicker';

interface DiscoveredUser {
  id: string;
  domain_id: string;
  organization_id: string;
  email: string;
  display_name: string | null;
  job_title: string | null;
  department: string | null;
  office_location?: string | null;
  profile_photo_url?: string | null;
  is_licensed: boolean;
  account_enabled: boolean;
  status: 'discovered' | 'invited' | 'active' | string;
  invited_user_id: string | null;
  invited_at: string | null;
  last_seen_at: string;
  /** True when this user has been provisioned but their auth account is currently banned (suspended in app). */
  app_disabled?: boolean;
  /** Single permission group id assigned to the user, if any. */
  group_ids?: string[];
}

interface PermissionGroup {
  id: string;
  name: string;
  description: string | null;
  organization_id: string;
  /** When set, this group only applies to that specific domain. NULL = global (hidden in this picker). */
  domain_id: string | null;
}

interface DomainOption {
  id: string;
  domain: string;
  organization_name: string | null;
  microsoft_tenant_id: string | null;
  microsoft_consent_granted: boolean;
}

interface Props {
  invoke: (action: string, payload?: Record<string, any>) => Promise<any>;
  domains: DomainOption[];
  initialDomainId?: string | null;
  autoSyncNonce?: number;
}

export default function DiscoveredUsersPanel({ invoke, domains, initialDomainId = null, autoSyncNonce = 0 }: Props) {
  const { toast } = useToast();
  const consentedDomains = domains.filter((d) => d.microsoft_consent_granted && d.microsoft_tenant_id);
  const [selectedDomainId, setSelectedDomainId] = useState<string>('');
  const [users, setUsers] = useState<DiscoveredUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState('');
  const [actingId, setActingId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<DiscoveredUser | null>(null);
  const [groups, setGroups] = useState<PermissionGroup[]>([]);
  const [groupsBusyId, setGroupsBusyId] = useState<string | null>(null);
  const [cleanupStatus, setCleanupStatus] = useState<{ open: boolean; title: string; description: string }>({
    open: false,
    title: '',
    description: '',
  });

  useEffect(() => {
    if (initialDomainId && initialDomainId !== selectedDomainId) {
      setSelectedDomainId(initialDomainId);
    }
  }, [initialDomainId, selectedDomainId]);

  // Auto-pick the first consented domain so admins land somewhere useful.
  useEffect(() => {
    if (!selectedDomainId && consentedDomains.length > 0) {
      setSelectedDomainId(consentedDomains[0].id);
    }
  }, [consentedDomains, selectedDomainId]);

  const loadUsers = async (domainId: string) => {
    if (!domainId) return;
    setLoading(true);
    try {
      const res = await invoke('list_discovered_users', { domain_id: domainId });
      setUsers(res?.users || []);
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // Load all permission groups so admins can assign discovered users inline.
  const loadGroups = async () => {
    try {
      const res = await invoke('list_groups');
      setGroups(res?.groups || []);
    } catch (e: any) {
      // Non-fatal — picker will just show "No groups available".
      console.warn('Failed to load groups', e);
    }
  };

  useEffect(() => {
    void loadGroups();
  }, []);

  // Replace the user's single group membership.
  const handleSetGroups = async (u: DiscoveredUser, newGroupIds: string[]) => {
    if (!u.invited_user_id) return;
    const normalized = newGroupIds.slice(0, 1);
    const prev = u.group_ids || [];
    setUsers((list) => list.map((x) => (x.id === u.id ? { ...x, group_ids: normalized } : x)));
    setGroupsBusyId(u.id);
    try {
      await invoke('set_user_groups', { user_id: u.invited_user_id, group_ids: normalized });
      await loadUsers(selectedDomainId);
    } catch (e: any) {
      setUsers((list) => list.map((x) => (x.id === u.id ? { ...x, group_ids: prev } : x)));
      toast({ title: 'Failed to update groups', description: e.message, variant: 'destructive' });
    } finally {
      setGroupsBusyId(null);
    }
  };

  useEffect(() => {
    if (selectedDomainId) loadUsers(selectedDomainId);
  }, [selectedDomainId]);

  useEffect(() => {
    if (!autoSyncNonce || !selectedDomainId) return;
    void handleSync();
  }, [autoSyncNonce, selectedDomainId]);

  const handleSync = async () => {
    if (!selectedDomainId) return;
    setSyncing(true);
    try {
      const res = await invoke('sync_discovered_users', { domain_id: selectedDomainId });
      if (res?.error) throw new Error(res.error);
      const found = res?.licensed_on_domain ?? 0;
      const matched = res?.domain_matched;
      const total = res?.total_in_tenant;
      let description = `${found} eligible user${found === 1 ? '' : 's'} found.`;
      if (found === 0 && typeof matched === 'number' && typeof total === 'number') {
        if (matched === 0) {
          description = `Found ${total} users in the tenant, but none have an email address ending in @${res?.configured_domain}. Check that the domain is spelled correctly under "Domains".`;
        } else {
          description = `Found ${matched} users on @${res?.configured_domain} but none had an active mailbox license.`;
        }
      }
      toast({ title: 'Directory sync complete', description });
      await loadUsers(selectedDomainId);
    } catch (e: any) {
      toast({ title: 'Sync failed', description: e.message, variant: 'destructive' });
    } finally {
      setSyncing(false);
    }
  };

  const handleInvite = async (u: DiscoveredUser) => {
    setActingId(u.id);
    try {
      await invoke('invite_discovered_user', { discovered_id: u.id });
      toast({
        title: 'Invitation sent',
        description: `${u.email} will receive a welcome email with a one-click sign-in link.`,
      });
      await loadUsers(selectedDomainId);
    } catch (e: any) {
      toast({ title: 'Failed to invite', description: e.message, variant: 'destructive' });
    } finally {
      setActingId(null);
    }
  };

  const handleResend = async (u: DiscoveredUser) => {
    setActingId(u.id);
    try {
      await invoke('resend_discovered_invitation', { discovered_id: u.id });
      toast({ title: 'Invitation resent', description: `Sent a fresh sign-in link to ${u.email}.` });
      await loadUsers(selectedDomainId);
    } catch (e: any) {
      toast({ title: 'Failed to resend', description: e.message, variant: 'destructive' });
    } finally {
      setActingId(null);
    }
  };

  const handleEnable = async (u: DiscoveredUser) => {
    setActingId(u.id);
    try {
      await invoke('enable_discovered_user', { discovered_id: u.id });
      toast({ title: 'Account provisioned', description: `${u.email} is ready to sign in.` });
      await loadUsers(selectedDomainId);
    } catch (e: any) {
      toast({ title: 'Failed to enable', description: e.message, variant: 'destructive' });
    } finally {
      setActingId(null);
    }
  };

  // Temporarily blocks sign-in for a provisioned user. All their data
  // (profile, connections, categories, history) is preserved.
  const handleSuspend = async (u: DiscoveredUser) => {
    if (!u.invited_user_id) return;
    setActingId(u.id);
    try {
      await invoke('disable_user', { user_id: u.invited_user_id });
      toast({
        title: 'Access suspended',
        description: `${u.email} can no longer sign in. Their data is kept and can be restored at any time.`,
      });
      await loadUsers(selectedDomainId);
    } catch (e: any) {
      toast({ title: 'Failed to suspend', description: e.message, variant: 'destructive' });
    } finally {
      setActingId(null);
    }
  };

  // Reverses a suspension — restores sign-in immediately.
  const handleReactivate = async (u: DiscoveredUser) => {
    if (!u.invited_user_id) return;
    setActingId(u.id);
    try {
      const res = await invoke('enable_user', { user_id: u.invited_user_id });
      if (res?.magic_link) {
        await navigator.clipboard.writeText(res.magic_link).catch(() => null);
      }
      toast({
        title: 'Access restored',
        description: res?.magic_link
          ? `${u.email} can sign in again. A fresh sign-in link was generated and copied.`
          : `${u.email} can sign in again.`,
      });
      await loadUsers(selectedDomainId);
    } catch (e: any) {
      toast({ title: 'Failed to reactivate', description: e.message, variant: 'destructive' });
    } finally {
      setActingId(null);
    }
  };

  // Permanently deletes the user's app account, profile, and memberships.
  // The directory row stays so the admin can re-invite them later if needed.
  const handleRemove = async (u: DiscoveredUser) => {
    setActingId(u.id);
    try {
      setCleanupStatus({
        open: true,
        title: 'Reorganizing mailbox',
        description: 'Please wait while category emails are moved back to Inbox and old folders are removed.',
      });
      await invoke('remove_discovered_user', { discovered_id: u.id });
      setCleanupStatus({
        open: true,
        title: 'Done',
        description: 'Mailbox cleanup is finished and the account access has been removed.',
      });
      toast({
        title: 'User removed',
        description: `${u.email} has been removed from the app. They can be re-invited at any time.`,
      });
      await loadUsers(selectedDomainId);
    } catch (e: any) {
      setCleanupStatus({ open: false, title: '', description: '' });
      toast({ title: 'Failed to remove', description: e.message, variant: 'destructive' });
    } finally {
      setActingId(null);
      setRemoveTarget(null);
    }
  };


  const filtered = users.filter((u) => {
    if (!u.account_enabled || !u.is_licensed) return false;
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      u.email.toLowerCase().includes(s) ||
      (u.display_name || '').toLowerCase().includes(s) ||
      (u.job_title || '').toLowerCase().includes(s) ||
      (u.department || '').toLowerCase().includes(s)
    );
  });

  if (consentedDomains.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" /> M365 Users
          </CardTitle>
          <CardDescription>
            Pull licensed users directly from a customer's Microsoft 365 tenant.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-foreground/80">
            No domains have completed Microsoft tenant authorization yet. Go to the
            <span className="font-medium"> Domains </span> tab and have the customer's
            Global Admin click <span className="font-medium">Grant Microsoft Consent</span>.
            Once consent is granted, you can pull their full user directory here.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" /> M365 Users
            </CardTitle>
            <CardDescription>
              Pulled from the customer's Microsoft 365 tenant directory. Showing active licensed users
              with a one-click sign-in link — no password required.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select value={selectedDomainId} onValueChange={setSelectedDomainId}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Select domain" />
              </SelectTrigger>
              <SelectContent>
                {consentedDomains.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.domain}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={handleSync} disabled={syncing || !selectedDomainId} className="gap-2">
              {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Sync now
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search name, email, job title, or department..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground">
            {users.length === 0
              ? 'No users discovered yet. Click "Sync now" to pull from Microsoft 365.'
              : 'No users match your search.'}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((u) => {
              const isBusy = actingId === u.id;
              return (
                <div
                  key={u.id}
                  className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border bg-background hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {u.profile_photo_url ? (
                      <img
                        src={u.profile_photo_url}
                        alt={u.display_name || u.email}
                        className="w-9 h-9 rounded-full object-cover shrink-0 border border-border"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary shrink-0">
                        {(u.display_name || u.email)[0]?.toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate">
                        {u.display_name || u.email}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {u.email}
                        {u.job_title && <span> · {u.job_title}</span>}
                      </p>
                      {(u.department || u.office_location) && (
                        <p className="text-[11px] text-muted-foreground/80 truncate mt-0.5">
                          {u.department && (
                            <span className="inline-flex items-center gap-1">
                              <UsersRound className="w-3 h-3" />
                              {u.department}
                            </span>
                          )}
                          {u.department && u.office_location && <span className="mx-1.5">·</span>}
                          {u.office_location && <span>{u.office_location}</span>}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {/* State badge */}
                    {u.status === 'active' && !u.app_disabled && (
                      <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Active
                      </Badge>
                    )}
                    {u.status === 'active' && u.app_disabled && (
                      <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20 gap-1">
                        <Pause className="w-3 h-3" /> Suspended
                      </Badge>
                    )}
                    {u.status === 'invited' && (
                      <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20 gap-1">
                        <Mail className="w-3 h-3" /> Invited
                      </Badge>
                    )}
                    {u.status === 'discovered' && (
                      <Badge variant="secondary">Discovered</Badge>
                    )}
                    {!u.account_enabled && (
                      <Badge variant="outline" className="text-amber-600 border-amber-500/30">
                        Disabled in M365
                      </Badge>
                    )}

                    {/* Inline group + role assignment — only available once provisioned */}
                    {u.invited_user_id && (
                      <>
                        <RoleInlinePicker
                          userId={u.invited_user_id}
                          userEmail={u.email}
                          organizationId={u.organization_id}
                        />
                        <GroupPicker
                          user={u}
                          groups={groups}
                          busy={groupsBusyId === u.id}
                          onChange={(ids) => handleSetGroups(u, ids)}
                        />
                      </>
                    )}

                    {/* Actions for "discovered" — invite or silently provision */}
                    {u.status === 'discovered' && (
                      <>
                        <Button
                          size="sm"
                          onClick={() => handleInvite(u)}
                          disabled={isBusy || !u.account_enabled}
                          className="gap-1"
                        >
                          {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                          Invite
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleEnable(u)}
                          disabled={isBusy}
                          title="Provision account without sending an email"
                        >
                          <UserCheck className="w-3.5 h-3.5" />
                        </Button>
                      </>
                    )}

                    {/* Actions for "invited" — resend, or remove if they never accept */}
                    {u.status === 'invited' && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleResend(u)}
                          disabled={isBusy}
                          className="gap-1"
                        >
                          {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                          Resend
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setRemoveTarget(u)}
                          disabled={isBusy}
                          className="text-destructive hover:text-destructive"
                          title="Remove from app"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </>
                    )}

                    {/* Actions for "active" — suspend / reactivate / remove */}
                    {u.status === 'active' && (
                      <>
                        {u.app_disabled ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleReactivate(u)}
                            disabled={isBusy}
                            className="gap-1"
                            title="Restore sign-in"
                          >
                            {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                            Reactivate
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleSuspend(u)}
                            disabled={isBusy}
                            className="gap-1"
                            title="Temporarily block sign-in (data is kept)"
                          >
                            {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Pause className="w-3.5 h-3.5" />}
                            Suspend
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setRemoveTarget(u)}
                          disabled={isBusy}
                          className="text-destructive hover:text-destructive"
                          title="Remove from app"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      <AlertDialog open={!!removeTarget} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove user from app?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes <span className="font-medium">{removeTarget?.email}</span>'s
              app account, profile, connections, and history. They'll still appear in this list
              (because they're in your Microsoft 365 tenant) and can be re-invited later.
              <br /><br />
              If you only want to temporarily block sign-in, use <span className="font-medium">Suspend</span> instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => removeTarget && handleRemove(removeTarget)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove user
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={cleanupStatus.open}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{cleanupStatus.title}</DialogTitle>
            <DialogDescription className="flex items-center gap-2 pt-2">
              {cleanupStatus.title !== 'Done' && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{cleanupStatus.description}</span>
            </DialogDescription>
          </DialogHeader>
          {cleanupStatus.title === 'Done' && (
            <div className="flex justify-end">
              <Button onClick={() => setCleanupStatus({ open: false, title: '', description: '' })}>Close</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/**
 * Compact single-select for assigning a discovered/active user to one
 * permission group. The change persists immediately.
 */
function GroupPicker({
  user,
  groups,
  busy,
  onChange,
}: {
  user: DiscoveredUser;
  groups: PermissionGroup[];
  busy: boolean;
  onChange: (groupIds: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = user.group_ids || [];
  // Show groups that are either:
  //   - Global (apply across all domains), OR
  //   - Specifically scoped to this user's domain.
  // We intentionally don't filter by organization_id here: the super-admin's
  // groups live in the admin org but are assignable to users in any domain
  // they manage. Groups scoped to a *different* domain are still hidden.
  const orgGroups = groups.filter(
    (g) => g.domain_id === null || g.domain_id === user.domain_id,
  );

  const toggle = (groupId: string) => {
    const next = selected[0] === groupId ? [] : [groupId];
    onChange(next);
  };

  const label =
    selected.length === 0
      ? 'No group'
      : selected.length === 1
        ? orgGroups.find((g) => g.id === selected[0])?.name || '1 group'
        : `${selected.length} groups`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 h-8 max-w-[160px]"
          disabled={busy}
          title="Assign permission groups"
        >
          {busy ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
          ) : (
            <UsersRound className="w-3.5 h-3.5 shrink-0" />
          )}
          <span className="truncate text-xs">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="end">
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
          Assign group
        </div>
        {orgGroups.length === 0 ? (
          <div className="px-2 py-3 text-xs text-muted-foreground">
            No groups available for this user yet. Create one in the Groups tab —
            either global or scoped to this user's domain.
          </div>
        ) : (
          <div className="max-h-64 overflow-y-auto">
            {orgGroups.map((g) => {
              const checked = selected.includes(g.id);
              return (
                <label
                  key={g.id}
                  className="flex items-start gap-2 px-2 py-2 rounded-md hover:bg-muted/60 cursor-pointer"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => toggle(g.id)}
                    className="mt-0.5"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium truncate">{g.name}</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${
                          g.domain_id
                            ? 'bg-primary/10 text-primary'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {g.domain_id ? 'Domain' : 'Global'}
                      </span>
                    </div>
                    {g.description && (
                      <div className="text-xs text-muted-foreground truncate">{g.description}</div>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
