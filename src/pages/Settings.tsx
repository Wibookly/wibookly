import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import DOMPurify from 'dompurify';
import { useAuth } from '@/lib/auth';
import { useActiveEmail } from '@/contexts/ActiveEmailContext';
import { useOrganizationLogo } from '@/hooks/useOrganizationLogo';
import { supabase } from '@/integrations/supabase/client';
import { UserAvatarDropdown } from '@/components/app/UserAvatarDropdown';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Save, Sparkles, Upload, X, Image as ImageIcon, Mail, Calendar, Clock, User2, Building2, Pencil, Check, Wand2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { organizationNameSchema, fullNameSchema, validateField } from '@/lib/validation';
import { HelpTip } from '@/components/help/HelpTip';
import { HelpDot } from '@/components/help/HelpDot';
import energyForwardLogo from '@/assets/energyforward-logo.png';

// Default company logo URL (absolute) used when no per-user/org logo is set.
const DEFAULT_COMPANY_LOGO_URL =
  typeof window !== 'undefined' ? `${window.location.origin}${energyForwardLogo}` : energyForwardLogo;

// Helper to escape HTML entities for safe rendering
const escapeHtml = (text: string): string => {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
};

// Helper to validate URLs (block javascript: protocol)
const sanitizeUrl = (url: string): string => {
  if (!url) return '';
  const trimmed = url.trim();
  // Block javascript: and data: protocols
  if (/^(javascript|data|vbscript):/i.test(trimmed)) {
    return '';
  }
  // Ensure http/https protocol
  if (!/^https?:\/\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
};

interface AISettings {
  writing_style: string;
  ai_draft_label_color: string;
  ai_sent_label_color: string;
  ai_calendar_event_color: string;
}

interface SignatureFields {
  phone: string;
  mobile: string;
  website: string;
  signatureLogoUrl: string;
  profilePhotoUrl: string;
  showProfilePhoto: boolean;
  showCompanyLogo: boolean;
  font: string;
  color: string;
}

interface AvailabilityDay {
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_available: boolean;
}

const DAYS_OF_WEEK = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const hour = Math.floor(i / 2);
  const minute = i % 2 === 0 ? '00' : '30';
  const time24 = `${hour.toString().padStart(2, '0')}:${minute}`;
  const period = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  const label = `${hour12}:${minute} ${period}`;
  return { value: time24, label };
});

const DEFAULT_AVAILABILITY: AvailabilityDay[] = DAYS_OF_WEEK.map(day => ({
  day_of_week: day.value,
  start_time: '09:00',
  end_time: '17:00',
  is_available: day.value >= 1 && day.value <= 5 // Mon-Fri available by default
}));

const FONT_OPTIONS = [
  { value: 'Arial, sans-serif', label: 'Arial' },
  { value: 'Helvetica, sans-serif', label: 'Helvetica' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: 'Times New Roman, serif', label: 'Times New Roman' },
  { value: 'Verdana, sans-serif', label: 'Verdana' },
  { value: 'Tahoma, sans-serif', label: 'Tahoma' },
  { value: 'Trebuchet MS, sans-serif', label: 'Trebuchet MS' },
  { value: 'Courier New, monospace', label: 'Courier New' },
];

// Format phone number as (XXX) XXX-XXXX
const formatPhoneNumber = (value: string): string => {
  // Remove all non-digit characters
  const digits = value.replace(/\D/g, '');
  
  // Limit to 10 digits
  const limitedDigits = digits.slice(0, 10);
  
  // Format based on length
  if (limitedDigits.length === 0) return '';
  if (limitedDigits.length <= 3) return `(${limitedDigits}`;
  if (limitedDigits.length <= 6) return `(${limitedDigits.slice(0, 3)}) ${limitedDigits.slice(3)}`;
  return `(${limitedDigits.slice(0, 3)}) ${limitedDigits.slice(3, 6)}-${limitedDigits.slice(6)}`;
};

type SettingsSection = 'profile' | 'signature';

const SETTINGS_SECTIONS = [
  { value: 'profile' as const, label: 'My Profile', icon: Mail },
  { value: 'signature' as const, label: 'Update Signature', icon: Mail },
];

export default function Settings() {
  const { organization, profile } = useAuth();
  const { activeConnection, loading: emailLoading } = useActiveEmail();
  const orgLogoUrl = useOrganizationLogo(organization?.id);
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const profilePhotoInputRef = useRef<HTMLInputElement>(null);
  // Profile + Signature are rendered together on a single Settings page.
  // The `?section=` query param is no longer used to gate visibility — both
  // sections always render. Kept here only so legacy deep links don't 404.
  useSearchParams();
  const [orgName, setOrgName] = useState('');
  const [workspaceType, setWorkspaceType] = useState<'personal' | 'business'>('personal');
  const [fullName, setFullName] = useState('');
  const [title, setTitle] = useState('');
  const [emailSignature, setEmailSignature] = useState('');
  const [useCustomSignature, setUseCustomSignature] = useState(false);
  const [signatureFields, setSignatureFields] = useState<SignatureFields>({
    phone: '',
    mobile: '',
    website: '',
    signatureLogoUrl: '',
    profilePhotoUrl: '',
    showProfilePhoto: false,
    showCompanyLogo: true,
    font: 'Arial, sans-serif',
    color: '#333333'
  });
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [aiSettings, setAiSettings] = useState<AISettings>({
    writing_style: 'professional',
    ai_draft_label_color: '#3B82F6',
    ai_sent_label_color: '#F97316',
    ai_calendar_event_color: '#9333EA'
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [emailProfileId, setEmailProfileId] = useState<string | null>(null);
  const [signatureEnabled, setSignatureEnabled] = useState(false);
  const [availability, setAvailability] = useState<AvailabilityDay[]>(DEFAULT_AVAILABILITY);
  const [aboutMe, setAboutMe] = useState({
    company: '',
    department: '',
    business_phone: '',
    mobile_phone: '',
    profile_title: '',
    responsibilities: '',
    communication_style: '',
  });
  // Edit-mode toggles for AI-generated profile blurbs (read-only by default
  // so users don't accidentally change them; click "Edit" to unlock).
  const [respEditable, setRespEditable] = useState(false);
  const [styleEditable, setStyleEditable] = useState(false);
  const [generatingDefaults, setGeneratingDefaults] = useState(false);

  // Load profile fields synced from Microsoft 365 + AI personalization
  useEffect(() => {
    if (!profile?.user_id) return;
    (async () => {
      const { data } = await supabase
        .from('user_profiles')
        .select('company, department, phone, mobile, title, responsibilities, communication_style')
        .eq('user_id', profile.user_id)
        .maybeSingle() as { data: Record<string, string | null> | null };
      if (data) {
        setAboutMe({
          company: data.company || '',
          department: data.department || '',
          business_phone: data.phone || '',
          mobile_phone: data.mobile || '',
          profile_title: data.title || '',
          responsibilities: data.responsibilities || '',
          communication_style: data.communication_style || '',
        });
      }
    })();
  }, [profile?.user_id]);

  // Fetch email profile for active connection
  useEffect(() => {
    if (!organization?.id || !activeConnection?.id) {
      if (!emailLoading) setLoading(false);
      return;
    }
    
    // Set org name from organization
    setOrgName(prev => prev || organization.name);
    
    fetchEmailProfile();
    fetchAISettings();
    fetchAvailability();
  }, [organization?.id, activeConnection?.id]);

  // Auto-sync from Microsoft 365 in the background on mount so directory
  // fields stay fresh without requiring a manual Sync button.
  useEffect(() => {
    if (!organization?.id || !activeConnection?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('sync-microsoft-profile');
        if (cancelled || error) return;
        const p = (data as { profile?: Record<string, string | null> } | null)?.profile || {};
        if (p.full_name) setFullName(prev => prev || p.full_name || '');
        setAboutMe(prev => ({
          ...prev,
          company: p.company || prev.company,
          department: p.department || prev.department,
          business_phone: p.phone || prev.business_phone,
          mobile_phone: p.mobile || prev.mobile_phone,
          profile_title: p.title || prev.profile_title,
        }));
        setSignatureFields(prev => ({
          ...prev,
          phone: p.phone || prev.phone,
          mobile: p.mobile || prev.mobile,
        }));
      } catch {
        // silent
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization?.id, activeConnection?.id]);

  // Auto-generate Responsibilities + Communication style the first time we
  // have enough context (company OR title) and both fields are empty. This
  // gives every new user pre-filled defaults they can immediately edit.
  const autoGenAttemptedRef = useRef(false);
  useEffect(() => {
    if (autoGenAttemptedRef.current) return;
    if (!profile?.user_id) return;
    const hasContext = !!(aboutMe.company || organization?.name || title);
    const isEmpty = !aboutMe.responsibilities && !aboutMe.communication_style;
    if (!hasContext || !isEmpty) return;
    autoGenAttemptedRef.current = true;
    generateProfileDefaults('both');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.user_id, aboutMe.company, aboutMe.responsibilities, aboutMe.communication_style, organization?.name, title]);

  const fetchAvailability = async () => {
    if (!activeConnection?.id || !profile?.user_id) return;
    
    const { data } = await supabase
      .from('availability_hours')
      .select('*')
      .eq('connection_id', activeConnection.id) as { data: { day_of_week: number; start_time: string; end_time: string; is_available: boolean }[] | null };
    
    if (data && data.length > 0) {
      // Merge with defaults to ensure all days are present
      const merged = DEFAULT_AVAILABILITY.map(defaultDay => {
        const existing = data.find(d => d.day_of_week === defaultDay.day_of_week);
        if (existing) {
          return {
            day_of_week: existing.day_of_week,
            start_time: existing.start_time.slice(0, 5), // Remove seconds
            end_time: existing.end_time.slice(0, 5),
            is_available: existing.is_available
          };
        }
        return defaultDay;
      });
      setAvailability(merged);
    }
  };

  // Generate Responsibilities + Communication style via Lovable AI based on
  // company + title + department. Persists immediately so the user sees the
  // "auto-saved" behavior described in the request. `which` lets the caller
  // regenerate just one field at a time without overwriting the other.
  const generateProfileDefaults = async (
    which: 'both' | 'responsibilities' | 'communication_style' = 'both'
  ) => {
    if (!profile?.user_id) return;
    setGeneratingDefaults(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        'generate-profile-defaults',
        {
          body: {
            company: aboutMe.company || organization?.name || '',
            title: title || aboutMe.profile_title || '',
            department: aboutMe.department || '',
            fullName: fullName || '',
          },
        }
      );
      if (error) throw error;
      const result = (data as { result?: { responsibilities?: string; communication_style?: string } } | null)?.result;
      if (!result) throw new Error('No content returned');

      const next = { ...aboutMe };
      if (which === 'both' || which === 'responsibilities') {
        if (result.responsibilities) next.responsibilities = result.responsibilities;
      }
      if (which === 'both' || which === 'communication_style') {
        if (result.communication_style) next.communication_style = result.communication_style;
      }
      setAboutMe(next);

      // Persist immediately so it sticks even if the user navigates away.
      await supabase
        .from('user_profiles')
        .update({
          responsibilities: next.responsibilities || null,
          communication_style: next.communication_style || null,
        } as Record<string, unknown>)
        .eq('user_id', profile.user_id);

      toast({
        title: 'Profile updated',
        description: 'AI-generated profile saved automatically. You can edit it any time.',
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to generate';
      toast({ title: 'Generation failed', description: msg, variant: 'destructive' });
    } finally {
      setGeneratingDefaults(false);
    }
  };

  const fetchEmailProfile = async () => {
    if (!activeConnection?.id) return;
    
    const { data } = await supabase
      .from('email_profiles')
      .select('*')
      .eq('connection_id', activeConnection.id)
      .maybeSingle();
    
    if (data) {
      setEmailProfileId(data.id);
      setFullName(data.full_name || '');
      setTitle(data.title || '');
      setEmailSignature(data.email_signature || '');
      setUseCustomSignature(!!data.email_signature);
      setSignatureEnabled((data as Record<string, unknown>).signature_enabled as boolean || false);
      setSignatureFields({
        phone: data.phone || '',
        mobile: data.mobile || '',
        website: data.website || '',
        signatureLogoUrl: data.signature_logo_url || orgLogoUrl || DEFAULT_COMPANY_LOGO_URL,
        // Prefer the per-account override; fall back to the M365 photo we
        // pulled into the user profile so signatures default to the same
        // image the rest of the app shows.
        profilePhotoUrl:
          ((data as Record<string, unknown>).profile_photo_url as string) ||
          ((profile as unknown as { profile_photo_url?: string | null })?.profile_photo_url ?? '') ||
          '',
        showProfilePhoto: (data as Record<string, unknown>).show_profile_photo as boolean || false,
        showCompanyLogo: (data as Record<string, unknown>).show_company_logo !== false,
        font: data.signature_font || 'Arial, sans-serif',
        color: data.signature_color || '#333333'
      });
    } else {
      // Fallback to user profile data for new email profiles
      const profileData = profile as unknown as Record<string, unknown>;
      setFullName(profile?.full_name || '');
      setTitle(profile?.title || '');
      setEmailSignature('');
      setSignatureFields({
        phone: (profileData?.phone as string) || '',
        mobile: (profileData?.mobile as string) || '',
        website: (profileData?.website as string) || '',
        signatureLogoUrl: (profileData?.signature_logo_url as string) || orgLogoUrl || DEFAULT_COMPANY_LOGO_URL,
        profilePhotoUrl: ((profile as unknown as { profile_photo_url?: string | null })?.profile_photo_url ?? '') || '',
        showProfilePhoto: false,
        showCompanyLogo: true,
        font: (profileData?.signature_font as string) || 'Arial, sans-serif',
        color: (profileData?.signature_color as string) || '#333333'
      });
    }
  };

  const fetchAISettings = async () => {
    if (!organization?.id || !activeConnection?.id) return;

    const { data } = await supabase
      .from('ai_settings')
      .select('*')
      .eq('organization_id', organization.id)
      .eq('connection_id', activeConnection.id)
      .maybeSingle();

    if (data) {
      setAiSettings({
        writing_style: data.writing_style,
        ai_draft_label_color: (data as Record<string, unknown>).ai_draft_label_color as string || '#3B82F6',
        ai_sent_label_color: (data as Record<string, unknown>).ai_sent_label_color as string || '#F97316',
        ai_calendar_event_color: (data as Record<string, unknown>).ai_calendar_event_color as string || '#9333EA'
      });
    }
    setLoading(false);
  };

  // Debounced auto-save: persists profile/signature/AI/availability changes
  // automatically whenever the user edits any field. No manual Save button.
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (loading) return;
    if (!organization?.id || !profile?.user_id || !activeConnection?.id) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      saveSettings(true);
    }, 800);
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    orgName, fullName, title, emailSignature, useCustomSignature,
    signatureFields, signatureEnabled, aboutMe, aiSettings, availability,
  ]);

  const saveSettings = async (silent = false) => {
    if (!organization?.id || !profile?.user_id || !activeConnection?.id) return;

    // Validate inputs
    const orgNameValidation = validateField(organizationNameSchema, orgName);
    if (!orgNameValidation.success) {
      if (!silent) {
        toast({
          title: 'Validation Error',
          description: orgNameValidation.error,
          variant: 'destructive'
        });
      }
      return;
    }

    const fullNameValidation = validateField(fullNameSchema, fullName);
    if (!fullNameValidation.success) {
      if (!silent) {
        toast({
          title: 'Validation Error',
          description: fullNameValidation.error,
          variant: 'destructive'
        });
      }
      return;
    }

    setSaving(true);

    try {
      // Update organization name
      await supabase
        .from('organizations')
        .update({ name: orgNameValidation.data })
        .eq('id', organization.id);

      // Update About Me on user_profiles
      await supabase
        .from('user_profiles')
        .update({
          responsibilities: aboutMe.responsibilities || null,
          communication_style: aboutMe.communication_style || null,
        } as Record<string, unknown>)
        .eq('user_id', profile.user_id);
      // Update or create email profile for this connection
      const emailProfileData = {
        connection_id: activeConnection.id,
        user_id: profile.user_id,
        organization_id: organization.id,
        full_name: fullNameValidation.data || null,
        title: title || null,
        email_signature: emailSignature || null,
        phone: signatureFields.phone || null,
        mobile: signatureFields.mobile || null,
        website: signatureFields.website || null,
        signature_logo_url: signatureFields.signatureLogoUrl || null,
        profile_photo_url: signatureFields.profilePhotoUrl || null,
        show_profile_photo: signatureFields.showProfilePhoto,
        show_company_logo: signatureFields.showCompanyLogo,
        signature_font: signatureFields.font || 'Arial, sans-serif',
        signature_color: signatureFields.color || '#333333',
        signature_enabled: signatureEnabled
      };

      if (emailProfileId) {
        await supabase
          .from('email_profiles')
          .update(emailProfileData)
          .eq('id', emailProfileId);
      } else {
        const { data: newProfile } = await supabase
          .from('email_profiles')
          .insert(emailProfileData)
          .select()
          .single();
        if (newProfile) {
          setEmailProfileId(newProfile.id);
        }
      }

      // Update AI settings for this connection
      const { data: existingAI } = await supabase
        .from('ai_settings')
        .select('id')
        .eq('organization_id', organization.id)
        .eq('connection_id', activeConnection.id)
        .maybeSingle();

      if (existingAI) {
        await supabase
          .from('ai_settings')
          .update({
            writing_style: aiSettings.writing_style,
            ai_draft_label_color: aiSettings.ai_draft_label_color,
            ai_sent_label_color: aiSettings.ai_sent_label_color,
            ai_calendar_event_color: aiSettings.ai_calendar_event_color
          } as Record<string, unknown>)
          .eq('id', existingAI.id);
      } else {
        await supabase
          .from('ai_settings')
          .insert({
            organization_id: organization.id,
            connection_id: activeConnection.id,
            writing_style: aiSettings.writing_style
          });
      }

      // Save availability hours
      for (const day of availability) {
        // Check if exists
        const { data: existing } = await supabase
          .from('availability_hours')
          .select('id')
          .eq('connection_id', activeConnection.id)
          .eq('day_of_week', day.day_of_week)
          .maybeSingle();
        
        if (existing) {
          await supabase
            .from('availability_hours')
            .update({
              start_time: day.start_time + ':00',
              end_time: day.end_time + ':00',
              is_available: day.is_available
            })
            .eq('id', existing.id);
        } else {
          // Direct insert with type coercion for new table
          const insertData = {
            connection_id: activeConnection.id,
            user_id: profile.user_id,
            organization_id: organization.id,
            day_of_week: day.day_of_week,
            start_time: day.start_time + ':00',
            end_time: day.end_time + ':00',
            is_available: day.is_available
          };
          // @ts-ignore - availability_hours table is new and not yet in types
          await supabase.from('availability_hours').insert(insertData);
        }
      }

      if (!silent) {
        toast({
          title: 'Settings saved',
          description: 'Your changes have been saved successfully.'
        });
      }
    } catch (error) {
      if (!silent) {
        toast({
          title: 'Error',
          description: 'Failed to save settings',
          variant: 'destructive'
        });
      }

    } finally {
      setSaving(false);
    }
  };

  const generateSignaturePreview = (
    name: string, 
    userTitle: string, 
    email: string,
    fields: SignatureFields
  ): string => {
    const fontFamily = escapeHtml(fields.font || 'Arial, sans-serif');
    const textColor = escapeHtml(fields.color || '#333333');
    
    // Escape all user-provided text fields
    const safeName = escapeHtml(name || '');
    const safeTitle = escapeHtml(userTitle || '');
    const safeEmail = escapeHtml(email || '');
    const safePhone = escapeHtml(fields.phone || '');
    const safeMobile = escapeHtml(fields.mobile || '');
    
    // Sanitize URLs to prevent javascript: protocol
    const safeWebsite = sanitizeUrl(fields.website || '');
    const safeProfilePhotoUrl = sanitizeUrl(fields.profilePhotoUrl || '');
    const safeLogoUrl = sanitizeUrl(fields.signatureLogoUrl || '');
    
    // Build contact lines with icons
    const contactLines: string[] = [];
    if (safePhone) {
      contactLines.push(`<tr><td style="padding: 2px 0; vertical-align: middle;"><span style="font-size: 14px;">📞</span></td><td style="padding: 2px 0 2px 8px; vertical-align: middle;">Main: ${safePhone}</td></tr>`);
    }
    if (safeMobile) {
      contactLines.push(`<tr><td style="padding: 2px 0; vertical-align: middle;"><span style="font-size: 14px;">📱</span></td><td style="padding: 2px 0 2px 8px; vertical-align: middle;">Mobile: ${safeMobile}</td></tr>`);
    }
    if (safeWebsite) {
      const cleanUrl = escapeHtml(safeWebsite.replace(/^https?:\/\//, ''));
      contactLines.push(`<tr><td style="padding: 2px 0; vertical-align: middle;"><span style="font-size: 14px;">🌐</span></td><td style="padding: 2px 0 2px 8px; vertical-align: middle;"><a href="${safeWebsite}" style="color: ${textColor}; text-decoration: none;">${cleanUrl}</a></td></tr>`);
    }
    if (safeEmail) {
      contactLines.push(`<tr><td style="padding: 2px 0; vertical-align: middle;"><span style="font-size: 14px;">✉️</span></td><td style="padding: 2px 0 2px 8px; vertical-align: middle;"><a href="mailto:${safeEmail}" style="color: ${textColor}; text-decoration: none;">${safeEmail}</a></td></tr>`);
    }

    // Check what images to show based on toggles (only if URLs are valid)
    const showPhoto = fields.showProfilePhoto && safeProfilePhotoUrl;
    const showLogo = fields.showCompanyLogo && safeLogoUrl;

    // Only show signature if there's at least some content
    const hasContent = safeName || safeTitle || contactLines.length > 0 || showPhoto || showLogo;
    if (!hasContent) {
      return '<div style="color: #999; font-style: italic;">Add your details above to see the signature preview</div>';
    }

    // Build images section (profile photo on top, logo below)
    let imagesHtml = '';
    if (showPhoto || showLogo) {
      imagesHtml = `<td style="vertical-align: top; padding-right: 16px; border-right: 2px solid #e5e5e5;">
        <div style="display: flex; flex-direction: column; align-items: center; gap: 8px;">
          ${showPhoto ? `<img src="${safeProfilePhotoUrl}" alt="Profile Photo" style="width: 70px; height: 70px; border-radius: 50%; object-fit: cover;" />` : ''}
          ${showLogo ? `<img src="${safeLogoUrl}" alt="Company Logo" style="max-height: 50px; max-width: 100px;" />` : ''}
        </div>
      </td>`;
    }

    return `
      <div style="font-family: ${fontFamily}; font-size: 14px; color: ${textColor};">
        <p style="margin: 0 0 12px 0;">Best regards,</p>
        <table cellpadding="0" cellspacing="0" border="0" style="font-family: ${fontFamily}; font-size: 14px; color: ${textColor};">
          <tr>
            ${imagesHtml}
            <td style="vertical-align: top; ${(showPhoto || showLogo) ? 'padding-left: 16px;' : ''}">
              ${safeName ? `<div style="font-size: 16px; font-weight: bold; color: ${textColor}; margin-bottom: 2px;">${safeName}</div>` : ''}
              ${safeTitle ? `<div style="font-size: 14px; color: #2563eb; margin-bottom: 8px;">${safeTitle}</div>` : ''}
              ${contactLines.length > 0 ? `<table cellpadding="0" cellspacing="0" border="0" style="font-size: 13px; color: ${textColor};">
                ${contactLines.join('')}
              </table>` : ''}
            </td>
          </tr>
        </table>
      </div>
    `;
  };

  if (loading || emailLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!activeConnection) {
    return (
      <div className="min-h-full p-4 lg:p-6">
        <div className="mb-4 flex justify-end">
          <UserAvatarDropdown />
        </div>
        <div className="w-full animate-fade-in bg-card/80 backdrop-blur-sm rounded-xl border border-border shadow-lg p-6">
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Mail className="w-12 h-12 text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold mb-2">No Email Connected</h2>
            <p className="text-muted-foreground mb-6">
              Connect a Gmail or Outlook account to configure your email settings and signature
            </p>
            <Button onClick={() => window.location.href = '/integrations'}>
              Connect Email Account
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full p-4 lg:p-6">
      {/* User Avatar Row */}
      <div className="mb-4 flex justify-end">
        <UserAvatarDropdown />
      </div>
      
      <div className="w-full animate-fade-in bg-card/80 backdrop-blur-sm rounded-xl border border-border shadow-lg p-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">My Profile <HelpDot articleId="profile-signature" label="How profile and signature work — open the guide." /></h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage my profile / signature
          </p>
        </div>


      <div className="space-y-6">

        {/* Help & Onboarding quick actions */}
        <section className="rounded-lg border border-border bg-background/60 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Help & Onboarding</h2>
            <p className="text-xs text-muted-foreground">
              Re-run the guided setup wizard at any time, or toggle the in-app help icons.
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.dispatchEvent(new CustomEvent('inboxiq:restart-setup-wizard'))}
            >
              Restart Setup Wizard
            </Button>
            {profile?.email?.toLowerCase() === 'arahimi@energyforward.com' && (
              <Button
                variant="default"
                size="sm"
                onClick={() => window.location.assign('/settings/help')}
              >
                <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                Edit Help & Support (AI)
              </Button>
            )}
          </div>
        </section>

        {/* Unified Profile + Signature card */}
        <section className="space-y-3">
          {/* Legend explaining the two field types */}
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <div className="flex items-center gap-2">
              <span className="inline-block w-3 h-3 rounded-sm bg-muted border border-border" />
              <span className="text-muted-foreground">
                Synced automatically from Microsoft 365 — read-only
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-3 h-3 rounded-sm bg-primary/10 border border-primary/40" />
              <span className="text-muted-foreground">
                Editable — used to personalize your signature & AI replies
              </span>
            </div>
          </div>

          {/* SYNCED FROM M365 — read-only block */}
          <div className="space-y-3 p-4 bg-muted/40 rounded-lg border border-border">
            <div className="flex items-center gap-2 mb-1">
              <Building2 className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Directory Information</h3>
              <span className="text-[11px] text-muted-foreground">
                Auto-synced from Microsoft 365
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="fullName" className="text-xs inline-flex items-center gap-1">Full Name <HelpTip id="profile.fullName" /></Label>
                <Input id="fullName" value={fullName} disabled className="bg-background/60 h-9" placeholder="—" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Email</Label>
                <Input value={profile?.email || ''} disabled className="bg-background/60 h-9" />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="aboutCompany" className="text-xs">Company</Label>
                <Input id="aboutCompany" value={aboutMe.company} disabled className="bg-background/60 h-9" placeholder="—" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="aboutDept" className="text-xs">Department</Label>
                <Input id="aboutDept" value={aboutMe.department} disabled className="bg-background/60 h-9" placeholder="—" />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Business Phone</Label>
                <Input value={aboutMe.business_phone || signatureFields.phone || ''} disabled className="bg-background/60 h-9" placeholder="—" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Mobile Phone</Label>
                <Input value={aboutMe.mobile_phone || signatureFields.mobile || ''} disabled className="bg-background/60 h-9" placeholder="—" />
              </div>
            </div>
          </div>

          {/* EDITABLE — your inputs */}
          <div className="space-y-3 p-4 bg-primary/5 rounded-lg border border-primary/30">
            <div className="flex items-center gap-2 mb-1">
              <User2 className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold">Your Inputs</h3>
              <span className="text-[11px] text-muted-foreground">
                These feed your signature and AI personalization
              </span>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="title" className="text-xs inline-flex items-center gap-1">Title <span className="text-primary">(used in signature)</span> <HelpTip id="profile.title" /></Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="h-9"
                placeholder="e.g. Director of Operations"
              />
            </div>

            {/* AI-generated profile blurbs (Responsibilities + Communication style).
                Auto-generated once based on company + title; user can edit or
                regenerate at any time via the controls in each row. */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="aboutResp" className="text-xs inline-flex items-center gap-1.5">
                  Responsibilities
                  <span className="text-[10px] text-muted-foreground">(AI-generated, editable)</span>
                </Label>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => setRespEditable(v => !v)}
                  >
                    {respEditable ? <><Check className="w-3 h-3 mr-1" />Done</> : <><Pencil className="w-3 h-3 mr-1" />Edit</>}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    disabled={generatingDefaults}
                    onClick={() => generateProfileDefaults('responsibilities')}
                  >
                    {generatingDefaults ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Wand2 className="w-3 h-3 mr-1" />}
                    Regenerate
                  </Button>
                </div>
              </div>
              <Textarea
                id="aboutResp"
                value={aboutMe.responsibilities}
                onChange={(e) => setAboutMe(p => ({ ...p, responsibilities: e.target.value }))}
                placeholder="Approvals, follow-ups, contracts, scheduling…"
                rows={2}
                readOnly={!respEditable}
                className={!respEditable ? 'bg-background/60 cursor-default' : ''}
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="aboutStyle" className="text-xs inline-flex items-center gap-1.5">
                  Communication style
                  <span className="text-[10px] text-muted-foreground">(AI-generated, editable)</span>
                </Label>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => setStyleEditable(v => !v)}
                  >
                    {styleEditable ? <><Check className="w-3 h-3 mr-1" />Done</> : <><Pencil className="w-3 h-3 mr-1" />Edit</>}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    disabled={generatingDefaults}
                    onClick={() => generateProfileDefaults('communication_style')}
                  >
                    {generatingDefaults ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Wand2 className="w-3 h-3 mr-1" />}
                    Regenerate
                  </Button>
                </div>
              </div>
              <Textarea
                id="aboutStyle"
                value={aboutMe.communication_style}
                onChange={(e) => setAboutMe(p => ({ ...p, communication_style: e.target.value }))}
                placeholder="Tone, length, signoffs, things to avoid"
                rows={2}
                readOnly={!styleEditable}
                className={!styleEditable ? 'bg-background/60 cursor-default' : ''}
              />
            </div>
          </div>
        </section>


        {/* Email Signature Builder */}
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap pt-2 border-t border-border">
            <div>
              <h2 className="text-lg font-semibold inline-flex items-center gap-1">Email Signature <HelpTip id="profile.signaturePreview" /></h2>
              <p className="text-sm text-muted-foreground">
                Turn the signature on or off. Editable fields above + the options below build your final signature.
              </p>
            </div>
            <div className="flex items-center gap-3 px-3 py-2 rounded-md border border-border bg-card">
              <Label htmlFor="signatureEnabled" className="text-sm font-medium">
                Signature {signatureEnabled ? 'On' : 'Off'}
              </Label>
              <Switch
                id="signatureEnabled"
                checked={signatureEnabled}
                onCheckedChange={setSignatureEnabled}
              />
            </div>
          </div>
          <div className={`space-y-6 p-6 bg-card rounded-lg border border-border ${!signatureEnabled ? 'opacity-50 pointer-events-none' : ''}`}>
            {/* Signature Mode Toggle */}
            <div className="flex items-center gap-4 pb-4 border-b border-border">
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={!useCustomSignature ? "default" : "outline"}
                  size="sm"
                  onClick={() => setUseCustomSignature(false)}
                >
                  Use Signature Builder
                </Button>
                <Button
                  type="button"
                  variant={useCustomSignature ? "default" : "outline"}
                  size="sm"
                  onClick={() => setUseCustomSignature(true)}
                >
                  Paste Custom Signature
                </Button>
              </div>
            </div>

            {!useCustomSignature ? (
              <>
                {/* Font & Color Settings */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="sigFont">Font</Label>
                    <Select
                      value={signatureFields.font}
                      onValueChange={(value) => setSignatureFields(prev => ({ ...prev, font: value }))}
                    >
                      <SelectTrigger id="sigFont">
                        <SelectValue placeholder="Select font" />
                      </SelectTrigger>
                      <SelectContent>
                        {FONT_OPTIONS.map((font) => (
                          <SelectItem key={font.value} value={font.value}>
                            <span style={{ fontFamily: font.value }}>{font.label}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sigColor">Text Color</Label>
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-lg border-2 border-border shadow-sm cursor-pointer relative overflow-hidden"
                        style={{ backgroundColor: signatureFields.color }}
                      >
                        <input
                          type="color"
                          id="sigColor"
                          value={signatureFields.color}
                          onChange={(e) => setSignatureFields(prev => ({ ...prev, color: e.target.value }))}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        />
                      </div>
                      <span className="text-sm font-mono text-muted-foreground">{signatureFields.color}</span>
                    </div>
                  </div>
                </div>

                {/* Contact Fields */}
                <div className="grid gap-4 sm:grid-cols-2 pt-4 border-t border-border">
                  <div className="space-y-2">
                    <Label htmlFor="sigPhone">Phone (Optional)</Label>
                    <Input
                      id="sigPhone"
                      type="tel"
                      value={signatureFields.phone}
                      onChange={(e) => setSignatureFields(prev => ({ ...prev, phone: formatPhoneNumber(e.target.value) }))}
                      placeholder="(888) 888-8888"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sigMobile">Mobile (Optional)</Label>
                    <Input
                      id="sigMobile"
                      type="tel"
                      value={signatureFields.mobile}
                      onChange={(e) => setSignatureFields(prev => ({ ...prev, mobile: formatPhoneNumber(e.target.value) }))}
                      placeholder="(888) 888-8888"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sigWebsite">Website (Optional)</Label>
                    <Input
                      id="sigWebsite"
                      type="url"
                      value={signatureFields.website}
                      onChange={(e) => setSignatureFields(prev => ({ ...prev, website: e.target.value }))}
                      placeholder="https://yourcompany.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sigEmail">Email</Label>
                    <Input 
                      id="sigEmail"
                      value={profile?.email || ''} 
                      disabled 
                      className="bg-muted" 
                    />
                  </div>
                </div>
                
                {/* Profile Photo Upload */}
                <div className="space-y-3 pt-4 border-t border-border">
                  <div className="flex items-center justify-between">
                    <Label className="inline-flex items-center gap-1">Profile Photo (Optional) <HelpTip id="profile.photo" /></Label>
                    <div className="flex items-center gap-2">
                      <Label htmlFor="showProfilePhoto" className="text-xs font-normal text-muted-foreground">
                        Show in signature
                      </Label>
                      <Switch
                        id="showProfilePhoto"
                        checked={signatureFields.showProfilePhoto}
                        onCheckedChange={(checked) => setSignatureFields(prev => ({ ...prev, showProfilePhoto: checked }))}
                      />
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    {signatureFields.profilePhotoUrl ? (
                      <div className="relative">
                        <img 
                          src={signatureFields.profilePhotoUrl} 
                          alt="Profile photo" 
                          className="h-16 w-16 object-cover rounded-full border border-border"
                        />
                        <button
                          type="button"
                          onClick={() => setSignatureFields(prev => ({ ...prev, profilePhotoUrl: '' }))}
                          className="absolute -top-2 -right-2 p-1 rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-16 w-16 rounded-full border-2 border-dashed border-border bg-muted/50">
                        <ImageIcon className="w-6 h-6 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex flex-col gap-2">
                      <input
                        ref={profilePhotoInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file || !profile?.user_id) return;
                          
                          setUploadingPhoto(true);
                          try {
                            const fileExt = file.name.split('.').pop();
                            const fileName = `${profile.user_id}/photo-${Date.now()}.${fileExt}`;
                            
                            const { error: uploadError } = await supabase.storage
                              .from('signature-logos')
                              .upload(fileName, file, { upsert: true });
                            
                            if (uploadError) throw uploadError;
                            
                            const { data: { publicUrl } } = supabase.storage
                              .from('signature-logos')
                              .getPublicUrl(fileName);
                            
                            setSignatureFields(prev => ({ ...prev, profilePhotoUrl: publicUrl }));
                            toast({ title: 'Photo uploaded successfully' });
                          } catch (error) {
                            console.error('Upload error:', error);
                            toast({ 
                              title: 'Upload failed', 
                              description: 'Could not upload photo',
                              variant: 'destructive' 
                            });
                          } finally {
                            setUploadingPhoto(false);
                            if (profilePhotoInputRef.current) profilePhotoInputRef.current.value = '';
                          }
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => profilePhotoInputRef.current?.click()}
                        disabled={uploadingPhoto}
                      >
                        {uploadingPhoto ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <Upload className="w-4 h-4 mr-2" />
                        )}
                        Upload Photo
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        Square image recommended. Max 2MB.
                      </p>
                    </div>
                  </div>
                </div>
                
                {/* Company Logo Upload */}
                <div className="space-y-3 pt-4 border-t border-border">
                  <div className="flex items-center justify-between">
                    <Label>Company Logo (Optional)</Label>
                    <div className="flex items-center gap-2">
                      <Label htmlFor="showCompanyLogo" className="text-xs font-normal text-muted-foreground">
                        Show in signature
                      </Label>
                      <Switch
                        id="showCompanyLogo"
                        checked={signatureFields.showCompanyLogo}
                        onCheckedChange={(checked) => setSignatureFields(prev => ({ ...prev, showCompanyLogo: checked }))}
                      />
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    {signatureFields.signatureLogoUrl ? (
                      <div className="relative">
                        <img 
                          src={signatureFields.signatureLogoUrl} 
                          alt="Company logo" 
                          className="h-16 w-auto object-contain rounded border border-border bg-background p-1"
                        />
                        <button
                          type="button"
                          onClick={() => setSignatureFields(prev => ({ ...prev, signatureLogoUrl: '' }))}
                          className="absolute -top-2 -right-2 p-1 rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-16 w-24 rounded border-2 border-dashed border-border bg-muted/50">
                        <ImageIcon className="w-6 h-6 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex flex-col gap-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file || !profile?.user_id) return;
                          
                          setUploadingLogo(true);
                          try {
                            const fileExt = file.name.split('.').pop();
                            const fileName = `${profile.user_id}/logo-${Date.now()}.${fileExt}`;
                            
                            const { error: uploadError } = await supabase.storage
                              .from('signature-logos')
                              .upload(fileName, file, { upsert: true });
                            
                            if (uploadError) throw uploadError;
                            
                            const { data: { publicUrl } } = supabase.storage
                              .from('signature-logos')
                              .getPublicUrl(fileName);
                            
                            setSignatureFields(prev => ({ ...prev, signatureLogoUrl: publicUrl }));
                            toast({ title: 'Logo uploaded successfully' });
                          } catch (error) {
                            console.error('Upload error:', error);
                            toast({ 
                              title: 'Upload failed', 
                              description: 'Could not upload logo',
                              variant: 'destructive' 
                            });
                          } finally {
                            setUploadingLogo(false);
                            if (fileInputRef.current) fileInputRef.current.value = '';
                          }
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadingLogo}
                      >
                        {uploadingLogo ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <Upload className="w-4 h-4 mr-2" />
                        )}
                        Upload Logo
                      </Button>
                      {signatureFields.signatureLogoUrl !== DEFAULT_COMPANY_LOGO_URL && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setSignatureFields(prev => ({ ...prev, signatureLogoUrl: DEFAULT_COMPANY_LOGO_URL }))}
                        >
                          Use default logo
                        </Button>
                      )}
                      <p className="text-xs text-muted-foreground">
                        PNG, JPG up to 2MB. Recommended: 200x50px
                      </p>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              /* Custom Signature Input */
              <div className="space-y-3">
                <Label htmlFor="emailSignature">Custom Signature</Label>
                <p className="text-xs text-muted-foreground">
                  Paste or type your custom signature below.
                </p>
                <textarea
                  id="emailSignature"
                  value={emailSignature}
                  onChange={(e) => setEmailSignature(e.target.value)}
                  placeholder={`Best regards,

John Doe
CEO, Company Name
📞 Main: (888) 888-8888
📱 Mobile: (888) 888-8888
🌐 yourcompany.com
✉️ john@yourcompany.com`}
                  className="flex min-h-[180px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>
            )}
            
            {/* Preview */}
            <div className="space-y-3 pt-4 border-t border-border">
              <Label>Signature Preview</Label>
              <div 
                className="p-4 bg-background rounded-md border border-border min-h-[80px]"
                dangerouslySetInnerHTML={{ 
                  __html: DOMPurify.sanitize(
                    useCustomSignature && emailSignature 
                      ? emailSignature 
                      : generateSignaturePreview(fullName, title, profile?.email || '', signatureFields),
                    { ADD_ATTR: ['target'] }
                  )
                }}
              />
            </div>
          </div>
        </section>


        {saving && (
          <div className="flex justify-end text-xs text-muted-foreground">
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            Auto-saving…
          </div>
        )}

        </div>
      </div>
    </div>
  );
}
