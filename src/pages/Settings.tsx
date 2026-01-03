import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Save } from 'lucide-react';

interface AISettings {
  writing_style: string;
  signature: string | null;
}

export default function Settings() {
  const { organization, profile } = useAuth();
  const { toast } = useToast();
  const [orgName, setOrgName] = useState('');
  const [fullName, setFullName] = useState('');
  const [aiSettings, setAiSettings] = useState<AISettings>({
    writing_style: 'professional',
    signature: ''
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!organization?.id) return;
    
    setOrgName(organization.name);
    setFullName(profile?.full_name || '');
    
    fetchAISettings();
  }, [organization?.id, profile]);

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
        signature: data.signature || ''
      });
    }
    setLoading(false);
  };

  const saveSettings = async () => {
    if (!organization?.id || !profile?.user_id) return;
    setSaving(true);

    try {
      // Update organization name
      await supabase
        .from('organizations')
        .update({ name: orgName })
        .eq('id', organization.id);

      // Update user profile
      await supabase
        .from('user_profiles')
        .update({ full_name: fullName })
        .eq('user_id', profile.user_id);

      // Update AI settings
      await supabase
        .from('ai_settings')
        .upsert({
          organization_id: organization.id,
          writing_style: aiSettings.writing_style,
          signature: aiSettings.signature || null
        });

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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl animate-fade-in">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-muted-foreground">
          Manage your account and AI preferences
        </p>
      </div>

      <div className="space-y-8">
        {/* Organization Settings */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Organization</h2>
          <div className="space-y-4 p-6 bg-card rounded-lg border border-border">
            <div className="space-y-2">
              <Label htmlFor="orgName">Organization Name</Label>
              <Input
                id="orgName"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
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

        {/* AI Settings */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">AI Preferences</h2>
          <div className="space-y-4 p-6 bg-card rounded-lg border border-border">
            <div className="space-y-2">
              <Label htmlFor="writingStyle">Writing Style</Label>
              <Select
                value={aiSettings.writing_style}
                onValueChange={(val) => setAiSettings({ ...aiSettings, writing_style: val })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="professional">Professional</SelectItem>
                  <SelectItem value="concise">Concise</SelectItem>
                  <SelectItem value="friendly">Friendly</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                This affects how AI drafts your email responses
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="signature">Email Signature</Label>
              <Textarea
                id="signature"
                value={aiSettings.signature || ''}
                onChange={(e) => setAiSettings({ ...aiSettings, signature: e.target.value })}
                placeholder="Best regards,&#10;Your Name"
                rows={4}
              />
              <p className="text-xs text-muted-foreground">
                Added to the end of AI-drafted emails
              </p>
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
  );
}
