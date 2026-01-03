import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';

export function Hero() {
  return (
    <section className="pt-32 pb-20 md:pt-48 md:pb-40">
      <div className="container mx-auto px-6">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-semibold tracking-tight leading-tight animate-fade-in text-foreground">
            Your inbox, organized
            <br />
            and drafted for you.
          </h1>
          <p className="mt-6 text-lg md:text-xl text-foreground/70 max-w-2xl mx-auto animate-fade-in">
            Connect Outlook. Create smart categories. Let AI draft replies — always under your control.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4 animate-fade-in">
            <Button size="lg" asChild className="group bg-card text-foreground hover:bg-card/90 shadow-lg px-8">
              <Link to="/auth?mode=signup">
                Get Started
                <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
