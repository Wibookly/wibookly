import { Header } from '@/components/landing/Header';
import { Hero } from '@/components/landing/Hero';
import { HowItWorks } from '@/components/landing/HowItWorks';
import { Features } from '@/components/landing/Features';
import { Security } from '@/components/landing/Security';
import { Footer } from '@/components/landing/Footer';

export default function Landing() {
  return (
    <div className="min-h-screen">
      {/* Superhuman-style gradient hero section */}
      <div className="bg-[image:var(--gradient-hero)] min-h-screen">
        <Header />
        <main>
          <Hero />
        </main>
      </div>
      {/* Content sections with solid background */}
      <div className="bg-background">
        <HowItWorks />
        <Features />
        <Security />
        <Footer />
      </div>
    </div>
  );
}
