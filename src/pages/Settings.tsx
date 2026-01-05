import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/lib/auth';
import { useActiveEmail } from '@/contexts/ActiveEmailContext';
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
import { Loader2, Save, Sparkles, Upload, X, Image as ImageIcon, Mail } from 'lucide-react';
import { organizationNameSchema, fullNameSchema, validateField } from '@/lib/validation';

interface AISettings {
  writing_style: string;
  ai_draft_label_color: string;
  ai_sent_label_color: string;
}

interface SignatureFields {
  phone: string;
  mobile: string;
  website: string;
  signatureLogoUrl: string;
  font: string;
  color: string;
}

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

export default function Settings() {
  const { organization, profile } = useAuth();
  const { activeConnection, loading: emailLoading } = useActiveEmail();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [orgName, setOrgName] = useState('');
  const [fullName, setFullName] = useState('');
  const [title, setTitle] = useState('');
  const [emailSignature, setEmailSignature] = useState('');
  const [useCustomSignature, setUseCustomSignature] = useState(false);
  const [signatureFields, setSignatureFields] = useState<SignatureFields>({
    phone: '',
    mobile: '',
    website: '',
    signatureLogoUrl: '',
    font: 'Arial, sans-serif',
    color: '#333333'
  });
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [aiSettings, setAiSettings] = useState<AISettings>({
    writing_style: 'professional',
    ai_draft_label_color: '#3B82F6',
    ai_sent_label_color: '#F97316'
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [emailProfileId, setEmailProfileId] = useState<string | null>(null);

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
  }, [organization?.id, activeConnection?.id]);

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
      setSignatureFields({
        phone: data.phone || '',
        mobile: data.mobile || '',
        website: data.website || '',
        signatureLogoUrl: data.signature_logo_url || '',
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
        signatureLogoUrl: (profileData?.signature_logo_url as string) || '',
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
        ai_sent_label_color: (data as Record<string, unknown>).ai_sent_label_color as string || '#F97316'
      });
    }
    setLoading(false);
  };

  const saveSettings = async () => {
    if (!organization?.id || !profile?.user_id || !activeConnection?.id) return;

    // Validate inputs
    const orgNameValidation = validateField(organizationNameSchema, orgName);
    if (!orgNameValidation.success) {
      toast({
        title: 'Validation Error',
        description: orgNameValidation.error,
        variant: 'destructive'
      });
      return;
    }

    const fullNameValidation = validateField(fullNameSchema, fullName);
    if (!fullNameValidation.success) {
      toast({
        title: 'Validation Error',
        description: fullNameValidation.error,
        variant: 'destructive'
      });
      return;
    }

    setSaving(true);

    try {
      // Update organization name
      await supabase
        .from('organizations')
        .update({ name: orgNameValidation.data })
        .eq('id', organization.id);

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
        signature_font: signatureFields.font || 'Arial, sans-serif',
        signature_color: signatureFields.color || '#333333'
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
            ai_sent_label_color: aiSettings.ai_sent_label_color
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

      toast({
        title: 'Settings saved',
        description: 'Your changes have been saved successfully.'
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to save settings',
        variant: 'destructive'
      });
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
    const fontFamily = fields.font || 'Arial, sans-serif';
    const textColor = fields.color || '#333333';
    
    // Build contact lines with icons
    const contactLines: string[] = [];
    if (fields.phone) {
      contactLines.push(`<tr><td style="padding: 2px 0; vertical-align: middle;"><span style="font-size: 14px;">📞</span></td><td style="padding: 2px 0 2px 8px; vertical-align: middle;">Main: ${fields.phone}</td></tr>`);
    }
    if (fields.mobile) {
      contactLines.push(`<tr><td style="padding: 2px 0; vertical-align: middle;"><span style="font-size: 14px;">📱</span></td><td style="padding: 2px 0 2px 8px; vertical-align: middle;">Mobile: ${fields.mobile}</td></tr>`);
    }
    if (fields.website) {
      const cleanUrl = fields.website.replace(/^https?:\/\//, '');
      contactLines.push(`<tr><td style="padding: 2px 0; vertical-align: middle;"><span style="font-size: 14px;">🌐</span></td><td style="padding: 2px 0 2px 8px; vertical-align: middle;"><a href="${fields.website}" style="color: ${textColor}; text-decoration: none;">${cleanUrl}</a></td></tr>`);
    }
    if (email) {
      contactLines.push(`<tr><td style="padding: 2px 0; vertical-align: middle;"><span style="font-size: 14px;">✉️</span></td><td style="padding: 2px 0 2px 8px; vertical-align: middle;"><a href="mailto:${email}" style="color: ${textColor}; text-decoration: none;">${email}</a></td></tr>`);
    }

    // Only show signature if there's at least some content
    const hasContent = name || userTitle || contactLines.length > 0 || fields.signatureLogoUrl;
    if (!hasContent) {
      return '<div style="color: #999; font-style: italic;">Add your details above to see the signature preview</div>';
    }

    return `
      <div style="font-family: ${fontFamily}; font-size: 14px; color: ${textColor};">
        <p style="margin: 0 0 12px 0;">Best regards,</p>
        <table cellpadding="0" cellspacing="0" border="0" style="font-family: ${fontFamily}; font-size: 14px; color: ${textColor};">
          <tr>
            ${fields.signatureLogoUrl ? `<td style="vertical-align: top; padding-right: 16px; border-right: 2px solid #e5e5e5;">
              <img src="${fields.signatureLogoUrl}" alt="Logo" style="max-height: 80px; max-width: 120px;" />
            </td>` : ''}
            <td style="vertical-align: top; ${fields.signatureLogoUrl ? 'padding-left: 16px;' : ''}">
              ${name ? `<div style="font-size: 16px; font-weight: bold; color: ${textColor}; margin-bottom: 2px;">${name}</div>` : ''}
              ${userTitle ? `<div style="font-size: 14px; color: #2563eb; margin-bottom: 8px;">${userTitle}</div>` : ''}
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
        <div className="max-w-2xl mb-4 flex justify-end">
          <UserAvatarDropdown />
        </div>
        <div className="max-w-2xl animate-fade-in bg-card/80 backdrop-blur-sm rounded-xl border border-border shadow-lg p-6">
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
      <div className="max-w-2xl mb-4 flex justify-end">
        <UserAvatarDropdown />
      </div>
      
      <div className="max-w-2xl animate-fade-in bg-card/80 backdrop-blur-sm rounded-xl border border-border shadow-lg p-6">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-1 text-muted-foreground">
            Manage your account and workspace preferences
          </p>
        </div>

      <div className="space-y-8">
        {/* Workspace Settings */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Workspace</h2>
          <div className="space-y-4 p-6 bg-card rounded-lg border border-border">
            <div className="space-y-2">
              <Label htmlFor="orgName">My Workspace Name</Label>
              <Input
                id="orgName"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="Enter your workspace name"
              />
            </div>
          </div>
        </section>

        {/* Profile Settings */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Profile</h2>
          <div className="space-y-4 p-6 bg-card rounded-lg border border-border">
            <div className="space-y-2">
              <Label htmlFor="fullName">Full Name</Label>
              <Input
                id="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="title">Title (Optional)</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. CEO, Sales Manager, Developer"
              />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={profile?.email || ''} disabled className="bg-muted" />
              <p className="text-xs text-muted-foreground">Email cannot be changed</p>
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Input value="Admin" disabled className="bg-muted" />
            </div>
          </div>
        </section>

        {/* Email Signature Builder */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Email Signature</h2>
          <p className="text-sm text-muted-foreground">
            Build your email signature with the fields below, or paste your own custom signature. This will be used in all AI-generated emails.
          </p>
          <div className="space-y-6 p-6 bg-card rounded-lg border border-border">
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
                
                {/* Logo Upload */}
                <div className="space-y-3 pt-4 border-t border-border">
                  <Label>Signature Logo (Optional)</Label>
                  <div className="flex items-start gap-4">
                    {signatureFields.signatureLogoUrl ? (
                      <div className="relative">
                        <img 
                          src={signatureFields.signatureLogoUrl} 
                          alt="Signature logo" 
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
                  __html: useCustomSignature && emailSignature 
                    ? emailSignature 
                    : generateSignaturePreview(fullName, title, profile?.email || '', signatureFields)
                }}
              />
            </div>
          </div>
        </section>

        {/* AI Label Settings */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-blue-500" />
            <h2 className="text-lg font-semibold">AI Email Labels</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Choose colors for AI-processed email labels. These will appear in your inbox to help you identify AI-drafted and AI-sent emails.
          </p>
          <div className="space-y-4 p-6 bg-card rounded-lg border border-border">
            <div className="flex items-center gap-4">
              <div className="flex-1 space-y-2">
                <Label htmlFor="aiDraftColor">AI Draft Label Color</Label>
                <p className="text-xs text-muted-foreground">
                  Applied to emails where AI created a draft for your review
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-lg border-2 border-border shadow-sm cursor-pointer relative overflow-hidden"
                  style={{ backgroundColor: aiSettings.ai_draft_label_color }}
                >
                  <input
                    type="color"
                    id="aiDraftColor"
                    value={aiSettings.ai_draft_label_color}
                    onChange={(e) => setAiSettings(prev => ({ ...prev, ai_draft_label_color: e.target.value }))}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                </div>
                <span className="text-sm font-mono text-muted-foreground">{aiSettings.ai_draft_label_color}</span>
              </div>
            </div>
            
            <div className="border-t border-border pt-4"></div>
            
            <div className="flex items-center gap-4">
              <div className="flex-1 space-y-2">
                <Label htmlFor="aiSentColor">AI Auto-Reply Label Color</Label>
                <p className="text-xs text-muted-foreground">
                  Applied to emails that AI automatically replied to
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-lg border-2 border-border shadow-sm cursor-pointer relative overflow-hidden"
                  style={{ backgroundColor: aiSettings.ai_sent_label_color }}
                >
                  <input
                    type="color"
                    id="aiSentColor"
                    value={aiSettings.ai_sent_label_color}
                    onChange={(e) => setAiSettings(prev => ({ ...prev, ai_sent_label_color: e.target.value }))}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                </div>
                <span className="text-sm font-mono text-muted-foreground">{aiSettings.ai_sent_label_color}</span>
              </div>
            </div>
          </div>
        </section>


        <div className="flex justify-end">
          <Button onClick={saveSettings} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            <Save className="w-4 h-4 mr-2" />
            Save Settings
          </Button>
        </div>
        </div>
      </div>
    </div>
  );
}
