import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { StatusCard } from '@/components/ui/status-card';
import { Mail, FolderOpen, Sparkles } from 'lucide-react';

interface DashboardData {
  outlookConnected: boolean;
  categoriesCount: number;
  aiEnabled: boolean;
}

export default function Dashboard() {
  const { profile, organization } = useAuth();
  const [data, setData] = useState<DashboardData>({
    outlookConnected: false,
    categoriesCount: 0,
    aiEnabled: false
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!organization?.id || !profile?.user_id) return;

    const fetchDashboardData = async () => {
      try {
        // Check Outlook connection
        const { data: connections } = await supabase
          .from('provider_connections')
          .select('is_connected')
          .eq('organization_id', organization.id)
          .eq('provider', 'outlook')
          .maybeSingle();

        // Get categories count
        const { count: categoriesCount } = await supabase
          .from('categories')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', organization.id)
          .eq('is_enabled', true);

        // Check AI settings
        const { data: aiSettings } = await supabase
          .from('ai_settings')
          .select('*')
          .eq('organization_id', organization.id)
          .maybeSingle();

        // Check if any category has AI draft enabled
        const { data: aiCategories } = await supabase
          .from('categories')
          .select('id')
          .eq('organization_id', organization.id)
          .eq('ai_draft_enabled', true)
          .limit(1);

        setData({
          outlookConnected: connections?.is_connected || false,
          categoriesCount: categoriesCount || 0,
          aiEnabled: (aiCategories?.length || 0) > 0
        });
      } catch (error) {
        console.error('Error fetching dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, [organization?.id, profile?.user_id]);

  return (
    <div className="max-w-4xl animate-fade-in">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-muted-foreground">
          Welcome back{profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatusCard
          title="Microsoft Outlook"
          value={data.outlookConnected ? 'Connected' : 'Not Connected'}
          status={data.outlookConnected ? 'success' : 'error'}
          icon={Mail}
          description={data.outlookConnected ? 'Your inbox is synced' : 'Connect to start syncing'}
        />
        <StatusCard
          title="Categories"
          value={`${data.categoriesCount} active`}
          status={data.categoriesCount > 0 ? 'success' : 'pending'}
          icon={FolderOpen}
          description="Custom email categories"
        />
        <StatusCard
          title="AI Drafts"
          value={data.aiEnabled ? 'Enabled' : 'Disabled'}
          status={data.aiEnabled ? 'success' : 'neutral'}
          icon={Sparkles}
          description={data.aiEnabled ? 'AI is drafting replies' : 'Enable in Categories'}
        />
      </div>
    </div>
  );
}
