import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Image as ImageIcon, Upload, Trash2, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

/**
 * Lets an admin upload a company logo to the public `org-logos` storage
 * bucket and stores the resulting public URL on `organizations.logo_url`.
 * The uploaded logo is then shown in the app sidebar (via useOrganizationLogo)
 * and at the top of all transactional emails.
 */
export default function CompanyLogoUploader({ organizationId }: { organizationId: string | null }) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!organizationId) return;
    (async () => {
      const { data } = await supabase
        .from('organizations')
        .select('logo_url')
        .eq('id', organizationId)
        .maybeSingle();
      setLogoUrl((data as any)?.logo_url ?? null);
    })();
  }, [organizationId]);

  async function handleFile(file: File) {
    if (!organizationId) return;
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: 'File too large', description: 'Please upload a logo under 2 MB.', variant: 'destructive' });
      return;
    }
    if (!/^image\/(png|jpeg|jpg|svg\+xml|webp)$/.test(file.type)) {
      toast({ title: 'Unsupported format', description: 'Use PNG, JPG, SVG, or WebP.', variant: 'destructive' });
      return;
    }
    setBusy(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
      const path = `${organizationId}/logo-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('org-logos')
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('org-logos').getPublicUrl(path);
      const url = pub.publicUrl;
      const { error: updErr } = await supabase
        .from('organizations')
        .update({ logo_url: url })
        .eq('id', organizationId);
      if (updErr) throw updErr;
      setLogoUrl(url);
      toast({ title: 'Logo updated', description: 'Your company logo is now live across the app and emails.' });
    } catch (e: any) {
      toast({ title: 'Upload failed', description: e?.message ?? 'Try again.', variant: 'destructive' });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function handleRemove() {
    if (!organizationId) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from('organizations')
        .update({ logo_url: null })
        .eq('id', organizationId);
      if (error) throw error;
      setLogoUrl(null);
      toast({ title: 'Logo removed' });
    } catch (e: any) {
      toast({ title: 'Could not remove', description: e?.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ImageIcon className="w-5 h-5" /> Company Logo</CardTitle>
        <CardDescription>
          Shown in the app sidebar and at the top of transactional emails (welcome, invitations, password resets).
          Recommended: square PNG/SVG, transparent background, at least 256×256.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="w-20 h-20 rounded-lg border border-border bg-muted/30 flex items-center justify-center overflow-hidden">
            {logoUrl ? (
              <img src={logoUrl} alt="Company logo" className="w-full h-full object-contain" />
            ) : (
              <ImageIcon className="w-8 h-8 text-muted-foreground" />
            )}
          </div>
          <div className="flex-1 space-y-2">
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/svg+xml,image/webp"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
            <div className="flex gap-2">
              <Button onClick={() => inputRef.current?.click()} disabled={busy || !organizationId}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Upload className="w-4 h-4 mr-2" />}
                {logoUrl ? 'Replace logo' : 'Upload logo'}
              </Button>
              {logoUrl && (
                <Button variant="ghost" onClick={handleRemove} disabled={busy} className="text-destructive hover:text-destructive">
                  <Trash2 className="w-4 h-4 mr-2" /> Remove
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">PNG, JPG, SVG, or WebP. Max 2 MB.</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
