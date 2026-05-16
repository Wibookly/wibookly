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
      navigate('/integrations');
    }
  }, [user, navigate]);

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
    <div className="min-h-screen bg-gradient-to-br from-primary/25 via-background to-accent/20 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-card/80 backdrop-blur-sm p-8 rounded-2xl shadow-lg border border-border/50">
        {/* Energy Forward logo */}
        <div className="flex justify-center mb-4">
          <img
            src={energyForwardLogo}
            alt="EnergyForward"
            className="h-24 w-auto object-contain"
            draggable={false}
          />
        </div>
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold tracking-tight text-primary leading-tight">
            Welcome to InboxIQ
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in with your Microsoft 365 account to continue
          </p>
        </div>

        {/* Value props */}
        <div className="grid grid-cols-3 gap-2 mb-6">
          <div className="flex flex-col items-center text-center p-2">
            <Sparkles className="w-4 h-4 text-primary mb-1" />
            <span className="text-[10px] text-muted-foreground leading-tight">AI Intelligence</span>
          </div>
          <div className="flex flex-col items-center text-center p-2">
            <Shield className="w-4 h-4 text-primary mb-1" />
            <span className="text-[10px] text-muted-foreground leading-tight">Secure SSO</span>
          </div>
          <div className="flex flex-col items-center text-center p-2">
            <Zap className="w-4 h-4 text-primary mb-1" />
            <span className="text-[10px] text-muted-foreground leading-tight">Instant Access</span>
          </div>
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
