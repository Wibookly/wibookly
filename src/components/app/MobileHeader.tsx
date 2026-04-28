import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InboxIQLogo } from './InboxIQLogo';

interface MobileHeaderProps {
  onMenuClick: () => void;
}

export function MobileHeader({ onMenuClick }: MobileHeaderProps) {
  return (
    <header className="lg:hidden flex items-center justify-between p-4 border-b border-border bg-card">
      <InboxIQLogo className="text-3xl" />
      <Button variant="ghost" size="icon" onClick={onMenuClick}>
        <Menu className="h-5 w-5" />
      </Button>
    </header>
  );
}
