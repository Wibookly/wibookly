import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useActiveEmail } from "@/contexts/ActiveEmailContext";
import { UserAvatarDropdown } from "@/components/app/UserAvatarDropdown";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Sparkles, Copy, RefreshCw, Save, Mail, Calendar, Tag } from "lucide-react";

interface Category {
  id: string;
  name: string;
  writing_style: string;
  sort_order: number;
}

interface AISettings {
  ai_draft_label_color: string;
  ai_sent_label_color: string;
  ai_calendar_event_color: string;
}

const WRITING_STYLES = [
  { value: "professional", label: "Professional & Polished" },
  { value: "friendly", label: "Friendly & Approachable" },
  { value: "concierge", label: "Concierge / White-Glove" },
  { value: "direct", label: "Direct & Efficient" },
  { value: "empathetic", label: "Empathetic & Supportive" },
];

const FORMAT_OPTIONS = [
  { value: "concise", label: "Concise (Short & Direct)" },
  { value: "detailed", label: "Detailed (Full Explanation)" },
  { value: "bullet-points", label: "Bullet Points" },
  { value: "highlights", label: "Key Highlights Only" },
];

export default function EmailDraft() {
  const { user, loading: authLoading } = useAuth();
  const { activeConnection, loading: emailLoading } = useActiveEmail();
  
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [writingStyle, setWritingStyle] = useState<string>("professional");
  const [formatStyle, setFormatStyle] = useState<string>("concise");
  
  const [exampleReply, setExampleReply] = useState("");
  const [additionalContext, setAdditionalContext] = useState("");
  
  const [generatedDraft, setGeneratedDraft] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [loadingCategories, setLoadingCategories] = useState(true);
  
  const [aiSettings, setAiSettings] = useState<AISettings>({
    ai_draft_label_color: '#3B82F6',
    ai_sent_label_color: '#F97316',
    ai_calendar_event_color: '#9333EA'
  });
  const [organizationId, setOrganizationId] = useState<string | null>(null);

  useEffect(() => {
    if (user && activeConnection?.id) {
      fetchCategories();
      fetchAISettings();
    } else if (!emailLoading) {
      setLoadingCategories(false);
    }
  }, [user, activeConnection?.id]);

  const fetchAISettings = async () => {
    if (!activeConnection?.id) return;
    
    try {
      const { data: profile } = await supabase.rpc("get_my_profile");
      if (!profile || profile.length === 0) return;
      
      setOrganizationId(profile[0].organization_id);

      const { data } = await supabase
        .from("ai_settings")
        .select("*")
        .eq("organization_id", profile[0].organization_id)
        .eq("connection_id", activeConnection.id)
        .maybeSingle();

      if (data) {
        setAiSettings({
          ai_draft_label_color: (data as Record<string, unknown>).ai_draft_label_color as string || '#3B82F6',
          ai_sent_label_color: (data as Record<string, unknown>).ai_sent_label_color as string || '#F97316',
          ai_calendar_event_color: (data as Record<string, unknown>).ai_calendar_event_color as string || '#9333EA'
        });
      }
    } catch (error) {
      console.error("Error fetching AI settings:", error);
    }
  };

  const saveAISettings = async () => {
    if (!activeConnection?.id || !organizationId) return;
    
    try {
      const { data: existing } = await supabase
        .from("ai_settings")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("connection_id", activeConnection.id)
        .maybeSingle();

      if (existing) {
        await supabase
          .from("ai_settings")
          .update({
            ai_draft_label_color: aiSettings.ai_draft_label_color,
            ai_sent_label_color: aiSettings.ai_sent_label_color,
            ai_calendar_event_color: aiSettings.ai_calendar_event_color
          } as Record<string, unknown>)
          .eq("id", existing.id);
      } else {
        // @ts-ignore - ai_settings columns may not be in types yet
        await supabase
          .from("ai_settings")
          .insert([{
            organization_id: organizationId,
            connection_id: activeConnection.id,
            writing_style: 'professional',
            ai_draft_label_color: aiSettings.ai_draft_label_color,
            ai_sent_label_color: aiSettings.ai_sent_label_color,
            ai_calendar_event_color: aiSettings.ai_calendar_event_color
          }]);
      }
      
      toast.success("AI settings saved!");
    } catch (error) {
      console.error("Error saving AI settings:", error);
      toast.error("Failed to save AI settings");
    }
  };

  const fetchCategories = async () => {
    if (!activeConnection?.id) return;
    
    try {
      const { data: profile } = await supabase.rpc("get_my_profile");
      if (!profile || profile.length === 0) return;

      const { data, error } = await supabase
        .from("categories")
        .select("id, name, writing_style, sort_order")
        .eq("organization_id", profile[0].organization_id)
        .eq("connection_id", activeConnection.id)
        .eq("is_enabled", true)
        .order("sort_order");

      if (error) throw error;
      setCategories(data || []);
      
      // Auto-select first category if available
      if (data && data.length > 0) {
        setSelectedCategory(data[0].id);
        setWritingStyle(data[0].writing_style || "professional");
      }
    } catch (error) {
      console.error("Error fetching categories:", error);
      toast.error("Failed to load categories");
    } finally {
      setLoadingCategories(false);
    }
  };

  const handleCategoryChange = (categoryId: string) => {
    setSelectedCategory(categoryId);
    const category = categories.find(c => c.id === categoryId);
    if (category) {
      setWritingStyle(category.writing_style || "professional");
    }
  };

  const handleWritingStyleChange = async (newStyle: string) => {
    setWritingStyle(newStyle);
    
    // Update the category's writing style in the database
    if (selectedCategory) {
      try {
        await supabase
          .from("categories")
          .update({ writing_style: newStyle })
          .eq("id", selectedCategory);
        
        // Update local categories state
        setCategories(prev => 
          prev.map(cat => 
            cat.id === selectedCategory ? { ...cat, writing_style: newStyle } : cat
          )
        );
      } catch (error) {
        console.error("Error updating writing style:", error);
      }
    }
  };

  const handleGenerate = async () => {
    if (!selectedCategory) {
      toast.error("Please select a category");
      return;
    }

    setIsGenerating(true);
    setGeneratedDraft("");

    try {
      const category = categories.find(c => c.id === selectedCategory);
      
      const { data, error } = await supabase.functions.invoke("draft-email", {
        body: {
          categoryName: category?.name || "General",
          writingStyle,
          formatStyle,
          action: "reply",
          exampleReply,
          additionalContext,
        },
      });

      if (error) throw error;

      if (data?.error) {
        toast.error(data.error);
        return;
      }

      setGeneratedDraft(data.draft);
      toast.success("Email draft generated!");
    } catch (error: any) {
      console.error("Error generating draft:", error);
      toast.error(error.message || "Failed to generate email draft");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!selectedCategory) {
      toast.error("Please select a category");
      return;
    }

    setIsSaving(true);

    try {
      // Update the category with the draft template for auto-reply
      await supabase
        .from("categories")
        .update({ 
          writing_style: writingStyle,
          // The draft template can be stored or used by the auto-reply system
        })
        .eq("id", selectedCategory);

      toast.success("Draft saved for auto-reply!");
    } catch (error: any) {
      console.error("Error saving draft:", error);
      toast.error("Failed to save draft");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedDraft);
    toast.success("Copied to clipboard!");
  };

  if (authLoading || emailLoading || loadingCategories) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!activeConnection) {
    return (
      <div className="min-h-full p-4 lg:p-6">
        <div className="max-w-5xl mb-4 flex justify-end">
          <UserAvatarDropdown />
        </div>
        <div className="max-w-5xl animate-fade-in bg-card/80 backdrop-blur-sm rounded-xl border border-border shadow-lg p-6">
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Mail className="w-12 h-12 text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold mb-2">No Email Connected</h2>
            <p className="text-muted-foreground mb-6">
              Connect a Gmail or Outlook account to configure AI drafts
            </p>
            <Button onClick={() => window.location.href = '/integrations'}>
              Connect Email Account
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const selectedCategoryData = categories.find(c => c.id === selectedCategory);
  const categoryDisplayName = selectedCategoryData?.name || "";

  return (
    <div className="min-h-full p-4 lg:p-6">
      {/* User Avatar Row */}
      <div className="max-w-5xl mb-4 flex justify-end">
        <UserAvatarDropdown />
      </div>
      
      <div className="max-w-5xl space-y-6">
        {/* Page header with gradient accent */}
        <div className="relative overflow-hidden rounded-xl bg-card/80 backdrop-blur-sm border border-border shadow-lg p-6">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent" />
          <div className="relative">
            <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              AI Settings
            </h1>
            <p className="text-muted-foreground mt-1">
              Configure auto-reply templates, AI writing style, and label colors
            </p>
          </div>
        </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Input Section */}
        <Card className="border-primary/20 shadow-sm">
          <CardHeader className="bg-gradient-to-r from-primary/5 to-transparent rounded-t-lg">
            <CardTitle className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-primary/10">
                <Sparkles className="h-5 w-5 text-primary" />
              </div>
              Draft Settings
            </CardTitle>
            <CardDescription>
              Configure how AI generates replies for this category
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Category Selection */}
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={selectedCategory} onValueChange={handleCategoryChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Writing Style */}
            <div className="space-y-2">
              <Label>Writing Style</Label>
              <Select value={writingStyle} onValueChange={handleWritingStyleChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WRITING_STYLES.map((style) => (
                    <SelectItem key={style.value} value={style.value}>
                      {style.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Format Style */}
            <div className="space-y-2">
              <Label>Response Format</Label>
              <Select value={formatStyle} onValueChange={setFormatStyle}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FORMAT_OPTIONS.map((format) => (
                    <SelectItem key={format.value} value={format.value}>
                      {format.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Example Reply Template */}
            <div className="space-y-2">
              <Label>Example Reply Template</Label>
              <Textarea
                value={exampleReply}
                onChange={(e) => setExampleReply(e.target.value)}
                placeholder="Paste an example of how you want replies to look. The AI will use this as a reference for tone, structure, and formatting..."
                rows={6}
              />
              <p className="text-xs text-muted-foreground">
                Provide a sample reply that represents your preferred style. The AI will mimic this format.
              </p>
            </div>

            {/* Additional Context */}
            <div className="space-y-2">
              <Label>Additional Context (Optional)</Label>
              <Textarea
                value={additionalContext}
                onChange={(e) => setAdditionalContext(e.target.value)}
                placeholder="Any specific instructions or context for this category..."
                rows={2}
              />
            </div>

            <Button 
              onClick={handleSaveDraft} 
              disabled={isSaving || !selectedCategory}
              className="w-full"
            >
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Save Settings
                </>
              )}
            </Button>

            <Button 
              onClick={handleGenerate} 
              disabled={isGenerating || !selectedCategory}
              variant="outline"
              className="w-full"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Preview Draft
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Output Section */}
        <Card className="border-accent/20 shadow-sm">
          <CardHeader className="bg-gradient-to-r from-accent/5 to-transparent rounded-t-lg">
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-accent/10">
                  <Sparkles className="h-5 w-5 text-accent" />
                </div>
                Preview
              </span>
              {generatedDraft && (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={handleCopy}>
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleGenerate} disabled={isGenerating}>
                    <RefreshCw className={`h-4 w-4 ${isGenerating ? "animate-spin" : ""}`} />
                  </Button>
                </div>
              )}
            </CardTitle>
            <CardDescription>
              Preview of AI-generated reply for {categoryDisplayName || "selected category"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {generatedDraft ? (
              <div className="rounded-lg border border-accent/20 bg-gradient-to-br from-accent/5 to-transparent p-4 min-h-[300px] whitespace-pre-wrap">
                {generatedDraft}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-accent/30 bg-gradient-to-br from-accent/5 to-transparent p-8 min-h-[300px] flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <div className="p-3 rounded-full bg-accent/10 inline-block mb-3">
                    <Sparkles className="h-8 w-8 text-accent/50" />
                  </div>
                  <p>Click "Preview Draft" to see a sample reply</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* AI Label Colors Section */}
      <Card className="border-primary/20 shadow-sm">
        <CardHeader className="bg-gradient-to-r from-primary/5 to-transparent rounded-t-lg">
          <CardTitle className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-primary/10">
              <Tag className="h-5 w-5 text-primary" />
            </div>
            AI Label Colors
          </CardTitle>
          <CardDescription>
            Choose colors for AI-processed email labels and calendar events
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* AI Draft Label */}
          <div className="flex items-center gap-4">
            <div className="flex-1 space-y-1">
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

          <div className="border-t border-border" />

          {/* AI Sent Label */}
          <div className="flex items-center gap-4">
            <div className="flex-1 space-y-1">
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

          <div className="border-t border-border" />

          {/* AI Calendar Event */}
          <div className="flex items-center gap-4">
            <div className="flex-1 space-y-1">
              <Label htmlFor="aiCalendarColor">AI Calendar Event Color</Label>
              <p className="text-xs text-muted-foreground">
                Applied to calendar events created by AI from meeting requests
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-lg border-2 border-border shadow-sm cursor-pointer relative overflow-hidden"
                style={{ backgroundColor: aiSettings.ai_calendar_event_color }}
              >
                <input
                  type="color"
                  id="aiCalendarColor"
                  value={aiSettings.ai_calendar_event_color}
                  onChange={(e) => setAiSettings(prev => ({ ...prev, ai_calendar_event_color: e.target.value }))}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
              </div>
              <span className="text-sm font-mono text-muted-foreground">{aiSettings.ai_calendar_event_color}</span>
            </div>
          </div>

          <Button onClick={saveAISettings} className="w-full">
            <Save className="mr-2 h-4 w-4" />
            Save Label Colors
          </Button>
        </CardContent>
      </Card>
    </div>
  </div>
  );
}
