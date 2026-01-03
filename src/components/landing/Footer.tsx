import { Link } from 'react-router-dom';
import wibooklyLogo from '@/assets/wibookly-logo.png';

export function Footer() {
  return (
    <footer className="py-16 border-t border-border">
      <div className="container mx-auto px-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-8">
          <Link to="/" className="flex items-center group">
            <img 
              src={wibooklyLogo} 
              alt="Wibookly" 
              className="h-32 w-auto transition-transform duration-300 group-hover:scale-105"
            />
          </Link>

          <nav className="flex items-center gap-8 text-sm text-muted-foreground">
            <Link to="/terms" className="hover:text-foreground transition-colors">
              Terms
            </Link>
            <Link to="/privacy" className="hover:text-foreground transition-colors">
              Privacy
            </Link>
            <a href="mailto:hello@mailflow.app" className="hover:text-foreground transition-colors">
              Contact
            </a>
          </nav>

          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} Webookly. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
