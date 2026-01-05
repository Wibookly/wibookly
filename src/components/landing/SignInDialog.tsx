import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Mail, Lock, ArrowRight, User, Building2, Briefcase } from 'lucide-react';
import { z } from 'zod';
import logo from '@/assets/wibookly-logo.png';

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
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const navigate = useNavigate();
  const { toast } = useToast();
  const { signUp, signIn } = useAuth();

  const validateForm = () => {
    try {
      if (mode === 'signup') {
        signUpSchema.parse({ email, password, fullName, organizationName, title: title || undefined });
      } else {
        signInSchema.parse({ email, password });
      }
      setErrors({});
      return true;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const newErrors: Record<string, string> = {};
        error.errors.forEach((err) => {
          if (err.path[0]) {
            newErrors[err.path[0] as string] = err.message;
          }
        });
        setErrors(newErrors);
      }
      return false;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-background/40 backdrop-blur-xl border border-white/20 shadow-[0_8px_32px_rgba(0,0,0,0.12),0_0_80px_rgba(var(--primary)/0.15),inset_0_1px_0_rgba(255,255,255,0.2)] ring-1 ring-white/10">
        <DialogHeader className="text-center">
          <img src={logo} alt="Wibookly" className="h-32 mx-auto mb-4" />
          <DialogTitle className="text-2xl font-semibold">
            {mode === 'signin' ? 'Welcome back' : 'Get started free'}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            {mode === 'signin' 
              ? 'Sign in to access your AI-powered inbox' 
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
                {mode === 'signin' ? 'Sign In' : 'Create Account'}
                <ArrowRight className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
        </form>

        <div className="mt-4 text-center text-sm">
          {mode === 'signin' ? (
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
          ) : (
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
