import { cn } from '@/lib/utils';
import nikkoreLogo from '@/assets/nikkore-logo.png.asset.json';

interface NikkoreInboxLogoProps {
  className?: string;
}

export function NikkoreInboxLogo({ className }: NikkoreInboxLogoProps) {
  return (
    <span className={cn('inline-flex flex-col items-center', className)} aria-label="Nikkore Inbox">
      <img src={nikkoreLogo.url} alt="Nikkore" className="h-[1em] w-auto object-contain" />
      <span className="mt-1 text-[0.38em] font-semibold uppercase tracking-[0.28em] text-muted-foreground">
        Inbox
      </span>
    </span>
  );
}
