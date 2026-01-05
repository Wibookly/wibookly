import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ArrowLeft, Building2, Check } from 'lucide-react';
import { z } from 'zod';
import wibooklyLogo from '@/assets/wibookly-logo.png';
import { supabase } from '@/integrations/supabase/client';

const signInSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters')
});

const signUpSchema = signInSchema.extend({
  fullName: z.string().min(2, 'Full name must be at least 2 characters').max(100, 'Full name is too long'),
  organizationName: z.string().min(2, 'Organization name must be at least 2 characters').max(100, 'Organization name is too long'),
  title: z.string().max(100, 'Title is too long').optional()
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
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [userOrganizations, setUserOrganizations] = useState<UserOrganization[]>([]);
  const [resetEmailSent, setResetEmailSent] = useState(false);

  const { signIn, signUp, user, setSelectedOrganization } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    if (user && mode !== 'select-org') {
      navigate('/dashboard');
    }
  }, [user, navigate, mode]);

  const validateForm = () => {
    try {
      if (mode === 'signup') {
        signUpSchema.parse({ email, password, fullName, organizationName, title: title || undefined });
      } else if (mode === 'signin') {
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
    navigate('/dashboard');
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
        const { error } = await signUp(email, password, organizationName, fullName, title || undefined);
        if (error) {
          if (error.message.includes('already registered')) {
            toast({
              title: 'Account exists',
              description: 'This email is already registered. Please sign in instead.',
              variant: 'destructive'
            });
          } else {
            throw error;
          }
        } else {
          toast({
            title: 'Account created',
            description: 'Welcome to Wibookly!'
          });
          navigate('/dashboard');
        }
      } else {
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
          // After successful sign in, check for multiple organizations
          const { data: session } = await supabase.auth.getSession();
          if (session?.session?.user) {
            const { data: orgs } = await supabase.rpc('get_user_organizations', {
              _user_id: session.session.user.id
            });
            
            if (orgs && orgs.length > 1) {
              setUserOrganizations(orgs);
              setMode('select-org');
            } else {
              navigate('/dashboard');
            }
          } else {
            navigate('/dashboard');
          }
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
              {mode === 'forgot-password' ? 'Reset Password' : 'Welcome'}
            </h1>
            <p className="mt-2 text-lg text-foreground">
              {mode === 'signup' ? 'Create your account' : mode === 'forgot-password' ? 'Enter your email' : 'Sign in to continue'}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {mode === 'signup' ? 'Start organizing your inbox today' : mode === 'forgot-password' ? 'We\'ll send you reset instructions' : 'Welcome back to Wibookly'}
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

            {mode === 'signup' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="fullName">Full Name <span className="text-destructive">*</span></Label>
                  <Input
                    id="fullName"
                    type="text"
                    placeholder="John Doe"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    disabled={loading}
                    className={errors.fullName ? 'border-destructive' : ''}
                  />
                  {errors.fullName && <p className="text-xs text-destructive">{errors.fullName}</p>}
                  <p className="text-xs text-muted-foreground">Used for AI-generated email signatures</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="organization">Organization Name <span className="text-destructive">*</span></Label>
                  <Input
                    id="organization"
                    type="text"
                    placeholder="Acme Inc."
                    value={organizationName}
                    onChange={(e) => setOrganizationName(e.target.value)}
                    disabled={loading}
                    className={errors.organizationName ? 'border-destructive' : ''}
                  />
                  {errors.organizationName && <p className="text-xs text-destructive">{errors.organizationName}</p>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="title">Title <span className="text-muted-foreground text-xs">(Optional)</span></Label>
                  <Input
                    id="title"
                    type="text"
                    placeholder="e.g. Sales Manager, CEO"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    disabled={loading}
                    className={errors.title ? 'border-destructive' : ''}
                  />
                  {errors.title && <p className="text-xs text-destructive">{errors.title}</p>}
                  <p className="text-xs text-muted-foreground">You can add your full email signature in Settings later</p>
                </div>
              </>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {mode === 'signup' ? 'Create Account' : mode === 'forgot-password' ? 'Send Reset Link' : 'Sign In'}
            </Button>
          </form>

          {mode !== 'forgot-password' && (
            <p className="mt-6 text-center text-sm text-muted-foreground">
              {mode === 'signup' ? 'Already have an account?' : "Don't have an account?"}{' '}
              <button
                type="button"
                onClick={() => {
                  setMode(mode === 'signup' ? 'signin' : 'signup');
                  setErrors({});
                }}
                className="font-medium text-foreground hover:underline"
              >
                {mode === 'signup' ? 'Sign In' : 'Sign Up'}
              </button>
            </p>
          )}

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