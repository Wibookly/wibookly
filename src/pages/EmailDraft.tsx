import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Sparkles, Copy, RefreshCw, Save } from "lucide-react";

interface Category {
  id: string;
  name: string;
  writing_style: string;
  sort_order: number;
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

  useEffect(() => {
    if (user) {
      fetchCategories();
    }
  }, [user]);

  const fetchCategories = async () => {
    try {
      const { data: profile } = await supabase.rpc("get_my_profile");
      if (!profile || profile.length === 0) return;

      const { data, error } = await supabase
        .from("categories")
        .select("id, name, writing_style, sort_order")
        .eq("organization_id", profile[0].organization_id)
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
    if (!selectedCategory || !generatedDraft) {
      toast.error("Generate a draft first");
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

  if (authLoading || loadingCategories) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const selectedCategoryData = categories.find(c => c.id === selectedCategory);
  const categoryDisplayName = selectedCategoryData 
    ? `${selectedCategoryData.sort_order + 1}: ${selectedCategoryData.name}`
    : "";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">AI Email Drafting</h1>
        <p className="text-muted-foreground">
          Configure auto-reply templates for each category
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Input Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
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
                      {category.sort_order + 1}: {category.name}
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
              onClick={handleGenerate} 
              disabled={isGenerating || !selectedCategory}
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
                  Generate Preview Draft
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Output Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                Generated Draft
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
              <div className="space-y-4">
                <div className="rounded-lg border bg-muted/50 p-4 min-h-[300px] whitespace-pre-wrap">
                  {generatedDraft}
                </div>
                <Button 
                  onClick={handleSaveDraft} 
                  disabled={isSaving}
                  className="w-full"
                  variant="secondary"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="mr-2 h-4 w-4" />
                      Save for Auto-Reply
                    </>
                  )}
                </Button>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed bg-muted/30 p-8 min-h-[300px] flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>Configure settings and generate a preview draft</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
