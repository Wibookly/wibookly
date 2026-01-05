import { Button } from '@/components/ui/button';
import { ArrowRight, Sparkles, Mail, FolderOpen } from 'lucide-react';

interface HeroProps {
  onGetStartedClick: () => void;
}

export function Hero({ onGetStartedClick }: HeroProps) {
  return (
    <section className="pt-32 pb-16 md:pt-44 md:pb-24 overflow-hidden">
      <div className="container mx-auto px-6">
        <div className="max-w-3xl mx-auto text-center">
          {/* Headline */}
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-semibold tracking-tight leading-[1.1] animate-fade-in text-foreground">
            Your inbox, organized
            <br />
            and handled for you.
          </h1>
          
          {/* Sub-headline */}
          <p className="mt-8 text-xl md:text-2xl text-muted-foreground max-w-2xl mx-auto leading-relaxed animate-fade-in" style={{ animationDelay: '100ms' }}>
            Wibookly brings clarity to your inbox by organizing messages, creating smart categories, and drafting thoughtful replies — all with AI working quietly in the background.
          </p>
          
          {/* CTA Button */}
          <div className="mt-10 animate-fade-in" style={{ animationDelay: '200ms' }}>
            <Button 
              size="lg" 
              className="group px-8 py-6 text-base font-medium"
              onClick={onGetStartedClick}
            >
              Get Started
              <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Button>
          </div>
          
          {/* Trust line */}
          <p className="mt-6 text-sm text-muted-foreground/70 animate-fade-in" style={{ animationDelay: '300ms' }}>
            You stay in control.
          </p>
        </div>

        {/* AI Visual Element */}
        <div className="mt-16 max-w-4xl mx-auto animate-fade-in" style={{ animationDelay: '400ms' }}>
          <div className="relative rounded-2xl bg-card/50 backdrop-blur-sm border border-border/50 p-8 md:p-12">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Inbox Card */}
              <div className="flex flex-col items-center text-center p-6 rounded-xl bg-background/50 border border-border/30">
                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                  <Mail className="w-7 h-7 text-primary" />
                </div>
                <h3 className="font-medium text-foreground mb-2">Smart Inbox</h3>
                <p className="text-sm text-muted-foreground">Emails sorted automatically</p>
              </div>
              
              {/* Categories Card */}
              <div className="flex flex-col items-center text-center p-6 rounded-xl bg-background/50 border border-border/30">
                <div className="w-14 h-14 rounded-full bg-accent/20 flex items-center justify-center mb-4">
                  <FolderOpen className="w-7 h-7 text-accent-foreground" />
                </div>
                <h3 className="font-medium text-foreground mb-2">Categories</h3>
                <p className="text-sm text-muted-foreground">Organized by context</p>
              </div>
              
              {/* AI Draft Card */}
              <div className="flex flex-col items-center text-center p-6 rounded-xl bg-background/50 border border-border/30">
                <div className="w-14 h-14 rounded-full bg-success/20 flex items-center justify-center mb-4">
                  <Sparkles className="w-7 h-7 text-success" />
                </div>
                <h3 className="font-medium text-foreground mb-2">AI Drafts</h3>
                <p className="text-sm text-muted-foreground">Replies ready for review</p>
              </div>
            </div>
            
            {/* Decorative glow */}
            <div className="absolute -inset-1 bg-gradient-to-r from-primary/20 via-transparent to-accent/20 rounded-2xl blur-xl -z-10" />
          </div>
        </div>
      </div>
    </section>
  );
}
