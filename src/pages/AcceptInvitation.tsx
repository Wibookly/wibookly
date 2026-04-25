import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, ShieldCheck, AlertCircle, Mail } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Landing page for invitation links sent via email.
 * Hits the accept-invitation edge function which validates the token,
 * provisions the auth user, and immediately redirects via a magic link.
 */
export default function AcceptInvitation() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token');
  const [status, setStatus] = useState<'loading' | 'invalid' | 'expired' | 'used' | 'redirecting'>('loading');
  const [message, setMessage] = useState<string>('');
  const [email, setEmail] = useState<string>('');

  useEffect(() => {
    if (!token) {
      setStatus('invalid');
      setMessage('This invitation link is missing required information.');
      return;
    }
    // The GET endpoint of accept-invitation does the full server-side flow
    // and 302-redirects to the magic link. We just navigate there.
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/accept-invitation?token=${encodeURIComponent(token)}`;
    setStatus('redirecting');
    window.location.replace(url);
  }, [token]);

  // Fallback UI if redirect is slow / blocked.
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 p-4">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <div className="mx-auto w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-3">
            {status === 'invalid' || status === 'expired' || status === 'used' ? (
              <AlertCircle className="w-7 h-7 text-destructive" />
            ) : (
              <ShieldCheck className="w-7 h-7 text-primary" />
            )}
          </div>
          <CardTitle>
            {status === 'redirecting' && 'Signing you in…'}
            {status === 'loading' && 'Verifying your invitation…'}
            {status === 'invalid' && 'Invalid invitation'}
            {status === 'expired' && 'Invitation expired'}
            {status === 'used' && 'Already accepted'}
          </CardTitle>
          <CardDescription>
            {status === 'redirecting' && 'Connecting your Microsoft 365 account to InboxIQ.'}
            {status === 'loading' && 'One moment while we check your invitation link.'}
            {(status === 'invalid' || status === 'expired' || status === 'used') && message}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-center">
          {status === 'redirecting' || status === 'loading' ? (
            <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
          ) : (
            <>
              {email && (
                <div className="text-sm text-muted-foreground flex items-center justify-center gap-2">
                  <Mail className="w-4 h-4" />
                  <span>{email}</span>
                </div>
              )}
              <Button onClick={() => navigate('/auth')} className="w-full">
                Go to sign in
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
