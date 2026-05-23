import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Sparkles, Shield, Zap } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import energyForwardLogo from '@/assets/ef-logo.png';
import { InboxIQLogo } from '@/components/app/InboxIQLogo';

// Microsoft icon
const MicrosoftIcon = () => (
  <svg viewBox="0 0 21 21" className="w-5 h-5" aria-hidden="true">
    <rect x="1" y="1" width="9" height="9" fill="#F25022" />
    <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
    <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
    <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
  </svg>
);

export default function Auth() {
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [ssoLoading, setSsoLoading] = useState(false);
  const [emailError, setEmailError] = useState('');

  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  // Show SSO errors from callback
  useEffect(() => {
    const error = searchParams.get('error');
    const ssoSuccess = searchParams.get('sso');
    if (error) {
      toast({ title: 'Authentication Error', description: error, variant: 'destructive' });
    }
    if (ssoSuccess === 'success') {
      toast({ title: 'Sign-in successful', description: 'Redirecting...' });
    }
  }, [searchParams]);

  useEffect(() => {
    if (user) {
      const returnTo = searchParams.get('return_to');
      navigate(returnTo && returnTo.startsWith('/') ? returnTo : '/integrations');
    }
  }, [user, navigate, searchParams]);

  const handleMicrosoftSSO = async () => {
    if (!email || !email.includes('@')) {
      setEmailError('Please enter your Microsoft 365 work email');
      return;
    }
    setEmailError('');
    setSsoLoading(true);
    try {
      const response = await supabase.functions.invoke('microsoft-sso-init', {
        body: { email },
      });

      if (response.error) throw new Error(response.error.message);
      if (response.data?.error) throw new Error(response.data.error);

      // Redirect to Microsoft OAuth
      window.location.href = response.data.authUrl;
    } catch (error: any) {
      toast({
        title: 'Microsoft SSO Error',
        description: error.message || 'Failed to initiate Microsoft sign-in',
        variant: 'destructive',
      });
      setSsoLoading(false);
    }
  };

  const handleForgotPassword = () => {
    // Microsoft 365 password is managed in Microsoft, not in this app.
    window.open('https://passwordreset.microsoftonline.com/', '_blank', 'noopener,noreferrer');
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden"
      style={{ background: 'var(--bg)' }}
    >
      {/* Soft radial glow behind card */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(60% 50% at 50% 40%, color-mix(in srgb, var(--primary) 22%, transparent), transparent 70%), radial-gradient(40% 35% at 70% 70%, color-mix(in srgb, var(--ef-sky) 18%, transparent), transparent 70%)',
        }}
      />
      <div
        className="relative w-full max-w-md p-8 rounded-2xl"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        {/* Brand lockup */}
        <div className="flex flex-col items-center mb-6">
          <img
            src={energyForwardLogo}
            alt="EnergyForward"
            className="h-[88px] w-auto object-contain"
            draggable={false}
          />
          <InboxIQLogo className="text-[26px] leading-none mt-1" />
          <div
            className="mt-1"
            style={{ fontSize: '10.5px', fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-soft)' }}
          >
            AI inbox for M365
          </div>
        </div>

        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold tracking-tight leading-tight" style={{ color: 'var(--text-strong)', letterSpacing: '-0.02em' }}>
            Welcome back
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
            Sign in with your work account to open your AI-prioritized inbox.
          </p>
        </div>

        {/* Email input + Microsoft SSO */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Work Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => { setEmail(e.target.value); if (emailError) setEmailError(''); }}
              disabled={ssoLoading}
              className={emailError ? 'border-destructive' : ''}
              onKeyDown={(e) => { if (e.key === 'Enter') handleMicrosoftSSO(); }}
            />
            {emailError && <p className="text-xs text-destructive">{emailError}</p>}
          </div>

          <Button
            size="lg"
            className="w-full justify-center gap-3 h-12 text-sm"
            onClick={handleMicrosoftSSO}
            disabled={ssoLoading}
          >
            {ssoLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <MicrosoftIcon />}
            <span>Continue with Microsoft</span>
          </Button>

          <p className="text-xs text-center text-muted-foreground leading-relaxed">
            Your password is managed by Microsoft 365. When you change it in Microsoft,
            it automatically applies here — no separate password to remember.
          </p>
        </div>

        {/* Forgot password */}
        <div className="mt-6 text-center text-sm">
          <button
            type="button"
            onClick={handleForgotPassword}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Forgot your Microsoft 365 password?
          </button>
        </div>
      </div>
    </div>
  );
}
