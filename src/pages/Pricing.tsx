import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Check, Zap, Sparkles, Crown, ArrowLeft } from 'lucide-react';


const plans = [
  {
    id: 'starter',
    name: 'Starter',
    price: 20,
    description: 'Perfect for individuals getting started with email automation',
    icon: Zap,
    iconColor: 'text-blue-500',
    bgGradient: 'from-blue-500/10 to-cyan-500/10',
    borderColor: 'border-blue-500/20',
    features: [
      '1 connected mailbox',
      'AI Auto Drafts',
      'Smart email categorization',
      '10 email categories',
      'Basic analytics',
      'Email support',
    ],
    notIncluded: [
      'AI Auto Reply',
      'Advanced automation rules',
      'AI email signature',
      'Advanced AI analytics',
    ],
  },
  {
    id: 'professional',
    name: 'Professional',
    price: 50,
    description: 'For professionals who need powerful automation and insights',
    icon: Sparkles,
    iconColor: 'text-primary',
    bgGradient: 'from-primary/20 to-accent/20',
    borderColor: 'border-primary/30',
    popular: true,
    features: [
      'Up to 4 connected mailboxes',
      'AI Auto Drafts',
      'AI Auto Reply',
      'Smart email categorization',
      'Unlimited email categories',
      'Advanced automation rules',
      'AI email signature',
      'Advanced AI analytics',
      'Priority support',
    ],
    notIncluded: [],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: null,
    description: 'For teams and organizations with advanced needs',
    icon: Crown,
    iconColor: 'text-amber-500',
    bgGradient: 'from-amber-500/10 to-orange-500/10',
    borderColor: 'border-amber-500/20',
    features: [
      'Unlimited connected mailboxes',
      'Everything in Professional',
      'Admin dashboard',
      'Team management',
      'License assignment',
      'Usage reporting',
      'Custom integrations',
      'Dedicated account manager',
      'SLA guarantee',
    ],
    notIncluded: [],
  },
];

export default function Pricing() {
  const navigate = useNavigate();

  const handleGetStarted = () => {
    navigate('/auth');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/25 via-background to-accent/20">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 backdrop-blur-md bg-background/5">
        <div className="container mx-auto px-6">
          <div className="flex items-center justify-between h-16">
            <Link to="/" className="flex items-center">
              <span className="text-lg font-semibold text-foreground">Email AI</span>
            </Link>
            </Link>

            <nav className="hidden md:flex items-center gap-8">
              <Link to="/#how-it-works" className="text-sm font-medium text-foreground/80 hover:text-foreground transition-colors">
                How It Works
              </Link>
              <Link to="/#features" className="text-sm font-medium text-foreground/80 hover:text-foreground transition-colors">
                Features
              </Link>
              <Link to="/pricing" className="text-sm font-medium text-foreground transition-colors">
                Pricing
              </Link>
            </nav>

            <div className="flex items-center gap-3">
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-foreground hover:bg-foreground/10"
                onClick={handleGetStarted}
              >
                Sign In
              </Button>
              <Button 
                size="sm" 
                className="bg-card text-foreground hover:bg-card/90 border-0"
                onClick={handleGetStarted}
              >
                Get Started
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="pt-32 pb-20 px-6">
        <div className="container mx-auto max-w-6xl">
          {/* Back Link */}
          <Link 
            to="/" 
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Home
          </Link>

          {/* Header */}
          <div className="text-center mb-16">
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
              Simple, transparent pricing
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Choose the plan that fits your needs. Upgrade or downgrade anytime.
            </p>
          </div>

          {/* Pricing Cards */}
          <div className="grid md:grid-cols-3 gap-8">
            {plans.map((plan) => {
              const Icon = plan.icon;
              return (
                <Card 
                  key={plan.id}
                  className={`relative overflow-hidden bg-gradient-to-br ${plan.bgGradient} ${plan.borderColor} border-2 ${plan.popular ? 'ring-2 ring-primary shadow-xl scale-105' : ''}`}
                >
                  {plan.popular && (
                    <div className="absolute top-0 right-0 bg-primary text-primary-foreground px-3 py-1 text-xs font-semibold rounded-bl-lg">
                      Most Popular
                    </div>
                  )}
                  <CardHeader className="pb-4">
                    <div className={`w-12 h-12 rounded-xl bg-background/80 flex items-center justify-center mb-4`}>
                      <Icon className={`w-6 h-6 ${plan.iconColor}`} />
                    </div>
                    <CardTitle className="text-2xl">{plan.name}</CardTitle>
                    <CardDescription className="text-foreground/70">
                      {plan.description}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pb-6">
                    <div className="mb-6">
                      {plan.price !== null ? (
                        <div className="flex items-baseline gap-1">
                          <span className="text-4xl font-bold">${plan.price}</span>
                          <span className="text-muted-foreground">/month</span>
                        </div>
                      ) : (
                        <div className="text-2xl font-semibold text-foreground">
                          Contact Sales
                        </div>
                      )}
                    </div>

                    <ul className="space-y-3">
                      {plan.features.map((feature, index) => (
                        <li key={index} className="flex items-start gap-3">
                          <Check className="w-5 h-5 text-success mt-0.5 flex-shrink-0" />
                          <span className="text-sm">{feature}</span>
                        </li>
                      ))}
                      {plan.notIncluded.map((feature, index) => (
                        <li key={`not-${index}`} className="flex items-start gap-3 opacity-50">
                          <div className="w-5 h-5 mt-0.5 flex-shrink-0 flex items-center justify-center">
                            <div className="w-1.5 h-0.5 bg-muted-foreground rounded" />
                          </div>
                          <span className="text-sm line-through">{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                  <CardFooter>
                    <Button 
                      className={`w-full ${plan.popular ? 'bg-primary hover:bg-primary/90' : ''}`}
                      variant={plan.popular ? 'default' : 'outline'}
                      size="lg"
                      onClick={handleGetStarted}
                    >
                      {plan.price === null ? 'Contact Sales' : 'Get Started'}
                    </Button>
                  </CardFooter>
                </Card>
              );
            })}
          </div>

          {/* FAQ Section */}
          <div className="mt-20 text-center">
            <h2 className="text-2xl font-bold mb-4">Questions?</h2>
            <p className="text-muted-foreground mb-6">
              Need help choosing? Contact us at{' '}
              <a href="mailto:support@wibookly.com" className="text-primary hover:underline">
                support@wibookly.com
              </a>
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/50 py-8 bg-background/50">
        <div className="container mx-auto px-6 text-center text-sm text-muted-foreground">
          © {new Date().getFullYear()} Wibookly. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
