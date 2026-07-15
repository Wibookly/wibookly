import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Loader2, ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

const SUBDOMAIN_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;

function sanitize(input: string): string {
  return input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\.egnyte\.com\/?.*$/, '').replace(/\/$/, '');
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStarted?: () => void;
  defaultSubdomain?: string;
  returnPath?: string;
}

export function EgnyteConnectDialog({ open, onOpenChange, onStarted, defaultSubdomain, returnPath }: Props) {
  const { toast } = useToast();
  const [subdomain, setSubdomain] = useState(defaultSubdomain ?? '');
  const [busy, setBusy] = useState(false);
  const clean = sanitize(subdomain);
  const valid = SUBDOMAIN_RE.test(clean);

  const start = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('egnyte-oauth-start', {
        body: { subdomain: clean, return_path: returnPath ?? '/egnyte' },
      });
      if (error || !data?.authorize_url) throw new Error(data?.error || error?.message || 'Failed to start');
      onStarted?.();
      window.location.assign(data.authorize_url);
    } catch (e) {
      toast({ title: 'Could not start Egnyte connection', description: (e as Error).message, variant: 'destructive' });
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect Egnyte</DialogTitle>
          <DialogDescription>
            You'll be sent to Egnyte to sign in. We never see or store your Egnyte password.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Label htmlFor="egnyte-subdomain">Your Egnyte domain</Label>
          <div className="flex items-stretch rounded-md border border-input bg-background overflow-hidden focus-within:ring-2 focus-within:ring-ring">
            <Input
              id="egnyte-subdomain"
              value={subdomain}
              onChange={(e) => setSubdomain(e.target.value)}
              placeholder="acme"
              autoFocus
              className="border-0 focus-visible:ring-0"
            />
            <div className="px-3 flex items-center text-sm text-muted-foreground bg-muted/50 border-l border-input">
              .egnyte.com
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Find this in your Egnyte URL — if you sign in at <code>https://acme.egnyte.com</code>, enter <code>acme</code>.
          </p>
          {subdomain && !valid && (
            <p className="text-xs text-destructive">Enter just the subdomain (lowercase letters, numbers, and hyphens).</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={start} disabled={!valid || busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ExternalLink className="h-4 w-4 mr-2" />}
            Continue to Egnyte
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
