import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';
import mockupInbox from '@/assets/mockup-inbox.png';
import mockupAiDraft from '@/assets/mockup-ai-draft.png';
import mockupCategories from '@/assets/mockup-categories.png';
import mockupIntegrations from '@/assets/mockup-integrations.png';
import mockupActivity from '@/assets/mockup-activity.png';

const mockups = [
  { src: mockupInbox, alt: 'Wibookly Inbox Dashboard' },
  { src: mockupCategories, alt: 'Smart Categories Management' },
  { src: mockupIntegrations, alt: 'Email Integrations' },
  { src: mockupActivity, alt: 'AI Activity Dashboard' },
];

export function Hero() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setIsTransitioning(true);
      setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % mockups.length);
        setIsTransitioning(false);
      }, 300);
    }, 4000);

    return () => clearInterval(interval);
  }, []);

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

        {/* Floating Mockups with Carousel */}
        <div className="relative mt-20 md:mt-28 max-w-6xl mx-auto">
          {/* Main mockup carousel */}
          <div 
            className="relative z-10 animate-fade-in rounded-xl overflow-hidden shadow-2xl border border-border/20"
            style={{ animationDelay: '300ms' }}
          >
            <img
              src={mockups[currentIndex].src}
              alt={mockups[currentIndex].alt}
              className={`w-full h-auto transition-opacity duration-300 ${isTransitioning ? 'opacity-0' : 'opacity-100'}`}
            />
          </div>
          
          {/* Floating AI draft card */}
          <div 
            className="absolute -bottom-8 -right-4 md:-right-12 w-48 md:w-72 z-20 animate-fade-in rounded-xl overflow-hidden shadow-xl border border-border/30 hover:-translate-y-2 transition-transform duration-300"
            style={{ animationDelay: '500ms' }}
          >
            <img 
              src={mockupAiDraft} 
              alt="AI Draft Reply Feature" 
              className="w-full h-auto"
            />
          </div>

          {/* Carousel indicators */}
          <div className="flex justify-center gap-2 mt-8">
            {mockups.map((_, index) => (
              <button
                key={index}
                onClick={() => {
                  setIsTransitioning(true);
                  setTimeout(() => {
                    setCurrentIndex(index);
                    setIsTransitioning(false);
                  }, 300);
                }}
                className={`w-2 h-2 rounded-full transition-all duration-300 ${
                  index === currentIndex 
                    ? 'bg-primary w-6' 
                    : 'bg-primary/30 hover:bg-primary/50'
                }`}
                aria-label={`View ${mockups[index].alt}`}
              />
            ))}
          </div>

          {/* Decorative glow effects */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[120%] h-[120%] bg-primary/5 rounded-full blur-3xl -z-10" />
        </div>
      </div>
    </section>
  );
}
