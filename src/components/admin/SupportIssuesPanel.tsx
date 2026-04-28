import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, RefreshCw, MessageSquareWarning, ExternalLink } from 'lucide-react';

interface SupportIssue {
  id: string;
  user_email: string;
  subject: string;
  description: string;
  page_url: string | null;
  user_agent: string | null;
  status: string;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open', tone: 'destructive' as const },
  { value: 'in_progress', label: 'In progress', tone: 'default' as const },
  { value: 'resolved', label: 'Resolved', tone: 'secondary' as const },
  { value: 'wont_fix', label: "Won't fix", tone: 'outline' as const },
];

function statusBadge(status: string) {
  const opt = STATUS_OPTIONS.find((s) => s.value === status);
  return (
    <Badge variant={opt?.tone ?? 'secondary'} className="capitalize">
      {opt?.label ?? status}
    </Badge>
  );
}

export default function SupportIssuesPanel() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [issues, setIssues] = useState<SupportIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({});

  const load = async () => {
    if (!profile?.organization_id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('support_issues')
        .select('*')
        .eq('organization_id', profile.organization_id)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      setIssues((data ?? []) as SupportIssue[]);
    } catch (err) {
      console.error('load support issues', err);
      toast({
        title: 'Could not load issues',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.organization_id]);

  const updateIssue = async (
    id: string,
    patch: Partial<Pick<SupportIssue, 'status' | 'admin_notes'>>,
  ) => {
    setSavingId(id);
    try {
      const update: Record<string, unknown> = { ...patch };
      if (patch.status === 'resolved') update.resolved_at = new Date().toISOString();
      else if (patch.status && patch.status !== 'resolved') update.resolved_at = null;

      const { error } = await supabase
        .from('support_issues')
        .update(update)
        .eq('id', id);
      if (error) throw error;

      setIssues((prev) =>
        prev.map((it) =>
          it.id === id
            ? {
                ...it,
                ...patch,
                resolved_at:
                  patch.status === 'resolved'
                    ? new Date().toISOString()
                    : patch.status
                    ? null
                    : it.resolved_at,
                updated_at: new Date().toISOString(),
              }
            : it,
        ),
      );
      toast({ title: 'Saved' });
    } catch (err) {
      console.error('update issue', err);
      toast({
        title: 'Could not save',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setSavingId(null);
    }
  };

  const counts = {
    open: issues.filter((i) => i.status === 'open').length,
    in_progress: issues.filter((i) => i.status === 'in_progress').length,
    resolved: issues.filter((i) => i.status === 'resolved').length,
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <MessageSquareWarning className="w-5 h-5" />
              Support Issues
            </CardTitle>
            <CardDescription>
              User-submitted issues from the in-app Help panel
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            {loading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-2" />
            )}
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span><strong className="text-foreground">{counts.open}</strong> open</span>
            <span>·</span>
            <span><strong className="text-foreground">{counts.in_progress}</strong> in progress</span>
            <span>·</span>
            <span><strong className="text-foreground">{counts.resolved}</strong> resolved</span>
            <span>·</span>
            <span><strong className="text-foreground">{issues.length}</strong> total</span>
          </div>
        </CardContent>
      </Card>

      {loading && issues.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="w-5 h-5 mr-2 animate-spin" />
          Loading…
        </div>
      ) : issues.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground text-sm">
            No issues have been submitted yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {issues.map((it) => {
            const notes = draftNotes[it.id] ?? it.admin_notes ?? '';
            const dirty = notes !== (it.admin_notes ?? '');
            return (
              <Card key={it.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        {statusBadge(it.status)}
                        <span className="text-[11px] text-muted-foreground">
                          {new Date(it.created_at).toLocaleString()}
                        </span>
                      </div>
                      <CardTitle className="text-base break-words">{it.subject}</CardTitle>
                      <CardDescription className="text-xs mt-1">
                        From <span className="font-mono">{it.user_email}</span>
                        {it.page_url && (
                          <>
                            {' · '}
                            <span className="inline-flex items-center gap-1">
                              <ExternalLink className="w-3 h-3" />
                              <code className="text-[11px]">{it.page_url}</code>
                            </span>
                          </>
                        )}
                      </CardDescription>
                    </div>
                    <Select
                      value={it.status}
                      onValueChange={(v) => updateIssue(it.id, { status: v })}
                      disabled={savingId === it.id}
                    >
                      <SelectTrigger className="w-36 h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUS_OPTIONS.map((s) => (
                          <SelectItem key={s.value} value={s.value} className="text-xs">
                            {s.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="rounded-md border bg-muted/30 px-3 py-2">
                    <p className="text-sm whitespace-pre-wrap break-words">{it.description}</p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      Admin notes (visible to admins only)
                    </label>
                    <Textarea
                      value={notes}
                      onChange={(e) =>
                        setDraftNotes((prev) => ({ ...prev, [it.id]: e.target.value }))
                      }
                      rows={2}
                      placeholder="Add internal notes, root cause, who's working on it…"
                      className="text-sm"
                    />
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!dirty || savingId === it.id}
                        onClick={() => updateIssue(it.id, { admin_notes: notes })}
                      >
                        {savingId === it.id ? (
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        ) : null}
                        Save notes
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
