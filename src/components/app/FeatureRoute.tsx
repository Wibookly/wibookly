import { Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useFeatureAccess, FeatureKey } from '@/hooks/useFeatureAccess';
import { useAuth } from '@/lib/auth';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

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
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    if (!loading && !authLoading) {
      setStalled(false);
      return;
    }

    const timer = window.setTimeout(() => setStalled(true), 12000);
    return () => window.clearTimeout(timer);
  }, [loading, authLoading]);

  const isSuperAdmin = profile?.email?.toLowerCase() === 'arahimi@energyforward.com';

  if (loading || authLoading) {
    if (stalled) {
      return (
        <div className="page-shell">
          <div className="mx-auto mt-10 max-w-2xl rounded-xl border border-destructive/30 bg-destructive/5 p-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
              <div className="min-w-0 space-y-2">
                <h2 className="text-base font-semibold">This page is taking too long to verify access</h2>
                <p className="text-sm text-muted-foreground">
                  Reload the page. If it continues, the access check is temporarily unavailable, but the app will no longer stay on a blank screen.
                </p>
                <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Reload page
                </Button>
              </div>
            </div>
          </div>
        </div>
      );
    }

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
