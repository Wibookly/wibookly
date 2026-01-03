import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';
import mockupInbox from '@/assets/mockup-inbox.png';
import mockupAiDraft from '@/assets/mockup-ai-draft.png';
import wibooklyLogo from '@/assets/wibookly-logo.png';

export function Hero() {
  return (
    <section className="pt-32 pb-20 md:pt-40 md:pb-32 overflow-hidden">
      <div className="container mx-auto px-6">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-semibold tracking-tight leading-tight animate-fade-in text-foreground">
            Your inbox, organized
            <br />
            and drafted for you.
          </h1>
          <p className="mt-6 text-lg md:text-xl text-foreground/70 max-w-2xl mx-auto animate-fade-in" style={{ animationDelay: '100ms' }}>
            Connect Outlook. Create smart categories. Let AI draft replies — always under your control.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4 animate-fade-in" style={{ animationDelay: '200ms' }}>
            <Button size="lg" asChild className="group bg-card text-foreground hover:bg-card/90 shadow-lg px-8">
              <Link to="/auth?mode=signup">
                Get Started
                <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>
            </Button>
          </div>
        </div>

        {/* Floating Mockups */}
        <div className="relative mt-20 md:mt-28 max-w-6xl mx-auto">
          {/* Main inbox mockup */}
          <div 
            className="relative z-10 animate-fade-in rounded-xl overflow-hidden shadow-2xl border border-border/20 bg-card"
            style={{ animationDelay: '300ms' }}
          >
            {/* Logo watermark on mockup */}
            <div className="absolute top-4 left-4 z-20">
              <img src={wibooklyLogo} alt="Wibookly" className="h-6 w-auto opacity-80" />
            </div>
            <img
              src={mockupInbox} 
              alt="Wibookly Inbox Dashboard"
              className="w-full h-auto"
            />
          </div>
          
          {/* Floating AI draft card */}
          <div 
            className="absolute -bottom-8 -right-4 md:-right-12 w-48 md:w-72 z-20 animate-fade-in rounded-xl overflow-hidden shadow-xl border border-border/30 hover:-translate-y-2 transition-transform duration-300 bg-card"
            style={{ animationDelay: '500ms' }}
          >
            {/* Logo watermark on AI draft mockup */}
            <div className="absolute top-2 left-2 z-20">
              <img src={wibooklyLogo} alt="Wibookly" className="h-4 w-auto opacity-80" />
            </div>
            <img 
              src={mockupAiDraft} 
              alt="AI Draft Reply Feature" 
              className="w-full h-auto"
            />
          </div>

          {/* Decorative glow effects */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[120%] h-[120%] bg-primary/5 rounded-full blur-3xl -z-10" />
        </div>
      </div>
    </section>
  );
}
