import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NikkoreInboxLogo } from './NikkoreInboxLogo';
import energyForwardLogo from '@/assets/energyforward-logo.png';

interface MobileHeaderProps {
  onMenuClick: () => void;
}

export function MobileHeader({ onMenuClick }: MobileHeaderProps) {
  return (
    <header className="lg:hidden flex items-center justify-between p-4 border-b border-border bg-card">
      <div className="flex items-center gap-2">
        <img src={energyForwardLogo} alt="Nikkore" className="h-8 w-auto object-contain" />
        <NikkoreInboxLogo className="text-2xl" />
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onMenuClick}>
          <Menu className="h-5 w-5" />
        </Button>
      </div>
    </header>
  );
}
