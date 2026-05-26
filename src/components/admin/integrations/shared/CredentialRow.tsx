import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { useUpdateSecret } from '../hooks/useUpdateSecret';
import { useSecretStatus } from '../hooks/useSecretStatus';

export function CredentialRow({ label, secret }: { label: string; secret: string }) {
  const [value, setValue] = useState('');
  const { save, saving } = useUpdateSecret();
  const { secrets, loading, refresh } = useSecretStatus();
  const info = secrets[secret];
  const busy = saving === secret;
  const present = !!info?.present;

  return (
    <div className="grid grid-cols-12 gap-3 items-end py-2.5">
      <div className="col-span-4">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <div className="text-[11px] font-mono text-muted-foreground/70">{secret}</div>
        <div className="mt-1">
          {loading && !info ? (
            <Badge variant="outline" className="text-[10px]"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Checking…</Badge>
          ) : present ? (
            <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Configured {info?.preview ? `(${info.preview})` : ''}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] border-rose-500/40 text-rose-700 dark:text-rose-300">
              <AlertCircle className="h-3 w-3 mr-1" />Not set
            </Badge>
          )}
        </div>
      </div>
      <div className="col-span-6">
        <Input
          type="password"
          autoComplete="new-password"
          placeholder={present ? 'Leave blank to keep current value' : 'Paste new value…'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={busy}
        />
      </div>
      <div className="col-span-2 flex gap-1">
        <Button
          size="sm"
          className="flex-1"
          disabled={!value || busy}
          onClick={async () => {
            const ok = await save(secret, value);
            if (ok) { setValue(''); refresh(); }
          }}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : (present ? 'Rotate' : 'Save')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => refresh()} title="Re-check from backend">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
