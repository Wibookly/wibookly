import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useActiveEmail } from "@/contexts/ActiveEmailContext";
import { UserAvatarDropdown } from "@/components/app/UserAvatarDropdown";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Sparkles, Copy, RefreshCw, Save, Mail, Globe, Tag, Pencil, X, CheckCircle2, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useSearchParams } from "react-router-dom";
import { QuotaBadge } from "@/components/app/QuotaBadge";

interface Category {
  id: string;
  name: string;
  color: string;
  writing_style: string;
  sort_order: number;
  ai_draft_enabled: boolean;
  auto_reply_enabled: boolean;
  example_reply_template: string | null;
  additional_context: string | null;
  format_style: string | null;
  ai_generated_sample: string | null;
}

interface AISettings {
  writing_style: string;
  format_style: string;
  example_reply_template: string;
  additional_context: string;
  ai_generated_sample: string;
}

const GLOBAL_TARGET = "__global__";

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

const hasTextValue = (value: string | null | undefined) => Boolean(value?.trim());

const normalizeHex = (hex: string) => {
  const value = hex.replace("#", "").trim();
  if (value.length === 3) {
    return value
      .split("")
      .map((char) => `${char}${char}`)
      .join("");
  }
  return value.padEnd(6, "0").slice(0, 6);
};

const hexToRgba = (hex: string, alpha: number) => {
  const normalized = normalizeHex(hex);
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const isCategoryCustomized = (category: Category, settings: AISettings) =>
  category.writing_style !== settings.writing_style ||
  (!!category.format_style && category.format_style !== settings.format_style) ||
  hasTextValue(category.example_reply_template) ||
  hasTextValue(category.additional_context);

export default function EmailDraft() {
  const { user, organization, loading: authLoading } = useAuth();
  const { activeConnection, loading: emailLoading } = useActiveEmail();
  const [searchParams] = useSearchParams();
  // Legacy '?tab=labels' deep links land on the same merged page; the AI
  // Label Colors card is rendered at the bottom of the page now.
  void searchParams;

  const [categories, setCategories] = useState<Category[]>([]);
  // Apply-To: GLOBAL_TARGET = global default; otherwise category id
  const [target, setTarget] = useState<string>(GLOBAL_TARGET);

  // Form fields (mirror current target)
  const [writingStyle, setWritingStyle] = useState<string>("professional");
  const [formatStyle, setFormatStyle] = useState<string>("concise");
  const [exampleReply, setExampleReply] = useState("");
  const [additionalContext, setAdditionalContext] = useState("");

  const [generatedDraft, setGeneratedDraft] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [loadingData, setLoadingData] = useState(true);

  const [aiSettings, setAiSettings] = useState<AISettings>({
    writing_style: "professional",
    format_style: "concise",
    example_reply_template: "",
    additional_context: "",
    ai_generated_sample: "",
  });
  const [aiSettingsId, setAiSettingsId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [pendingClearSampleId, setPendingClearSampleId] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!organization?.id || !activeConnection?.id) return;
    setLoadingData(true);
    try {
      const [{ data: cats }, { data: ai }] = await Promise.all([
        supabase
          .from("categories")
          .select(
            "id, name, color, writing_style, sort_order, ai_draft_enabled, auto_reply_enabled, example_reply_template, additional_context, format_style"
          )
          .eq("organization_id", organization.id)
          .eq("connection_id", activeConnection.id)
          .eq("is_enabled", true)
          .order("sort_order"),
        supabase
          .from("ai_settings")
          .select("*")
          .eq("organization_id", organization.id)
          .eq("connection_id", activeConnection.id)
          .maybeSingle(),
      ]);

      const catList = (cats || []) as unknown as Category[];
      setCategories(catList);

      const aiRow = (ai || {}) as Record<string, unknown>;
      const nextAi: AISettings = {
        writing_style: (aiRow.writing_style as string) || "professional",
        format_style: (aiRow.format_style as string) || "concise",
        example_reply_template: (aiRow.example_reply_template as string) || "",
        additional_context: (aiRow.additional_context as string) || "",
        ai_draft_label_color: (aiRow.ai_draft_label_color as string) || "#3B82F6",
        ai_sent_label_color: (aiRow.ai_sent_label_color as string) || "#F97316",
      };
      setAiSettings(nextAi);
      setAiSettingsId((aiRow.id as string) || null);

      // Default target: keep current if still valid, else global
      setTarget((curr) => {
        if (curr === GLOBAL_TARGET) return GLOBAL_TARGET;
        if (catList.some((c) => c.id === curr)) return curr;
        return GLOBAL_TARGET;
      });
    } catch (e) {
      console.error("Failed to load AI settings", e);
      toast.error("Failed to load AI settings");
    } finally {
      setLoadingData(false);
    }
  }, [organization?.id, activeConnection?.id]);

  useEffect(() => {
    if (user && activeConnection?.id) {
      fetchAll();
    } else if (!emailLoading) {
      setLoadingData(false);
    }
  }, [user, activeConnection?.id, fetchAll, emailLoading]);

  // Sync form fields when target changes
  useEffect(() => {
    if (target === GLOBAL_TARGET) {
      setWritingStyle(aiSettings.writing_style || "professional");
      setFormatStyle(aiSettings.format_style || "concise");
      setExampleReply(aiSettings.example_reply_template || "");
      setAdditionalContext(aiSettings.additional_context || "");
    } else {
      const cat = categories.find((c) => c.id === target);
      if (cat) {
        setWritingStyle(cat.writing_style || aiSettings.writing_style || "professional");
        setFormatStyle(cat.format_style || aiSettings.format_style || "concise");
        setExampleReply(cat.example_reply_template || "");
        setAdditionalContext(cat.additional_context || "");
      }
    }
    setGeneratedDraft("");
  }, [target, categories, aiSettings]);

  const handleSave = async () => {
    if (!organization?.id || !activeConnection?.id) return;
    setIsSaving(true);
    try {
      if (target === GLOBAL_TARGET) {
        const inheritingCategories = categories.filter(
          (category) => !category.writing_style || category.writing_style === aiSettings.writing_style
        );
        const payload = {
          organization_id: organization.id,
          connection_id: activeConnection.id,
          writing_style: writingStyle,
          format_style: formatStyle,
          example_reply_template: exampleReply || null,
          additional_context: additionalContext || null,
        } as Record<string, unknown>;

        if (aiSettingsId) {
          await supabase.from("ai_settings").update(payload).eq("id", aiSettingsId);
        } else {
          const { data } = await supabase
            .from("ai_settings")
            .insert([payload as never])
            .select("id")
            .single();
          if (data?.id) setAiSettingsId(data.id);
        }
        // Update local AI settings cache
        setAiSettings((prev) => ({
          ...prev,
          writing_style: writingStyle,
          format_style: formatStyle,
          example_reply_template: exampleReply,
          additional_context: additionalContext,
        }));
        if (inheritingCategories.length > 0) {
          const inheritingIds = inheritingCategories.map((category) => category.id);
          const { error: syncCategoryError } = await supabase
            .from("categories")
            .update({ writing_style: writingStyle } as never)
            .in("id", inheritingIds);

          if (syncCategoryError) throw syncCategoryError;

          setCategories((prev) =>
            prev.map((category) =>
              inheritingIds.includes(category.id)
                ? { ...category, writing_style: writingStyle }
                : category
            )
          );
        }
        toast.success("Global AI default saved — applies to all categories");
      } else {
        await supabase
          .from("categories")
          .update({
            writing_style: writingStyle,
            format_style: formatStyle,
            example_reply_template: exampleReply || null,
            additional_context: additionalContext || null,
          } as never)
          .eq("id", target);

        setCategories((prev) =>
          prev.map((c) =>
            c.id === target
              ? {
                  ...c,
                  writing_style: writingStyle,
                  format_style: formatStyle,
                  example_reply_template: exampleReply || null,
                  additional_context: additionalContext || null,
                }
              : c
          )
        );
        const cat = categories.find((c) => c.id === target);
        toast.success(`Saved override for "${cat?.name ?? "category"}"`);
      }
    } catch (e) {
      console.error(e);
      toast.error("Failed to save settings");
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetToGlobal = async () => {
    if (target === GLOBAL_TARGET) return;
    setIsSaving(true);
    try {
      await supabase
        .from("categories")
        .update({
          example_reply_template: null,
          additional_context: null,
          format_style: null,
        } as never)
        .eq("id", target);
      setCategories((prev) =>
        prev.map((c) =>
          c.id === target
            ? { ...c, example_reply_template: null, additional_context: null, format_style: null }
            : c
        )
      );
      // Refresh form to global values
      setExampleReply(aiSettings.example_reply_template || "");
      setAdditionalContext(aiSettings.additional_context || "");
      setFormatStyle(aiSettings.format_style || "concise");
      toast.success("Override removed — this category now uses the global default");
    } catch (e) {
      toast.error("Failed to reset");
    } finally {
      setIsSaving(false);
    }
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    setGeneratedDraft("");
    try {
      const cat = target === GLOBAL_TARGET ? null : categories.find((c) => c.id === target);
      const { data, error } = await supabase.functions.invoke("draft-email", {
        body: {
          categoryName: cat?.name || "General",
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
      toast.success("Preview generated!");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to generate";
      toast.error(msg);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedDraft);
    toast.success("Copied to clipboard!");
  };

  const saveAILabelColors = async () => {
    if (!organization?.id || !activeConnection?.id) return;
    setSavingColors(true);
    try {
      const payload = {
        ai_draft_label_color: aiSettings.ai_draft_label_color,
        ai_sent_label_color: aiSettings.ai_sent_label_color,
      } as Record<string, unknown>;
      if (aiSettingsId) {
        await supabase.from("ai_settings").update(payload).eq("id", aiSettingsId);
      } else {
        const { data } = await supabase
          .from("ai_settings")
          .insert([
            {
              organization_id: organization.id,
              connection_id: activeConnection.id,
              writing_style: "professional",
              ...payload,
            } as never,
          ])
          .select("id")
          .single();
        if (data?.id) setAiSettingsId(data.id);
      }
      toast.success("AI label colors saved!");
    } catch (e) {
      toast.error("Failed to save label colors");
    } finally {
      setSavingColors(false);
    }
  };

  if (authLoading || emailLoading || loadingData) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
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
              Connect a Gmail or Outlook account to configure AI drafts
            </p>
            <Button onClick={() => (window.location.href = "/integrations")}>
              Connect Email Account
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Build "configured categories" summary list
  const configuredCategories = categories.filter((category) => isCategoryCustomized(category, aiSettings));
  const hasCategoryOverrides = configuredCategories.length > 0;
  const globalStyleLabel =
    WRITING_STYLES.find((style) => style.value === aiSettings.writing_style)?.label ||
    aiSettings.writing_style;
  const globalFormatLabel =
    FORMAT_OPTIONS.find((format) => format.value === aiSettings.format_style)?.label ||
    aiSettings.format_style;

  const targetCategory = target === GLOBAL_TARGET ? null : categories.find((c) => c.id === target);
  const headerTitle = "AI Draft / Auto Reply Settings";
  const headerSubtitle = "Configure one global default for all categories — or override settings for a specific category. Customize AI label colors at the bottom of the page.";

  return (
    <div className="min-h-full p-4 lg:p-6">
      <div className="mb-4 flex justify-end">
        <UserAvatarDropdown />
      </div>

      <div className="w-full space-y-5">
        {/* Header */}
        <div className="relative overflow-hidden rounded-xl bg-card/80 backdrop-blur-sm border border-border shadow-sm p-5">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent" />
          <div className="relative flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                {headerTitle}
              </h1>
              <p className="text-sm text-muted-foreground mt-1">{headerSubtitle}</p>
            </div>
            <div className="flex flex-col gap-1.5 items-end">
              <QuotaBadge featureKey="ai_draft" label="AI Draft" />
              <QuotaBadge featureKey="ai_auto_reply" label="Auto Reply" />
            </div>
          </div>
        </div>

        {/* Main settings always render. AI Label Colors card is appended below. */}
        <>
          {/* AI Label Colors are shown at the bottom (see below). */}

            <div className="grid gap-6 lg:grid-cols-2">
              {/* Settings Panel */}
              <Card className="border-primary/20 shadow-sm">
                <CardHeader className="bg-gradient-to-r from-primary/5 to-transparent rounded-t-lg">
                  <CardTitle className="flex items-center gap-2">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <Sparkles className="h-5 w-5 text-primary" />
                    </div>
                    {target === GLOBAL_TARGET ? "Global Default Settings" : `Override: ${targetCategory?.name}`}
                  </CardTitle>
                  <CardDescription>
                    {target === GLOBAL_TARGET
                      ? "These settings apply to AI Draft and AI Auto-Reply for every category — unless that category has its own override."
                      : "Override the global default for this specific category only."}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Apply To */}
                  <div className="space-y-2">
                    <Label>Apply To</Label>
                    <Select value={target} onValueChange={setTarget}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={GLOBAL_TARGET}>
                          <div className="flex items-center gap-2">
                            <Globe className="w-4 h-4" />
                            <span>All Categories (Global Default)</span>
                          </div>
                        </SelectItem>
                        {categories.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            <div className="flex items-center gap-2">
                              <Tag className="w-4 h-4" />
                              <span>{c.name}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Pick "All Categories" to set one rule for everything, or pick a specific category to override.
                    </p>
                  </div>

                  {/* Writing Style */}
                  <div className="space-y-2">
                    <Label>Writing Style</Label>
                    <Select value={writingStyle} onValueChange={setWritingStyle}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {WRITING_STYLES.map((s) => (
                          <SelectItem key={s.value} value={s.value}>
                            {s.label}
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
                        {FORMAT_OPTIONS.map((f) => (
                          <SelectItem key={f.value} value={f.value}>
                            {f.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Example Reply */}
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
                      placeholder="Any specific instructions or context..."
                      rows={2}
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <Button onClick={handleSave} disabled={isSaving} className="w-full">
                      {isSaving ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Save className="mr-2 h-4 w-4" />
                          {target === GLOBAL_TARGET ? "Save Global Default" : "Save Category Override"}
                        </>
                      )}
                    </Button>

                    {target !== GLOBAL_TARGET && (
                      <Button
                        variant="outline"
                        onClick={handleResetToGlobal}
                        disabled={isSaving}
                        className="w-full"
                      >
                        Reset this category to global default
                      </Button>
                    )}

                    <Button
                      onClick={handleGenerate}
                      disabled={isGenerating}
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
                  </div>
                </CardContent>
              </Card>

              {/* Preview */}
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
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleGenerate}
                          disabled={isGenerating}
                        >
                          <RefreshCw className={`h-4 w-4 ${isGenerating ? "animate-spin" : ""}`} />
                        </Button>
                      </div>
                    )}
                  </CardTitle>
                  <CardDescription>
                    {target === GLOBAL_TARGET
                      ? "Preview of AI-generated reply using global default"
                      : `Preview of AI-generated reply for ${targetCategory?.name}`}
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

            {/* AI Label Colors — compact card placed between settings and overrides */}
            <Card className="border-border shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Palette className="h-4 w-4 text-purple-500" />
                  AI Label Colors
                </CardTitle>
                <CardDescription className="text-xs">
                  Choose colors for AI-processed email labels in your inbox.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-3">
                    <div className="min-w-0">
                      <Label htmlFor="aiDraftColor" className="text-sm">AI Draft</Label>
                      <p className="text-[11px] text-muted-foreground truncate">Drafts AI created for review</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div
                        className="w-7 h-7 rounded-md border border-border shadow-sm cursor-pointer relative overflow-hidden"
                        style={{ backgroundColor: aiSettings.ai_draft_label_color }}
                      >
                        <input
                          type="color"
                          id="aiDraftColor"
                          value={aiSettings.ai_draft_label_color}
                          onChange={(e) =>
                            setAiSettings((prev) => ({ ...prev, ai_draft_label_color: e.target.value }))
                          }
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        />
                      </div>
                      <span className="text-xs font-mono text-muted-foreground">
                        {aiSettings.ai_draft_label_color}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-3">
                    <div className="min-w-0">
                      <Label htmlFor="aiSentColor" className="text-sm">AI Auto-Reply</Label>
                      <p className="text-[11px] text-muted-foreground truncate">Emails AI replied to automatically</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div
                        className="w-7 h-7 rounded-md border border-border shadow-sm cursor-pointer relative overflow-hidden"
                        style={{ backgroundColor: aiSettings.ai_sent_label_color }}
                      >
                        <input
                          type="color"
                          id="aiSentColor"
                          value={aiSettings.ai_sent_label_color}
                          onChange={(e) =>
                            setAiSettings((prev) => ({ ...prev, ai_sent_label_color: e.target.value }))
                          }
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        />
                      </div>
                      <span className="text-xs font-mono text-muted-foreground">
                        {aiSettings.ai_sent_label_color}
                      </span>
                    </div>
                  </div>
                </div>

                <Button onClick={saveAILabelColors} disabled={savingColors} size="sm">
                  {savingColors && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  <Save className="w-4 h-4 mr-2" />
                  Save Colors
                </Button>
              </CardContent>
            </Card>

            {/* Per-category overrides — only shown when at least one custom override exists */}
            {hasCategoryOverrides && (
              <Card className="border-border shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Sparkles className="h-4 w-4 text-purple-500" />
                    Per-Category Overrides
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Categories with custom settings that differ from the global default. Click ✎ to edit, ✕ to remove the override.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {configuredCategories.map((c) => {
                    const effectiveStyle = c.writing_style || aiSettings.writing_style;
                    const effectiveFormat = c.format_style || aiSettings.format_style;
                    const styleLabel =
                      WRITING_STYLES.find((s) => s.value === effectiveStyle)?.label || effectiveStyle;
                    const formatLabel =
                      FORMAT_OPTIONS.find((f) => f.value === effectiveFormat)?.label || effectiveFormat;
                    return (
                      <div
                        key={`override-${c.id}`}
                        className={`rounded-lg border p-3 transition-colors ${
                          target === c.id ? "border-primary bg-primary/5" : "border-border bg-card"
                        }`}
                        style={{
                          borderColor: target === c.id ? undefined : hexToRgba(c.color, 0.32),
                          backgroundColor: target === c.id ? undefined : hexToRgba(c.color, 0.08),
                        }}
                      >
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="h-3 w-3 rounded-full border border-background/80 shadow-sm flex-shrink-0"
                              style={{ backgroundColor: c.color }}
                              aria-hidden="true"
                            />
                            <span className="font-medium text-sm truncate">{c.name}</span>
                            <Badge variant="secondary" className="text-xs">Custom</Badge>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2"
                              onClick={() => {
                                setTarget(c.id);
                                window.scrollTo({ top: 0, behavior: "smooth" });
                              }}
                              aria-label="Edit override"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-destructive hover:text-destructive"
                              onClick={() => setPendingDeleteId(c.id)}
                              aria-label="Remove override"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                          <strong className="text-foreground">{styleLabel}</strong> tone, formatted as{" "}
                          <strong className="text-foreground">{formatLabel}</strong>.
                          {c.example_reply_template ? " Custom example included." : ""}
                          {c.additional_context ? " Extra context applied." : ""}
                        </p>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}

            <AlertDialog
              open={!!pendingDeleteId}
              onOpenChange={(open) => { if (!open) setPendingDeleteId(null); }}
            >
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove this category override?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This category will go back to using the global default settings. You can recreate the override anytime.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={async () => {
                      const id = pendingDeleteId;
                      if (!id) return;
                      setPendingDeleteId(null);
                      const prevTarget = target;
                      setTarget(id);
                      // small delay so handleResetToGlobal sees the right target
                      setTimeout(async () => {
                        await handleResetToGlobal();
                        setTarget(prevTarget === id ? GLOBAL_TARGET : prevTarget);
                      }, 0);
                    }}
                  >
                    Remove override
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

          </>
      </div>
    </div>
  );
}
