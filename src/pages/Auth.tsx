import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { lovable } from '@/integrations/lovable/index';
import { NikkoreInboxLogo } from '@/components/app/NikkoreInboxLogo';

const GoogleIcon = () => (
  <svg viewBox="0 0 48 48" className="w-5 h-5" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.2 17.6 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-2.8-.4-4.1H24v8.2h12.6c-.3 2.1-1.6 5.2-4.6 7.3l7.6 5.9c4.5-4.2 6.5-10.2 6.5-17.3z" />
    <path fill="#FBBC05" d="M10.4 28.7A14.6 14.6 0 0 1 9.6 24c0-1.6.3-3.2.8-4.7l-7.8-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.8-6.1z" />
    <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.6-5.8l-7.6-5.9c-2 1.4-4.8 2.4-8 2.4-6.4 0-11.7-3.7-13.6-9l-7.8 6.1C6.5 42.6 14.6 48 24 48z" />
  </svg>
);

type Mode = 'signin' | 'signup';

export default function Auth() {
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const { user, signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    const error = searchParams.get('error');
    if (error) {
      toast({ title: 'Authentication error', description: error, variant: 'destructive' });
    }
  }, [searchParams, toast]);

  useEffect(() => {
    if (user) {
      const returnTo = searchParams.get('return_to');
      navigate(returnTo && returnTo.startsWith('/') ? returnTo : '/integrations', { replace: true });
    }
  }, [user, navigate, searchParams]);

  const handleGoogle = async () => {
    setGoogleBusy(true);
    setNotice(null);
    try {
      const result = await lovable.auth.signInWithOAuth('google', {
        redirect_uri: window.location.origin + '/auth',
      });
      if (result.error) throw new Error(result.error.message ?? 'Google sign-in failed');
      if (result.redirected) return;
      // Session already set — the effect above navigates.
    } catch (err) {
      toast({
        title: 'Google sign-in failed',
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'destructive',
      });
      setGoogleBusy(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);

    if (!email.includes('@')) {
      toast({ title: 'Enter a valid email address', variant: 'destructive' });
      return;
    }
    if (password.length < 6) {
      toast({ title: 'Password must be at least 6 characters', variant: 'destructive' });
      return;
    }

    setBusy(true);
    if (mode === 'signin') {
      const { error } = await signIn(email.trim(), password);
      setBusy(false);
      if (error) {
        toast({
          title: 'Could not sign you in',
          description: error.message.includes('Invalid login')
            ? 'That email and password combination does not match an account.'
            : error.message,
          variant: 'destructive',
        });
      }
      return;
    }

    if (!fullName.trim()) {
      setBusy(false);
      toast({ title: 'Please enter your full name', variant: 'destructive' });
      return;
    }

    const domain = email.split('@')[1] ?? 'My Company';
    const { error } = await signUp(email.trim(), password, domain, fullName.trim());
    setBusy(false);
    if (error) {
      toast({ title: 'Could not create your account', description: error.message, variant: 'destructive' });
      return;
    }
    setNotice('Check your email to confirm your address, then come back and sign in.');
  };

  const handleForgotPassword = async () => {
    if (!email.includes('@')) {
      toast({ title: 'Enter your email first', description: 'We will send a reset link there.', variant: 'destructive' });
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) {
      toast({ title: 'Could not send the reset email', description: error.message, variant: 'destructive' });
      return;
    }
    setNotice('Password reset link sent. Check your inbox.');
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-16 bg-background">
      <div className="w-full max-w-lg text-center">
        <div className="flex justify-center mb-8">
          <NikkoreInboxLogo className="text-[28px] leading-none" />
        </div>
        <h1 className="font-serif text-5xl sm:text-6xl tracking-tight text-foreground">
          {mode === 'signin' ? 'Welcome back' : 'Question what’s next'}
        </h1>
        <p className="mt-4 text-base text-muted-foreground">
          Your AI inbox partner for big ambitions
        </p>
      </div>

      <div className="mt-10 w-full max-w-md rounded-2xl border border-border bg-card p-6 sm:p-8 shadow-lg">
        <Button
          type="button"
          variant="secondary"
          className="w-full h-12 justify-center gap-3 text-sm font-medium"
          onClick={handleGoogle}
          disabled={googleBusy || busy}
        >
          {googleBusy ? <Loader2 className="w-5 h-5 animate-spin" /> : <GoogleIcon />}
          Continue with Google
        </Button>

        <div className="my-6 flex items-center gap-4">
          <span className="h-px flex-1 bg-border" />
          <span className="text-[11px] font-semibold tracking-widest text-muted-foreground">OR</span>
          <span className="h-px flex-1 bg-border" />
        </div>

        <form className="space-y-3" onSubmit={handleEmailSubmit}>
          {mode === 'signup' && (
            <Input
              placeholder="Full name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="h-12"
              disabled={busy}
            />
          )}
          <Input
            type="email"
            autoComplete="email"
            placeholder="Enter your email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-12"
            disabled={busy}
          />
          <Input
            type="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-12"
            disabled={busy}
          />
          <Button type="submit" className="w-full h-12 text-sm font-medium" disabled={busy || googleBusy}>
            {busy && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            {mode === 'signin' ? 'Continue with email' : 'Create account'}
          </Button>
        </form>

        {notice && (
          <p className="mt-4 text-xs text-center text-muted-foreground">{notice}</p>
        )}

        <div className="mt-6 flex flex-col items-center gap-2 text-xs text-muted-foreground">
          <button
            type="button"
            className="hover:text-foreground transition-colors"
            onClick={() => {
              setMode(mode === 'signin' ? 'signup' : 'signin');
              setNotice(null);
            }}
          >
            {mode === 'signin' ? 'New here? Create an account' : 'Already have an account? Sign in'}
          </button>
          {mode === 'signin' && (
            <button type="button" className="hover:text-foreground transition-colors" onClick={handleForgotPassword}>
              Forgot your password?
            </button>
          )}
        </div>

        <p className="mt-6 text-[11px] leading-relaxed text-center text-muted-foreground">
          Access to Nikkore Inbox features is granted by your administrator after your subscription is approved.
        </p>
      </div>
    </div>
  );
}
