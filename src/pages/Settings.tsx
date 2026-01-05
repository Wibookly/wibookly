import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/lib/auth';
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
import { Loader2, Save, Sparkles, Upload, X, Image as ImageIcon } from 'lucide-react';
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

export default function Settings() {
  const { organization, profile } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [orgName, setOrgName] = useState('');
  const [fullName, setFullName] = useState('');
  const [title, setTitle] = useState('');
  const [emailSignature, setEmailSignature] = useState('');
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

  // Only set initial values once when data first loads
  useEffect(() => {
    if (!organization?.id) return;
    
    const profileData = profile as unknown as Record<string, unknown>;
    
    // Only set if not already set (prevents overwriting user edits)
    setOrgName(prev => prev || organization.name);
    setFullName(prev => prev || profile?.full_name || '');
    setTitle(prev => prev || profile?.title || '');
    setEmailSignature(prev => prev || (profileData?.email_signature as string) || '');
    setSignatureFields(prev => ({
      phone: prev.phone || (profileData?.phone as string) || '',
      mobile: prev.mobile || (profileData?.mobile as string) || '',
      website: prev.website || (profileData?.website as string) || '',
      signatureLogoUrl: prev.signatureLogoUrl || (profileData?.signature_logo_url as string) || '',
      font: prev.font || (profileData?.signature_font as string) || 'Arial, sans-serif',
      color: prev.color || (profileData?.signature_color as string) || '#333333'
    }));
    
    fetchAISettings();
  }, [organization?.id]);

  const fetchAISettings = async () => {
    if (!organization?.id) return;

    const { data } = await supabase
      .from('ai_settings')
      .select('*')
      .eq('organization_id', organization.id)
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
    if (!organization?.id || !profile?.user_id) return;

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

      // Update user profile
      await supabase
        .from('user_profiles')
        .update({ 
          full_name: fullNameValidation.data || null,
          title: title || null,
          email_signature: emailSignature || null,
          phone: signatureFields.phone || null,
          mobile: signatureFields.mobile || null,
          website: signatureFields.website || null,
          signature_logo_url: signatureFields.signatureLogoUrl || null,
          signature_font: signatureFields.font || 'Arial, sans-serif',
          signature_color: signatureFields.color || '#333333'
        } as Record<string, unknown>)
        .eq('user_id', profile.user_id);

      // Update AI settings
      const { error: aiError } = await supabase.rpc('upsert_ai_settings' as never, {
        p_organization_id: organization.id,
        p_writing_style: aiSettings.writing_style,
        p_ai_draft_label_color: aiSettings.ai_draft_label_color,
        p_ai_sent_label_color: aiSettings.ai_sent_label_color
      } as never);
      
      if (aiError) {
        // Fallback to regular upsert if function doesn't exist
        await supabase
          .from('ai_settings')
          .upsert({
            organization_id: organization.id,
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

    return `
      <table cellpadding="0" cellspacing="0" border="0" style="font-family: ${fontFamily}; font-size: 14px; color: ${textColor};">
        <tr>
          ${fields.signatureLogoUrl ? `<td style="vertical-align: top; padding-right: 16px; border-right: 2px solid #e5e5e5;">
            <img src="${fields.signatureLogoUrl}" alt="Logo" style="max-height: 80px; max-width: 120px;" />
          </td>` : ''}
          <td style="vertical-align: top; ${fields.signatureLogoUrl ? 'padding-left: 16px;' : ''}">
            ${name ? `<div style="font-size: 16px; font-weight: bold; color: ${textColor}; margin-bottom: 2px;">${name}</div>` : ''}
            ${userTitle ? `<div style="font-size: 14px; color: #2563eb; margin-bottom: 8px;">${userTitle}</div>` : ''}
            <table cellpadding="0" cellspacing="0" border="0" style="font-size: 13px; color: ${textColor};">
              ${contactLines.join('')}
            </table>
          </td>
        </tr>
      </table>
    `;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
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
            Build your email signature with the fields below, or paste your own HTML signature. This will be used in all AI-generated emails.
          </p>
          <div className="space-y-6 p-6 bg-card rounded-lg border border-border">
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
                  onChange={(e) => setSignatureFields(prev => ({ ...prev, phone: e.target.value }))}
                  placeholder="+1 (555) 123-4567"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sigMobile">Mobile (Optional)</Label>
                <Input
                  id="sigMobile"
                  type="tel"
                  value={signatureFields.mobile}
                  onChange={(e) => setSignatureFields(prev => ({ ...prev, mobile: e.target.value }))}
                  placeholder="+1 (555) 987-6543"
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

            {/* Custom HTML Signature */}
            <div className="space-y-3 pt-4 border-t border-border">
              <Label htmlFor="emailSignature">Custom HTML Signature (Optional)</Label>
              <p className="text-xs text-muted-foreground">
                Override the auto-generated signature with your own HTML. Leave blank to use the fields above.
              </p>
              <textarea
                id="emailSignature"
                value={emailSignature}
                onChange={(e) => setEmailSignature(e.target.value)}
                placeholder={`Paste your HTML signature here, or leave blank to auto-generate from fields above.`}
                className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            
            {/* Preview */}
            <div className="space-y-3 pt-4 border-t border-border">
              <Label>Signature Preview</Label>
              <div 
                className="p-4 bg-background rounded-md border border-border min-h-[80px]"
                dangerouslySetInnerHTML={{ 
                  __html: emailSignature || generateSignaturePreview(fullName, title, profile?.email || '', signatureFields)
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
