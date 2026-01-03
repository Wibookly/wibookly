import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export function Header() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 backdrop-blur-md bg-transparent">
      <div className="container mx-auto px-6">
        <div className="flex items-center justify-between h-16">
          <Link to="/" className="text-xl font-semibold tracking-tight text-foreground">
            Webookly
          </Link>

          <nav className="hidden md:flex items-center gap-8">
            <a href="#how-it-works" className="text-sm text-foreground/70 hover:text-foreground transition-colors">
              Product
            </a>
            <a href="#features" className="text-sm text-foreground/70 hover:text-foreground transition-colors">
              How It Works
            </a>
            <a href="#security" className="text-sm text-foreground/70 hover:text-foreground transition-colors">
              Security
            </a>
          </nav>

          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild className="text-foreground hover:bg-foreground/10">
              <Link to="/auth">Sign In</Link>
            </Button>
            <Button size="sm" asChild className="bg-card text-foreground hover:bg-card/90 border-0">
              <Link to="/auth?mode=signup">Get Started</Link>
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
