import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';

export default function MicrosoftConsentComplete() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const status = params.get('ms_consent') === 'success' ? 'success' : 'error';
    const message = params.get('message') || (status === 'success' ? 'Tenant authorization recorded.' : 'Microsoft consent failed.');
    const domainId = params.get('domain_id');

    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({
          type: 'ms-admin-consent-result',
          status,
          message,
          domainId,
        }, window.location.origin);
        window.close();
        return;
      }
    } catch {
      // ignore and continue with same-tab navigation fallback
    }

    const adminParams = new URLSearchParams({
      tab: 'discovered',
      ms_consent: status,
      message,
    });

    if (domainId) {
      adminParams.set('domain_id', domainId);
      if (status === 'success') {
        adminParams.set('auto_sync', '1');
        adminParams.set('run_check', '1');
      }
    }

    navigate(`/admin?${adminParams.toString()}`, { replace: true });
  }, [location.search, navigate]);

  const params = new URLSearchParams(location.search);
  const success = params.get('ms_consent') === 'success';

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            {success ? <CheckCircle2 className="h-6 w-6" /> : <AlertTriangle className="h-6 w-6" />}
          </div>
          <CardTitle>{success ? 'Microsoft consent complete' : 'Microsoft consent failed'}</CardTitle>
          <CardDescription>
            Returning you to the M365 Users page.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    </div>
  );
}