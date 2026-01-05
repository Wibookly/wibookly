import { useState } from 'react';
import { Header } from '@/components/landing/Header';
import { Hero } from '@/components/landing/Hero';
import { HowItWorks } from '@/components/landing/HowItWorks';
import { Features } from '@/components/landing/Features';
import { Security } from '@/components/landing/Security';
import { SignInDialog } from '@/components/landing/SignInDialog';
import { Footer } from '@/components/landing/Footer';

export default function Landing() {
  const [signInOpen, setSignInOpen] = useState(false);

  return (
    <div className="min-h-screen">
      {/* Superhuman-style gradient hero section */}
      <div className="bg-[image:var(--gradient-hero)] min-h-screen">
        <Header onSignInClick={() => setSignInOpen(true)} />
        <main>
          <Hero onGetStartedClick={() => setSignInOpen(true)} />
        </main>
      </div>
      {/* Content sections with solid background */}
      <div className="bg-background">
        <HowItWorks />
        <Features />
        <Security />
        <Footer />
      </div>
      
      <SignInDialog open={signInOpen} onOpenChange={setSignInOpen} />
    </div>
  );
}
