import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Mail, Loader2, X, Send, Sparkles, Pencil } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// Matches "send/compose/write/draft/reply (a|an|the|my|some|this|that)? email(s)/mail/message(s)"
// plus natural-voice variants like "shoot an email" or "email Ali about ...".
const COMPOSE_TRIGGERS =
  /\b(send|compose|write|draft|reply|shoot|fire\s+off)\s+(?:(?:an?|the|my|some|this|that|a\s+quick|a\s+new)\s+)?(?:e?-?mails?|messages?)\b/i;
const EMAIL_VERB_TRIGGER = /\bemail\s+\S+/i; // "email Ali ...", "email john@..."
export function isComposeEmailTrigger(text: string): boolean {
  const t = text || '';
  return COMPOSE_TRIGGERS.test(t) || EMAIL_VERB_TRIGGER.test(t);
}

interface Contact { name: string; email: string; relevance?: number | null }

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string | null;
  connectionEmail: string | null;
  initialPrompt?: string;
  initialTo?: string[];
  initialSubject?: string;
  initialBody?: string;
  onSent?: () => void;
}


function isValidEmail(e: string) { return /\S+@\S+\.\S+/.test(e); }

function RecipientField({ label, values, setValues, connectionId, autoFocus }: {
  label: string; values: string[]; setValues: (v: string[]) => void; connectionId: string | null; autoFocus?: boolean;
}) {
  const [input, setInput] = useState('');
  const [suggestions, setSuggestions] = useState<Contact[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const reqRef = useRef(0);

  useEffect(() => {
    if (!connectionId || input.trim().length < 2) { setSuggestions([]); return; }
    const id = ++reqRef.current;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const { data } = await supabase.functions.invoke('email-compose', {
          body: { action: 'contacts', connection_id: connectionId, query: input.trim() },
        });
        if (id !== reqRef.current) return;
        setSuggestions(((data as any)?.results || []) as Contact[]);
        setOpen(true);
      } finally { if (id === reqRef.current) setLoading(false); }
    }, 220);
    return () => clearTimeout(t);
  }, [input, connectionId]);

  const commit = (email: string) => {
    const v = email.trim().replace(/[,;]+$/, '');
    if (!v) return;
    if (!isValidEmail(v)) { toast.error(`"${v}" is not a valid email`); return; }
    if (!values.includes(v)) setValues([...values, v]);
    setInput(''); setSuggestions([]); setOpen(false);
  };

  const remove = (email: string) => setValues(values.filter((v) => v !== email));

  return (
    <div className="space-y-1.5 relative">
      <Label className="text-[11px] font-semibold uppercase tracking-wider text-foreground/70">{label}</Label>
      <div className="flex flex-wrap gap-1.5 items-center min-h-[38px] rounded-md border border-input bg-background px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring">
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 text-sky-700 dark:text-sky-300 px-2 py-0.5 text-xs">
            {v}
            <button type="button" onClick={() => remove(v)} className="hover:text-red-500"><X className="w-3 h-3" /></button>
          </span>
        ))}
        <input
          autoFocus={autoFocus}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',' || e.key === ';' || e.key === 'Tab') {
              if (input.trim()) { e.preventDefault(); commit(input); }
            } else if (e.key === 'Backspace' && !input && values.length) {
              remove(values[values.length - 1]);
            }
          }}
          onBlur={() => { if (input.trim()) commit(input); setTimeout(() => setOpen(false), 150); }}
          onFocus={() => suggestions.length && setOpen(true)}
          placeholder={values.length ? '' : 'name or email…'}
          className="flex-1 min-w-[160px] bg-transparent text-sm outline-none"
        />
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
      </div>
      {open && suggestions.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 max-h-56 overflow-auto rounded-md border bg-popover shadow-lg">
          {suggestions.map((c) => (
            <button
              key={c.email}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); commit(c.email); }}
              className="w-full text-left px-3 py-2 hover:bg-accent text-sm flex flex-col"
            >
              <span className="font-medium">{c.name}</span>
              <span className="text-xs text-muted-foreground">{c.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function EmailComposerDialog({ open, onOpenChange, connectionId, connectionEmail, initialPrompt = '', initialTo, initialSubject, initialBody, onSent }: Props) {
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [to, setTo] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [bcc, setBcc] = useState<string[]>([]);
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [signature, setSignature] = useState('');
  const [trackingAlias, setTrackingAlias] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);

  // Load signature + draft on open
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      // Signature
      if (connectionId) {
        const { data } = await supabase.functions.invoke('email-compose', {
          body: { action: 'signature', connection_id: connectionId },
        });
        if (!cancelled) setSignature(String((data as any)?.signature || ''));

        const { data: followUpSettings } = await supabase
          .from('follow_up_settings')
          .select('is_enabled,bcc_domain')
          .eq('connection_id', connectionId)
          .maybeSingle();
        if (!cancelled && followUpSettings?.is_enabled) {
          const domain = String(
            (followUpSettings as any)?.bcc_domain || connectionEmail?.split('@')[1] || '',
          ).trim().toLowerCase();
          if (domain) {
            const alias = `3@${domain}`;
            setTrackingAlias(alias);
            setBcc((prev) => prev.some((v) => v.toLowerCase() === alias) ? prev : [...prev, alias]);
            setShowBcc(true);
          }
        }
      }
      // Prefill from wizard (skip AI drafting if any prefilled field present)
      const hasPrefill = (initialTo && initialTo.length) || initialSubject || initialBody;
      if (hasPrefill) {
        if (initialTo?.length) setTo(initialTo.filter((e) => isValidEmail(e)));
        if (initialSubject) setSubject(initialSubject);
        if (initialBody) {
          const html = /<[a-z][\s\S]*>/i.test(initialBody)
            ? initialBody
            : initialBody.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br/>')}</p>`).join('');
          setBodyHtml(html);
        }
        return;
      }
      // Draft from a free-form prompt (skip if empty — empty composer)
      if (initialPrompt.trim()) {
        setDrafting(true);
        try {
          const { data } = await supabase.functions.invoke('email-compose', {
            body: { action: 'draft', prompt: initialPrompt.trim() },
          });
          if (cancelled) return;
          const d = (data as any)?.draft || {};
          setSubject(String(d.subject || ''));
          setBodyHtml(String(d.body || ''));
          // Auto-resolve recipient from the prompt
          const recEmail = String(d.recipient_email || '').trim();
          const recName = String(d.recipient_name || '').trim();
          if (recEmail && isValidEmail(recEmail)) {
            setTo([recEmail]);
          } else if (recName && connectionId) {
            try {
              const { data: c } = await supabase.functions.invoke('email-compose', {
                body: { action: 'contacts', connection_id: connectionId, query: recName, top: 5 },
              });
              if (!cancelled) {
                const first = ((c as any)?.results || []).find((r: any) => isValidEmail(r?.email));
                if (first?.email) setTo([first.email]);
              }
            } catch { /* non-fatal */ }
          }
        } catch (e) {
          toast.error('Could not draft email');
        } finally { if (!cancelled) setDrafting(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [open, initialPrompt, initialTo, initialSubject, initialBody, connectionId, connectionEmail]);


  // Reset when closing
  useEffect(() => {
    if (!open) {
      setTo([]); setCc([]); setBcc([]); setShowCc(false); setShowBcc(false);
      setSubject(''); setBodyHtml(''); setEditMode(false); setTrackingAlias('');
    }
  }, [open]);

  const handleSend = async () => {
    if (!connectionId) { toast.error('Connect Outlook first.'); return; }
    if (!to.length) { toast.error('Add at least one recipient'); return; }
    if (!subject.trim()) { toast.error('Add a subject'); return; }
    if (!bodyHtml.trim()) { toast.error('Email body is empty'); return; }
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('email-compose', {
        body: {
          action: 'send',
          connection_id: connectionId,
          to, cc, bcc,
          subject: subject.trim(),
          body: bodyHtml,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success(`Sent to ${to.join(', ')}`);
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (token) {
        supabase.functions.invoke('cron-follow-ups', {
          headers: { Authorization: `Bearer ${token}` },
          body: { mode: 'manual', connection_id: connectionId },
        }).catch(() => { /* non-blocking report sync */ });
      }
      onSent?.();
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message || 'Failed to send email');
    } finally { setSending(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-hidden flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-5 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <Mail className="w-5 h-5 text-sky-500 shrink-0" />
            Compose email
            {drafting && <span className="text-xs font-normal text-muted-foreground inline-flex items-center gap-1 ml-2"><Sparkles className="w-3 h-3" /> AI drafting…</span>}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground leading-relaxed">
            Sent through your Outlook ({connectionEmail || 'not connected'}). Recipients autocomplete from your Outlook contacts.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 overflow-y-auto px-6 py-4 flex-1">

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>From: <span className="font-medium text-foreground">{connectionEmail || '—'}</span></span>
            <div className="flex gap-2">
              {!showCc && <button type="button" onClick={() => setShowCc(true)} className="hover:underline">Add Cc</button>}
              {!showBcc && <button type="button" onClick={() => setShowBcc(true)} className="hover:underline">Add Bcc</button>}
            </div>
          </div>

          <RecipientField label="To" values={to} setValues={setTo} connectionId={connectionId} autoFocus />
          {showCc && <RecipientField label="Cc" values={cc} setValues={setCc} connectionId={connectionId} />}
          {showBcc && <RecipientField label="Bcc" values={bcc} setValues={setBcc} connectionId={connectionId} />}
          {trackingAlias && bcc.some((v) => v.toLowerCase() === trackingAlias) && (
            <div className="text-xs text-emerald-700 dark:text-emerald-300 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
              No-reply tracking is attached to this email.
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="comp-subj" className="text-[11px] font-semibold uppercase tracking-wider text-foreground/70">Subject</Label>
            <Input id="comp-subj" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-[11px] font-semibold uppercase tracking-wider text-foreground/70">Message</Label>
              <button
                type="button"
                onClick={() => setEditMode((v) => !v)}
                className="text-xs inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
              >
                <Pencil className="w-3 h-3" /> {editMode ? 'Done editing' : 'Edit body'}
              </button>
            </div>
            {editMode ? (
              <textarea
                value={bodyHtml}
                onChange={(e) => setBodyHtml(e.target.value)}
                rows={10}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-ring"
                placeholder="<p>Hi …</p>"
              />
            ) : (
              <div
                ref={bodyRef}
                contentEditable
                suppressContentEditableWarning
                onInput={(e) => setBodyHtml((e.target as HTMLDivElement).innerHTML)}
                className={cn(
                  "min-h-[160px] rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring prose prose-sm dark:prose-invert max-w-none",
                  drafting && "opacity-60",
                )}
                dangerouslySetInnerHTML={{ __html: bodyHtml }}
              />
            )}
            {signature && (
              <div className="rounded-md border border-dashed bg-muted/30 p-2 text-xs text-muted-foreground">
                <div className="mb-1 font-medium">Signature (auto-appended)</div>
                <div className="text-foreground/80 [&>div]:!font-sans" dangerouslySetInnerHTML={{ __html: signature }} />
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="px-6 py-3 border-t bg-muted/20">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={sending}>Cancel</Button>
          <Button onClick={handleSend} disabled={sending || drafting || !to.length}>
            {sending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
            {sending ? 'Sending…' : 'Send email'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
