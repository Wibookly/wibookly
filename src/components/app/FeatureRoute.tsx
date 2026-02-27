import { Navigate } from 'react-router-dom';
import { useFeatureAccess, FeatureKey } from '@/hooks/useFeatureAccess';
import { useAuth } from '@/lib/auth';
import { Loader2 } from 'lucide-react';

interface FeatureRouteProps {
  featureKeys: FeatureKey[];
  children: React.ReactNode;
}

/**
 * Wraps a page component and only renders it if the user has at least one
 * of the specified features enabled (or is the super admin).
 */
export function FeatureRoute({ featureKeys, children }: FeatureRouteProps) {
  const { hasFeature, loading } = useFeatureAccess();
  const { profile, loading: authLoading } = useAuth();

  const isSuperAdmin = profile?.email?.toLowerCase() === 'arahimi@energyforward.com';

  if (loading || authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isSuperAdmin) {
    return <>{children}</>;
  }

  const hasAccess = featureKeys.some((key) => hasFeature(key));

  if (!hasAccess) {
    return <Navigate to="/integrations" replace />;
  }

  return <>{children}</>;
}
