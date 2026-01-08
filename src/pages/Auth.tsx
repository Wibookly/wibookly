import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ArrowLeft, Building2, Check, HelpCircle, User2, Mail } from 'lucide-react';
import { z } from 'zod';
import wibooklyLogo from '@/assets/wibookly-logo.png';
import { supabase } from '@/integrations/supabase/client';

// Google icon component
const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
    <path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      fill="#4285F4"
    />
    <path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34A853"
    />
    <path
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      fill="#EA4335"
    />
  </svg>
);

// Outlook icon component
const OutlookIcon = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
    <path fill="#0078D4" d="M24 7.387v10.478c0 .23-.08.424-.238.576-.158.152-.354.228-.588.228h-8.174v-6.5l1.5 1.313c.095.082.21.123.346.123.135 0 .25-.041.345-.123l6.62-5.783c.12-.104.189-.247.189-.312z"/>
    <path fill="#0078D4" d="M15 18.67V6.5h8.174c.234 0 .43.076.588.228.158.152.238.346.238.576v.083L17.5 13l-2.5-2.187V18.67z"/>
    <path fill="#0078D4" d="M0 5.5v13.75c0 .414.336.75.75.75h8.5c.414 0 .75-.336.75-.75V5.5c0-.414-.336-.75-.75-.75H.75C.336 4.75 0 5.086 0 5.5z"/>
    <path fill="#fff" d="M5 16.25c-1.795 0-3.25-1.455-3.25-3.25S3.205 9.75 5 9.75 8.25 11.205 8.25 13 6.795 16.25 5 16.25zm0-5c-.965 0-1.75.785-1.75 1.75S4.035 14.75 5 14.75 6.75 13.965 6.75 13 5.965 11.25 5 11.25z"/>
  </svg>
);

const signInSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters')
});

interface UserOrganization {
  id: string;
  name: string;
  role: string;
}

type AuthMode = 'signin' | 'signup' | 'forgot-password' | 'select-org';

export default function Auth() {
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<AuthMode>(searchParams.get('mode') === 'signup' ? 'signup' : 'signin');
  const [workspaceType, setWorkspaceType] = useState<'personal' | 'business' | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [connectingProvider, setConnectingProvider] = useState<'google' | 'outlook' | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [userOrganizations, setUserOrganizations] = useState<UserOrganization[]>([]);
  const [resetEmailSent, setResetEmailSent] = useState(false);

  const { signIn, user, setSelectedOrganization } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    if (user && mode !== 'select-org') {
      navigate('/integrations');
    }
  }, [user, navigate, mode]);

  const validateForm = () => {
    try {
      if (mode === 'signin') {
        signInSchema.parse({ email, password });
      } else if (mode === 'forgot-password') {
        z.string().email('Please enter a valid email address').parse(email);
      }
      setErrors({});
      return true;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const newErrors: Record<string, string> = {};
        error.errors.forEach((err) => {
          if (err.path[0]) {
            newErrors[err.path[0] as string] = err.message;
          } else {
            newErrors.email = err.message;
          }
        });
        setErrors(newErrors);
      }
      return false;
    }
  };

  const handleForgotPassword = async () => {
    if (!validateForm()) return;
    
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth?mode=reset`
      });
      
      if (error) throw error;
      
      setResetEmailSent(true);
      toast({
        title: 'Reset email sent',
        description: 'Check your inbox for password reset instructions.'
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to send reset email.',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSelectOrganization = (org: UserOrganization) => {
    setSelectedOrganization(org.id);
    navigate('/integrations');
  };

  const handleOAuthSignup = async (provider: 'google' | 'outlook') => {
    if (!workspaceType) {
      toast({
        title: 'Select workspace type',
        description: 'Please select Personal or Business first.',
        variant: 'destructive'
      });
      return;
    }

    setConnectingProvider(provider);

    try {
      // Store workspace type for after OAuth callback
      sessionStorage.setItem('wibookly_signup_workspace_type', workspaceType);
      
      const redirectUrl = `${window.location.origin}/integrations?signup=complete`;
      
      if (provider === 'google') {
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: redirectUrl,
            queryParams: {
              access_type: 'offline',
              prompt: 'consent',
            },
          },
        });

        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'azure',
          options: {
            redirectTo: redirectUrl,
            scopes: 'openid email profile'
          }
        });
        
        if (error) throw error;
      }
    } catch (error: any) {
      console.error('OAuth signup error:', error);
      toast({
        title: 'Connection failed',
        description: error.message || 'Failed to connect. Please try again.',
        variant: 'destructive'
      });
      setConnectingProvider(null);
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
      const { error } = await signIn(email, password);
      if (error) {
        if (error.message.includes('Invalid login credentials')) {
          toast({
            title: 'Invalid credentials',
            description: 'Please check your email and password.',
            variant: 'destructive'
          });
        } else {
          throw error;
        }
      } else {
        const { data: session } = await supabase.auth.getSession();
        if (session?.session?.user) {
          const { data: orgs } = await supabase.rpc('get_user_organizations', {
            _user_id: session.session.user.id
          });
          
          if (orgs && orgs.length > 1) {
            setUserOrganizations(orgs);
            setMode('select-org');
          } else {
            navigate('/integrations');
          }
        } else {
          navigate('/integrations');
        }
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Something went wrong. Please try again.',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  // Organization selection screen
  if (mode === 'select-org') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/25 via-background to-accent/20 flex flex-col">
        <header className="p-6 flex items-center justify-between">
          <button 
            onClick={() => {
              supabase.auth.signOut();
              setMode('signin');
              setUserOrganizations([]);
            }}
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Sign out
          </button>
        </header>

        <main className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-sm bg-card/80 backdrop-blur-sm p-8 rounded-2xl shadow-lg border border-border/50">
            <div className="text-center mb-8">
              <img src={wibooklyLogo} alt="Wibookly" className="h-24 w-auto mx-auto mb-6" />
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                Select Organization
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Choose which organization to access
              </p>
            </div>

            <div className="space-y-3">
              {userOrganizations.map((org) => (
                <button
                  key={org.id}
                  onClick={() => handleSelectOrganization(org)}
                  className="w-full flex items-center gap-3 p-4 rounded-lg border border-border bg-background hover:bg-accent/50 transition-colors text-left group"
                >
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Building2 className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground truncate">{org.name}</p>
                    <p className="text-xs text-muted-foreground capitalize">{org.role}</p>
                  </div>
                  <Check className="w-5 h-5 text-primary opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              ))}
            </div>
          </div>
        </main>
      </div>
    );
  }

  // Forgot password success screen
  if (mode === 'forgot-password' && resetEmailSent) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/25 via-background to-accent/20 flex flex-col">
        <header className="p-6 flex items-center justify-between">
          <button 
            onClick={() => {
              setMode('signin');
              setResetEmailSent(false);
            }}
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to sign in
          </button>
        </header>

        <main className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-sm bg-card/80 backdrop-blur-sm p-8 rounded-2xl shadow-lg border border-border/50 text-center">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
              <Check className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground mb-2">
              Check your email
            </h1>
            <p className="text-muted-foreground mb-6">
              We've sent password reset instructions to <span className="font-medium text-foreground">{email}</span>
            </p>
            <Button 
              variant="outline" 
              className="w-full"
              onClick={() => {
                setMode('signin');
                setResetEmailSent(false);
              }}
            >
              Back to sign in
            </Button>
          </div>
        </main>
      </div>
    );
  }

  // Signup flow - Two steps: workspace type then OAuth
  if (mode === 'signup') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/25 via-background to-accent/20 flex flex-col">
        <header className="p-6 flex items-center justify-between">
          <button 
            onClick={() => {
              if (workspaceType) {
                setWorkspaceType(null);
              } else {
                setMode('signin');
              }
            }}
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            {workspaceType ? 'Back' : 'Back to sign in'}
          </button>
        </header>

        <main className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-lg">
            {/* Progress indicator */}
            <div className="flex items-center justify-center gap-3 mb-8">
              <div className={`flex items-center gap-2 ${!workspaceType ? 'text-primary' : 'text-muted-foreground'}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${!workspaceType ? 'bg-primary text-primary-foreground' : 'bg-primary/20 text-primary'}`}>
                  {workspaceType ? <Check className="w-4 h-4" /> : '1'}
                </div>
                <span className="text-sm font-medium hidden sm:inline">Workspace Type</span>
              </div>
              <div className="w-8 h-px bg-border" />
              <div className={`flex items-center gap-2 ${workspaceType ? 'text-primary' : 'text-muted-foreground'}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${workspaceType ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                  2
                </div>
                <span className="text-sm font-medium hidden sm:inline">Connect Account</span>
              </div>
            </div>

            <div className="bg-card/80 backdrop-blur-sm p-8 rounded-2xl shadow-lg border border-border/50">
              {/* Step 1: Workspace Type */}
              {!workspaceType && (
                <>
                  <div className="text-center mb-8">
                    <img src={wibooklyLogo} alt="Wibookly" className="h-28 w-auto mx-auto mb-6" />
                    <h1 className="text-3xl font-bold tracking-tight text-primary">
                      Create your workspace
                    </h1>
                    <p className="mt-2 text-lg text-foreground">
                      How will you use Wibookly?
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <button
                      type="button"
                      onClick={() => setWorkspaceType('personal')}
                      className="p-6 rounded-xl border-2 border-border hover:border-primary/50 hover:bg-accent/50 text-left transition-all"
                    >
                      <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center mb-4">
                        <User2 className="w-6 h-6" />
                      </div>
                      <h3 className="text-lg font-semibold text-foreground mb-1">Personal</h3>
                      <p className="text-sm text-muted-foreground">
                        For individual use. Manage your personal emails.
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setWorkspaceType('business')}
                      className="p-6 rounded-xl border-2 border-border hover:border-primary/50 hover:bg-accent/50 text-left transition-all"
                    >
                      <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center mb-4">
                        <Building2 className="w-6 h-6" />
                      </div>
                      <h3 className="text-lg font-semibold text-foreground mb-1">Business</h3>
                      <p className="text-sm text-muted-foreground">
                        For work. AI uses your professional context.
                      </p>
                    </button>
                  </div>
                </>
              )}

              {/* Step 2: Connect Account via OAuth */}
              {workspaceType && (
                <>
                  <div className="text-center mb-8">
                    <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                      <Mail className="w-8 h-8 text-primary" />
                    </div>
                    <h1 className="text-2xl font-bold tracking-tight text-foreground">
                      Connect your {workspaceType === 'personal' ? 'personal' : 'work'} email
                    </h1>
                    <p className="mt-2 text-muted-foreground">
                      Sign up by connecting your email account
                    </p>
                  </div>

                  <div className="space-y-3">
                    <Button
                      variant="outline"
                      size="lg"
                      className="w-full justify-start gap-3 h-14 text-base"
                      onClick={() => handleOAuthSignup('google')}
                      disabled={connectingProvider !== null}
                    >
                      {connectingProvider === 'google' ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <GoogleIcon />
                      )}
                      <span className="flex-1 text-left">Continue with Google</span>
                    </Button>

                    <Button
                      variant="outline"
                      size="lg"
                      className="w-full justify-start gap-3 h-14 text-base"
                      onClick={() => handleOAuthSignup('outlook')}
                      disabled={connectingProvider !== null}
                    >
                      {connectingProvider === 'outlook' ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <OutlookIcon />
                      )}
                      <span className="flex-1 text-left">Continue with Outlook</span>
                    </Button>
                  </div>

                  <div className="mt-6 p-4 bg-muted/50 rounded-lg">
                    <div className="flex items-start gap-3">
                      <HelpCircle className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
                      <div className="text-sm text-muted-foreground">
                        <p className="font-medium text-foreground mb-1">What happens next:</p>
                        <ul className="space-y-1">
                          <li>• Your account is created automatically</li>
                          <li>• Your name is pulled from your email account</li>
                          <li>• You'll be redirected to connect email access</li>
                        </ul>
                      </div>
                    </div>
                  </div>

                  <p className="mt-6 text-center text-xs text-muted-foreground">
                    By continuing, you agree to our Terms of Service and Privacy Policy
                  </p>
                </>
              )}
            </div>

            <p className="mt-6 text-center text-sm text-muted-foreground">
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => {
                  setMode('signin');
                  setWorkspaceType(null);
                }}
                className="font-medium text-foreground hover:underline"
              >
                Sign In
              </button>
            </p>
          </div>
        </main>
      </div>
    );
  }

  // Sign in form
  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/25 via-background to-accent/20 flex flex-col">
      <header className="p-6 flex items-center justify-between">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back to home
        </Link>
      </header>

      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm bg-card/80 backdrop-blur-sm p-8 rounded-2xl shadow-lg border border-border/50">
          <div className="text-center mb-8">
            <img src={wibooklyLogo} alt="Wibookly" className="h-40 w-auto mx-auto mb-6" />
            <h1 className="text-3xl font-bold tracking-tight text-primary">
              {mode === 'forgot-password' ? 'Reset Password' : 'Welcome back'}
            </h1>
            <p className="mt-2 text-lg text-foreground">
              {mode === 'forgot-password' ? 'Enter your email' : 'Sign in to continue'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
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
              {mode === 'forgot-password' ? 'Send Reset Link' : 'Sign In'}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Don't have an account?{' '}
            <button
              type="button"
              onClick={() => {
                setMode('signup');
                setErrors({});
              }}
              className="font-medium text-foreground hover:underline"
            >
              Sign Up
            </button>
          </p>

          {mode === 'signin' && (
            <p className="mt-4 text-center">
              <button 
                type="button" 
                onClick={() => {
                  setMode('forgot-password');
                  setErrors({});
                }}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Forgot password?
              </button>
            </p>
          )}

          {mode === 'forgot-password' && (
            <p className="mt-6 text-center text-sm text-muted-foreground">
              Remember your password?{' '}
              <button
                type="button"
                onClick={() => {
                  setMode('signin');
                  setErrors({});
                }}
                className="font-medium text-foreground hover:underline"
              >
                Sign In
              </button>
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
