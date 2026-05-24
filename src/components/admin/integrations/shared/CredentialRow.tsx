import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { useUpdateSecret } from '../hooks/useUpdateSecret';

export function CredentialRow({ label, secret }: { label: string; secret: string }) {
  const [value, setValue] = useState('');
  const { save, saving } = useUpdateSecret();
  const busy = saving === secret;
  return (
    <div className="grid grid-cols-12 gap-3 items-end py-2">
      <div className="col-span-4">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <div className="text-[11px] font-mono text-muted-foreground/70">{secret}</div>
      </div>
      <div className="col-span-6">
        <Input
          type="password"
          autoComplete="new-password"
          placeholder="••••••••"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={busy}
        />
      </div>
      <div className="col-span-2">
        <Button
          size="sm"
          className="w-full"
          disabled={!value || busy}
          onClick={async () => {
            const ok = await save(secret, value);
            if (ok) setValue('');
          }}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Test & save'}
        </Button>
      </div>
    </div>
  );
}
