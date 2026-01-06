import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Mail, Lock, ArrowRight, User, Building2, Briefcase, ArrowLeft, Check } from 'lucide-react';
import { z } from 'zod';
import logo from '@/assets/wibookly-logo.png';
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

interface SignInDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SignInDialog({ open, onOpenChange }: SignInDialogProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot-password'>('signin');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [resetEmailSent, setResetEmailSent] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { signUp, signIn } = useAuth();

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
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to send reset email.';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive'
      });
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
          onOpenChange(false);
          navigate('/integrations');
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
          onOpenChange(false);
          navigate('/integrations');
        }
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Authentication failed';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  // Reset email sent success view
  if (mode === 'forgot-password' && resetEmailSent) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md bg-card/95 backdrop-blur-md border-border">
          <div className="text-center py-4">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
              <Check className="w-8 h-8 text-primary" />
            </div>
            <DialogTitle className="text-2xl font-semibold mb-2">
              Check your email
            </DialogTitle>
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
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to sign in
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-card/95 backdrop-blur-md border-border">
        <DialogHeader className="text-center">
          <img src={logo} alt="Wibookly" className="h-32 mx-auto mb-4" />
          <DialogTitle className="text-2xl font-semibold">
            {mode === 'signin' ? 'Welcome back' : mode === 'forgot-password' ? 'Reset Password' : 'Get started free'}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            {mode === 'signin' 
              ? 'Sign in to access your AI-powered inbox' 
              : mode === 'forgot-password'
              ? "Enter your email and we'll send you reset instructions"
              : 'Create your account to organize your inbox'}
          </p>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label htmlFor="dialog-email">Email</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="dialog-email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={`pl-10 ${errors.email ? 'border-destructive' : ''}`}
                required
              />
            </div>
            {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
          </div>

          {mode !== 'forgot-password' && (
            <div className="space-y-2">
              <Label htmlFor="dialog-password">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="dialog-password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`pl-10 ${errors.password ? 'border-destructive' : ''}`}
                  required
                  minLength={6}
                />
              </div>
              {errors.password && <p className="text-xs text-destructive">{errors.password}</p>}
            </div>
          )}

          {mode === 'signup' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="dialog-fullName">Full Name <span className="text-destructive">*</span></Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="dialog-fullName"
                    type="text"
                    placeholder="John Doe"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className={`pl-10 ${errors.fullName ? 'border-destructive' : ''}`}
                    required
                  />
                </div>
                {errors.fullName && <p className="text-xs text-destructive">{errors.fullName}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="dialog-organizationName">Organization Name <span className="text-destructive">*</span></Label>
                <div className="relative">
                  <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="dialog-organizationName"
                    type="text"
                    placeholder="Acme Inc."
                    value={organizationName}
                    onChange={(e) => setOrganizationName(e.target.value)}
                    className={`pl-10 ${errors.organizationName ? 'border-destructive' : ''}`}
                    required
                  />
                </div>
                {errors.organizationName && <p className="text-xs text-destructive">{errors.organizationName}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="dialog-title">Title <span className="text-muted-foreground text-xs">(Optional)</span></Label>
                <div className="relative">
                  <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="dialog-title"
                    type="text"
                    placeholder="e.g. Sales Manager, CEO"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className={`pl-10 ${errors.title ? 'border-destructive' : ''}`}
                  />
                </div>
                {errors.title && <p className="text-xs text-destructive">{errors.title}</p>}
              </div>
            </>
          )}

          <Button type="submit" className="w-full" size="lg" disabled={loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                {mode === 'signin' ? 'Sign In' : mode === 'forgot-password' ? 'Send Reset Link' : 'Create Account'}
                <ArrowRight className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
        </form>

        <div className="mt-4 text-center text-sm space-y-2">
          {mode === 'signin' && (
            <>
              <p className="text-muted-foreground">
                Don't have an account?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setMode('signup');
                    setErrors({});
                  }}
                  className="text-primary hover:underline font-medium"
                >
                  Sign up
                </button>
              </p>
              <button
                type="button"
                onClick={() => {
                  setMode('forgot-password');
                  setErrors({});
                }}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                Forgot password?
              </button>
            </>
          )}
          
          {mode === 'signup' && (
            <p className="text-muted-foreground">
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => {
                  setMode('signin');
                  setErrors({});
                }}
                className="text-primary hover:underline font-medium"
              >
                Sign in
              </button>
            </p>
          )}
          
          {mode === 'forgot-password' && (
            <p className="text-muted-foreground">
              Remember your password?{' '}
              <button
                type="button"
                onClick={() => {
                  setMode('signin');
                  setErrors({});
                }}
                className="text-primary hover:underline font-medium"
              >
                Sign in
              </button>
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
