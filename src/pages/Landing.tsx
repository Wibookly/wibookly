import { useNavigate } from 'react-router-dom';
import { Header } from '@/components/landing/Header';
import { Hero } from '@/components/landing/Hero';
import { HowItWorks } from '@/components/landing/HowItWorks';
import { Features } from '@/components/landing/Features';
import { Security } from '@/components/landing/Security';
import { Footer } from '@/components/landing/Footer';

export default function Landing() {
  const navigate = useNavigate();

  const handleSignIn = () => {
    navigate('/auth');
  };

  const handleGetStarted = () => {
    navigate('/auth?mode=signup');
  };

  return (
    <div className="min-h-screen">
      {/* Superhuman-style gradient hero section */}
      <div className="bg-[image:var(--gradient-hero)] min-h-screen">
        <Header onSignInClick={handleSignIn} />
        <main>
          <Hero onGetStartedClick={handleGetStarted} />
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
