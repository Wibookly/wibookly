import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { User, Building2, Briefcase, MessageSquare, Pencil, Save, Loader2, Info, Mail, Phone, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ProfileFields {
  full_name: string | null;
  title: string | null;
  company: string | null;
  department: string | null;
  role_description: string | null;
  responsibilities: string | null;
  communication_style: string | null;
  phone: string | null;
  mobile: string | null;
  profile_photo_url: string | null;
  email: string | null;
}

interface ProfileContextCardProps {
  /** Where this card lives — controls heading + extra-notes table */
  surface: 'ai_draft' | 'meeting_copilot';
  /** Compact mode = no gradient header (used inside another card) */
  compact?: boolean;
  className?: string;
}

const EMPTY: ProfileFields = {
  full_name: null, title: null, company: null, department: null,
  role_description: null, responsibilities: null, communication_style: null,
  phone: null, mobile: null, profile_photo_url: null, email: null,
};

/**
 * Centralized "who you are" panel. Pulls identity + about-me fields from
 * `user_profiles` (the single source of truth, edited in Settings) and shows
 * them as a read-only card so the user sees exactly what the AI knows about
 * them on this page.
 *
 * On top of that, the user can add an optional extra-context note that is
 * scoped to this surface (AI Draft vs. Meeting Copilot) without re-typing
 * the profile basics.
 */
export function ProfileContextCard({ surface, compact, className }: ProfileContextCardProps) {
  const { user } = useAuth();
  const [profile, setProfile] = useState<ProfileFields>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [extra, setExtra] = useState('');
  const [extraDraft, setExtraDraft] = useState('');
  const [editingExtra, setEditingExtra] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Load identity + per-surface extra context
  const loadProfile = async (cancelledRef?: { cancelled: boolean }) => {
    if (!user) return;
    setLoading(true);
    const [profResp, extraRow] = await Promise.all([
      supabase.rpc('get_my_profile'),
      surface === 'meeting_copilot'
        ? supabase.from('user_ai_profiles').select('custom_context').eq('user_id', user.id).maybeSingle()
        : Promise.resolve({ data: null } as { data: { custom_context?: string | null } | null }),
    ]);
    if (cancelledRef?.cancelled) return;
    const rows = (profResp.data as Partial<ProfileFields>[] | null) || [];
    const p = rows[0] || null;
    setProfile({
      full_name: p?.full_name ?? null,
      title: p?.title ?? null,
      company: p?.company ?? null,
      department: p?.department ?? null,
      role_description: p?.role_description ?? null,
      responsibilities: p?.responsibilities ?? null,
      communication_style: p?.communication_style ?? null,
      phone: p?.phone ?? null,
      mobile: p?.mobile ?? null,
      profile_photo_url: p?.profile_photo_url ?? null,
      email: p?.email ?? user.email ?? null,
    });
    const ex = (extraRow?.data?.custom_context as string | undefined) || '';
    setExtra(ex);
    setExtraDraft(ex);
    setLoading(false);
  };

  useEffect(() => {
    const ref = { cancelled: false };
    loadProfile(ref);
    return () => { ref.cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, surface]);

  const handleSyncFromMicrosoft = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('sync-microsoft-profile', { body: {} });
      if (error || (data as { error?: string })?.error) {
        toast.error((data as { error?: string })?.error || error?.message || 'Sync failed — reconnect Microsoft 365 in Integrations.');
      } else {
        toast.success('Profile synced from Microsoft 365');
        await loadProfile();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const saveExtra = async () => {
    if (!user) return;
    setSaving(true);
    if (surface === 'meeting_copilot') {
      const { error } = await supabase
        .from('user_ai_profiles')
        .upsert({ user_id: user.id, custom_context: extraDraft || null }, { onConflict: 'user_id' });
      if (error) {
        toast.error('Could not save extra context');
      } else {
        setExtra(extraDraft);
        setEditingExtra(false);
        toast.success('Extra context saved');
      }
    }
    setSaving(false);
  };

  const hasAnyAbout =
    !!(profile.responsibilities || profile.communication_style || profile.role_description);
  const headingTitle =
    surface === 'ai_draft' ? 'Your profile feeds every AI draft' : 'What Meeting Copilot knows about you';
  const headingDesc =
    surface === 'ai_draft'
      ? 'Identity, role and communication style are pulled from your profile so every reply sounds like you. Edit them in Settings — they apply everywhere.'
      : 'Your role and style come straight from your profile so every meeting suggestion stays on-brand. Edit once, apply everywhere.';

  return (
    <section
      className={cn(
        'rounded-2xl border bg-card',
        !compact && 'shadow-sm',
        className,
      )}
      style={{ borderColor: 'var(--border)' }}
    >
      <header className="flex items-start gap-3 p-5 border-b" style={{ borderColor: 'var(--border)' }}>
        {profile.profile_photo_url ? (
          <img
            src={profile.profile_photo_url}
            alt={profile.full_name || 'Profile'}
            className="w-10 h-10 shrink-0 rounded-xl object-cover ring-1 ring-border"
          />
        ) : (
          <div className="w-10 h-10 shrink-0 rounded-xl grid place-items-center bg-gradient-to-br from-primary/15 to-accent/15 ring-1 ring-border">
            <User className="w-5 h-5 text-primary" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{headingTitle}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{headingDesc}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={handleSyncFromMicrosoft} disabled={syncing}>
            {syncing
              ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
            Sync from Microsoft 365
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/settings?tab=profile">
              <Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit
            </Link>
          </Button>
        </div>
      </header>

      {loading ? (
        <div className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading your profile…
        </div>
      ) : (
        <div className="p-5 space-y-4">
          {/* Identity grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <IdentityRow icon={<User className="w-3.5 h-3.5" />} label="Name" value={profile.full_name} />
            <IdentityRow icon={<Briefcase className="w-3.5 h-3.5" />} label="Title" value={profile.title} />
            <IdentityRow icon={<Building2 className="w-3.5 h-3.5" />} label="Company" value={profile.company} />
            <IdentityRow icon={<Building2 className="w-3.5 h-3.5" />} label="Department" value={profile.department} />
            <IdentityRow icon={<Mail className="w-3.5 h-3.5" />} label="Email" value={profile.email} />
            <IdentityRow icon={<Phone className="w-3.5 h-3.5" />} label="Phone" value={profile.mobile || profile.phone} />
          </div>

          {/* About-me long form */}
          {hasAnyAbout ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <AboutBlock label="Role" value={profile.role_description} />
              <AboutBlock label="Responsibilities" value={profile.responsibilities} />
              <AboutBlock label="Communication style" value={profile.communication_style} />
            </div>
          ) : (
            <div
              className="flex items-start gap-2 rounded-xl p-3 text-xs"
              style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
            >
              <Info className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                Add your responsibilities and communication style in{' '}
                <Link to="/settings?tab=profile" className="underline font-medium">Settings → Profile</Link>{' '}
                so the AI can match your voice on every page.
              </span>
            </div>
          )}

          {/* Per-surface extra notes (Meeting Copilot only for now) */}
          {surface === 'meeting_copilot' && (
            <div className="pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <div className="text-sm font-semibold text-foreground">
                      Extra context for Meeting Copilot
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Optional. Layered on top of your profile only for meeting suggestions.
                    </div>
                  </div>
                </div>
                {!editingExtra ? (
                  <Button variant="ghost" size="sm" onClick={() => { setExtraDraft(extra); setEditingExtra(true); }}>
                    <Pencil className="w-3.5 h-3.5 mr-1.5" /> {extra ? 'Edit' : 'Add'}
                  </Button>
                ) : (
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => { setExtraDraft(extra); setEditingExtra(false); }}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={saveExtra} disabled={saving}>
                      {saving ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1.5" />}
                      Save
                    </Button>
                  </div>
                )}
              </div>
              {editingExtra ? (
                <Textarea
                  rows={3}
                  value={extraDraft}
                  onChange={(e) => setExtraDraft(e.target.value)}
                  placeholder="e.g. Currently leading the Acme migration. Avoid committing to dates before checking with Dustin."
                />
              ) : extra ? (
                <p className="text-sm text-foreground whitespace-pre-wrap rounded-xl p-3" style={{ background: 'var(--surface-2)' }}>
                  {extra}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  No extra notes yet. Add anything that helps the Copilot in live meetings.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function IdentityRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | null }) {
  return (
    <div className="rounded-xl p-3" style={{ background: 'var(--surface-2)' }}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
        {icon} {label}
      </div>
      <div className="text-sm font-medium text-foreground truncate">
        {value || <span className="text-muted-foreground italic">Not set</span>}
      </div>
    </div>
  );
}

function AboutBlock({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-xl p-3" style={{ background: 'var(--surface-2)' }}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
        {value || <span className="text-muted-foreground italic">Not set</span>}
      </div>
    </div>
  );
}
