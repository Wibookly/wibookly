import { useEffect, useState } from 'react';
import { PageHero } from '@/components/app/PageHero';
import { LifeBuoy, Loader2, RefreshCw, Inbox } from 'lucide-react';
import { HelpIssueForm } from '@/components/help/HelpIssueForm';
import SupportIssuesPanel from '@/components/admin/SupportIssuesPanel';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { useUserRoles } from '@/hooks/useUserRoles';
import { supabase } from '@/integrations/supabase/client';
import { formatDistanceToNow } from 'date-fns';

interface MyTicket {
  id: string;
  subject: string;
  description: string;
  status: string;
  page_url: string | null;
  admin_notes: string | null;
  created_at: string;
  resolved_at: string | null;
}

const STATUS_TONE: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  open: 'destructive',
  in_progress: 'default',
  resolved: 'secondary',
  wont_fix: 'outline',
};
const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  wont_fix: "Won't fix",
};

function MyTicketsList() {
  const { user } = useAuth();
  const [tickets, setTickets] = useState<MyTicket[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!user?.id) return;
    setLoading(true);
    const { data } = await supabase
      .from('support_issues')
      .select('id, subject, description, status, page_url, admin_notes, created_at, resolved_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    setTickets((data ?? []) as unknown as MyTicket[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Inbox className="w-4 h-4" /> My tickets
          </CardTitle>
          <CardDescription className="text-xs">
            Everything you've submitted, with the latest status from your admin team.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        </Button>
      </CardHeader>
      <CardContent>
        {loading && tickets.length === 0 ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading…
          </div>
        ) : tickets.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            You haven't submitted any tickets yet.
          </p>
        ) : (
          <div className="space-y-2">
            {tickets.map((t) => (
              <div key={t.id} className="rounded-md border bg-card p-3 space-y-1.5">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="font-medium text-sm break-words min-w-0 flex-1">{t.subject}</div>
                  <Badge variant={STATUS_TONE[t.status] ?? 'secondary'} className="text-[10px]">
                    {STATUS_LABEL[t.status] ?? t.status}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-3 break-words">
                  {t.description}
                </p>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground flex-wrap">
                  <span>Submitted {formatDistanceToNow(new Date(t.created_at), { addSuffix: true })}</span>
                  {t.page_url && (
                    <>
                      <span>·</span>
                      <code className="font-mono">{t.page_url}</code>
                    </>
                  )}
                  {t.resolved_at && (
                    <>
                      <span>·</span>
                      <span>Resolved {formatDistanceToNow(new Date(t.resolved_at), { addSuffix: true })}</span>
                    </>
                  )}
                </div>
                {t.admin_notes && (
                  <div className="rounded bg-muted/40 border px-2 py-1.5 text-xs">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">
                      Note from admin
                    </div>
                    <p className="whitespace-pre-wrap break-words">{t.admin_notes}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Help() {
  const { isOrgAdmin } = useUserRoles();

  return (
    <div className="page-shell">
      <div className="page-shell-sticky">
        <PageHero
          eyebrow="Knowledge Base"
          title="Help & Support"
          description="Send your admin team an issue, or check the status of tickets you've already submitted."
          accent="cyan"
          icon={<LifeBuoy className="w-5 h-5 text-white" strokeWidth={2} />}
        />
      </div>

      <div className="page-shell-content w-full animate-fade-in max-w-6xl space-y-6">
        {isOrgAdmin ? (
          <Tabs defaultValue="submit" className="w-full">
            <TabsList>
              <TabsTrigger value="submit">Submit an issue</TabsTrigger>
              <TabsTrigger value="all">All tickets (admin)</TabsTrigger>
              <TabsTrigger value="mine">My tickets</TabsTrigger>
            </TabsList>
            <TabsContent value="submit" className="mt-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card>
                  <CardContent className="p-6">
                    <HelpIssueForm />
                  </CardContent>
                </Card>
                <MyTicketsList />
              </div>
            </TabsContent>
            <TabsContent value="all" className="mt-4">
              <SupportIssuesPanel />
            </TabsContent>
            <TabsContent value="mine" className="mt-4">
              <MyTicketsList />
            </TabsContent>
          </Tabs>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardContent className="p-6">
                <HelpIssueForm />
              </CardContent>
            </Card>
            <MyTicketsList />
          </div>
        )}
      </div>
    </div>
  );
}
