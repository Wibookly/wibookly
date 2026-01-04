import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Play, Check, X, Clock, AlertCircle } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { format } from 'date-fns';

interface Job {
  id: string;
  job_type: string;
  status: string;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

const statusConfig: Record<string, { icon: any; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending: { icon: Clock, variant: 'secondary' },
  running: { icon: Loader2, variant: 'outline' },
  completed: { icon: Check, variant: 'default' },
  failed: { icon: X, variant: 'destructive' }
};

export default function Sync() {
  const { organization, profile } = useAuth();
  const { toast } = useToast();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (!organization?.id) return;
    fetchJobs();
  }, [organization?.id]);

  const fetchJobs = async () => {
    if (!organization?.id) return;

    const { data, error } = await supabase
      .from('jobs')
      .select('*')
      .eq('organization_id', organization.id)
      .order('created_at', { ascending: false })
      .limit(20);

    if (!error) {
      setJobs(data || []);
    }
    setLoading(false);
  };

  const runSync = async () => {
    if (!organization?.id || !profile?.user_id) return;
    setSyncing(true);

    try {
      toast({
        title: 'Sync Started',
        description: 'Synchronizing your emails...'
      });

      // Call server-side Edge Function to handle job processing
      const { data, error } = await supabase.functions.invoke('process-sync-job');

      if (error) throw error;

      toast({
        title: 'Sync Completed',
        description: data?.message || 'Your emails have been synchronized.'
      });
      
      fetchJobs();
    } catch (error) {
      console.error('Sync error:', error);
      toast({
        title: 'Error',
        description: 'Failed to complete sync',
        variant: 'destructive'
      });
    } finally {
      setSyncing(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const config = statusConfig[status] || statusConfig.pending;
    const Icon = config.icon;
    
    return (
      <Badge variant={config.variant} className="gap-1">
        <Icon className={`w-3 h-3 ${status === 'running' ? 'animate-spin' : ''}`} />
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    );
  };

  const formatJobType = (type: string) => {
    return type.charAt(0).toUpperCase() + type.slice(1);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl animate-fade-in">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sync</h1>
          <p className="mt-1 text-muted-foreground">
            Manually trigger syncs and view job history
          </p>
        </div>
        <Button onClick={runSync} disabled={syncing}>
          {syncing ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Play className="w-4 h-4 mr-2" />
          )}
          Run Sync Now
        </Button>
      </div>

      {jobs.length === 0 ? (
        <div className="text-center py-12 bg-card rounded-lg border border-border">
          <AlertCircle className="w-8 h-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">No sync jobs yet.</p>
          <p className="text-sm text-muted-foreground mt-1">
            Click "Run Sync Now" to synchronize your emails.
          </p>
        </div>
      ) : (
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Completed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job) => (
                <TableRow key={job.id}>
                  <TableCell className="font-medium">
                    {formatJobType(job.job_type)}
                  </TableCell>
                  <TableCell>
                    {getStatusBadge(job.status)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {job.started_at
                      ? format(new Date(job.started_at), 'MMM d, yyyy HH:mm')
                      : '-'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {job.completed_at
                      ? format(new Date(job.completed_at), 'MMM d, yyyy HH:mm')
                      : '-'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
