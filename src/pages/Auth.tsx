import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Check, HelpCircle } from 'lucide-react';
import { z } from 'zod';
import wibooklyLogo from '@/assets/wibookly-logo.png';
import { supabase } from '@/integrations/supabase/client';

// Microsoft icon
const MicrosoftIcon = () => (
  <svg viewBox="0 0 21 21" className="w-5 h-5" aria-hidden="true">
    <rect x="1" y="1" width="9" height="9" fill="#F25022" />
    <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
    <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
    <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
  </svg>
);

// Google icon
const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
  </svg>
);

const signInSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

const signUpSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  fullName: z.string().min(2, 'Please enter your full name'),
});

type AuthMode = 'signin' | 'signup' | 'forgot-password';

export default function Auth() {
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<AuthMode>(
    searchParams.get('mode') === 'signup' ? 'signup' : 'signin'
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [ssoLoading, setSsoLoading] = useState<'microsoft' | 'google' | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [resetEmailSent, setResetEmailSent] = useState(false);

  const { signIn, signUp, user } = useAuth();
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

  const validateForm = () => {
    try {
      if (mode === 'signin') {
        signInSchema.parse({ email, password });
      } else if (mode === 'signup') {
        signUpSchema.parse({ email, password, fullName });
      } else {
        z.string().email('Please enter a valid email address').parse(email);
      }
      setErrors({});
      return true;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const newErrors: Record<string, string> = {};
        error.errors.forEach((err) => {
          const field = err.path[0] as string;
          newErrors[field || 'email'] = err.message;
        });
        setErrors(newErrors);
      }
      return false;
    }
  };

  const handleMicrosoftSSO = async () => {
    setSsoLoading('microsoft');
    try {
      const response = await supabase.functions.invoke('microsoft-sso-init', {
        body: { email: email || undefined },
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
      setSsoLoading(null);
    }
  };

  const handleGoogleSSO = async () => {
    setSsoLoading('google');
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/integrations`,
          queryParams: { access_type: 'offline', prompt: 'consent' },
        },
      });
      if (error) throw error;
    } catch (error: any) {
      toast({
        title: 'Google SSO Error',
        description: error.message || 'Failed to initiate Google sign-in',
        variant: 'destructive',
      });
      setSsoLoading(null);
    }
  };

  const handleForgotPassword = async () => {
    if (!validateForm()) return;
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setResetEmailSent(true);
      toast({ title: 'Reset email sent', description: 'Check your inbox for instructions.' });
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'forgot-password') {
      await handleForgotPassword();
      return;
    }
    if (!validateForm()) return;
    setLoading(true);

    try {
      if (mode === 'signup') {
        // Check domain allowlist first
        const domain = email.split('@')[1]?.toLowerCase();
        const isSuperAdmin = email.toLowerCase() === 'arahimi@energyforward.com';

        if (!isSuperAdmin) {
          const { data: allowed } = await supabase.rpc('is_domain_allowed', { _email: email });
          if (!allowed) {
            toast({
              title: 'Domain not authorized',
              description: 'Your email domain is not authorized. Contact your administrator.',
              variant: 'destructive',
            });
            setLoading(false);
            return;
          }
        }

        const orgName = isSuperAdmin ? 'Energy Forward' : `${domain} Organization`;
        const { error } = await signUp(email, password, orgName, fullName);
        if (error) throw error;
        toast({
          title: 'Account created',
          description: 'Please check your email to verify your account.',
        });
        setMode('signin');
      } else {
        const { error } = await signIn(email, password);
        if (error) {
          if (error.message.includes('Invalid login credentials')) {
            toast({ title: 'Invalid credentials', description: 'Please check your email and password.', variant: 'destructive' });
          } else {
            throw error;
          }
        } else {
          navigate('/integrations');
        }
      }
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // Forgot password success
  if (mode === 'forgot-password' && resetEmailSent) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/25 via-background to-accent/20 flex items-center justify-center p-6">
        <div className="w-full max-w-sm bg-card/80 backdrop-blur-sm p-8 rounded-2xl shadow-lg border border-border/50 text-center">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
            <Check className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Check your email</h1>
          <p className="text-muted-foreground mb-6">
            We've sent reset instructions to <span className="font-medium text-foreground">{email}</span>
          </p>
          <Button variant="outline" className="w-full" onClick={() => { setMode('signin'); setResetEmailSent(false); }}>
            Back to sign in
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/25 via-background to-accent/20 flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-card/80 backdrop-blur-sm p-8 rounded-2xl shadow-lg border border-border/50">
        <div className="text-center mb-8">
          <img src={wibooklyLogo} alt="Wibookly" className="h-24 w-auto mx-auto mb-6" />
          <h1 className="text-2xl font-bold tracking-tight text-primary">
            {mode === 'forgot-password' ? 'Reset Password' : mode === 'signup' ? 'Create Account' : 'Welcome back'}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {mode === 'forgot-password'
              ? 'Enter your email to reset your password'
              : mode === 'signup'
                ? 'Sign up to get started'
                : 'Sign in to continue'}
          </p>
        </div>

        {/* SSO Buttons - visible on signin */}
        {mode === 'signin' && (
          <div className="space-y-3 mb-6">
            <Button
              variant="outline"
              size="lg"
              className="w-full justify-start gap-3 h-12 text-sm"
              onClick={handleMicrosoftSSO}
              disabled={ssoLoading !== null}
            >
              {ssoLoading === 'microsoft' ? <Loader2 className="w-5 h-5 animate-spin" /> : <MicrosoftIcon />}
              <span className="flex-1 text-left">Continue with Microsoft</span>
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="w-full justify-start gap-3 h-12 text-sm"
              onClick={handleGoogleSSO}
              disabled={ssoLoading !== null}
            >
              {ssoLoading === 'google' ? <Loader2 className="w-5 h-5 animate-spin" /> : <GoogleIcon />}
              <span className="flex-1 text-left">Continue with Google</span>
            </Button>

            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">or</span>
              </div>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'signup' && (
            <div className="space-y-2">
              <Label htmlFor="fullName">Full Name</Label>
              <Input
                id="fullName"
                placeholder="John Doe"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                disabled={loading}
                className={errors.fullName ? 'border-destructive' : ''}
              />
              {errors.fullName && <p className="text-xs text-destructive">{errors.fullName}</p>}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              className={errors.email ? 'border-destructive' : ''}
            />
            {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
          </div>

          {mode !== 'forgot-password' && (
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                className={errors.password ? 'border-destructive' : ''}
              />
              {errors.password && <p className="text-xs text-destructive">{errors.password}</p>}
            </div>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {mode === 'forgot-password' ? 'Send Reset Link' : mode === 'signup' ? 'Create Account' : 'Sign In'}
          </Button>
        </form>

        {/* Mode switching links */}
        <div className="mt-6 space-y-2 text-center text-sm">
          {mode === 'signin' && (
            <>
              <p className="text-muted-foreground">
                Don't have an account?{' '}
                <button type="button" onClick={() => { setMode('signup'); setErrors({}); }} className="font-medium text-foreground hover:underline">
                  Sign Up
                </button>
              </p>
              <p>
                <button type="button" onClick={() => { setMode('forgot-password'); setErrors({}); }} className="text-muted-foreground hover:text-foreground transition-colors">
                  Forgot password?
                </button>
              </p>
            </>
          )}
          {mode === 'signup' && (
            <p className="text-muted-foreground">
              Already have an account?{' '}
              <button type="button" onClick={() => { setMode('signin'); setErrors({}); }} className="font-medium text-foreground hover:underline">
                Sign In
              </button>
            </p>
          )}
          {mode === 'forgot-password' && (
            <p className="text-muted-foreground">
              Remember your password?{' '}
              <button type="button" onClick={() => { setMode('signin'); setErrors({}); }} className="font-medium text-foreground hover:underline">
                Sign In
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
