import * as Icons from 'lucide-react';

export function Icon({ name, className }: { name: string; className?: string }) {
  const Cmp = (Icons as any)[name] ?? Icons.Circle;
  return <Cmp className={className} />;
}
