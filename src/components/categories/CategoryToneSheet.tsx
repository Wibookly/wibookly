import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Sparkles, Save, Wand2, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

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

export interface CategoryToneSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoryId: string | null;
  categoryName?: string;
  categoryColor?: string;
  aiDraftEnabled?: boolean;
  autoReplyEnabled?: boolean;
  organizationId: string;
  connectionId: string;
  onSaved?: (patch: {
    writing_style: string;
    format_style: string;
    example_reply_template: string | null;
    additional_context: string | null;
  }) => void;
}

export function CategoryToneSheet({
  open,
  onOpenChange,
  categoryId,
  categoryName,
  categoryColor,
  aiDraftEnabled,
  autoReplyEnabled,
  organizationId,
  connectionId,
  onSaved,
}: CategoryToneSheetProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [applyToAll, setApplyToAll] = useState(false);
  const [writingStyle, setWritingStyle] = useState("professional");
  const [formatStyle, setFormatStyle] = useState("concise");
  const [exampleReply, setExampleReply] = useState("");
  const [additionalContext, setAdditionalContext] = useState("");

  useEffect(() => {
    if (!open || !categoryId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data: cat } = await supabase
          .from("categories")
          .select(
            "writing_style, format_style, example_reply_template, additional_context"
          )
          .eq("id", categoryId)
          .maybeSingle();
        const { data: ai } = await supabase
          .from("ai_settings")
          .select("writing_style, format_style, example_reply_template, additional_context")
          .eq("organization_id", organizationId)
          .eq("connection_id", connectionId)
          .maybeSingle();
        if (cancelled) return;
        const c = (cat || {}) as any;
        const a = (ai || {}) as any;
        setWritingStyle(c.writing_style || a.writing_style || "professional");
        setFormatStyle(c.format_style || a.format_style || "concise");
        setExampleReply(c.example_reply_template || "");
        setAdditionalContext(c.additional_context || "");
        setApplyToAll(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, categoryId, organizationId, connectionId]);

  const handleGenerateSample = async () => {
    if (!categoryId) return;
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("draft-email", {
        body: {
          mode: "sample",
          category_id: categoryId,
          writing_style: writingStyle,
          format_style: formatStyle,
          additional_context: additionalContext,
        },
      });
      if (error) throw error;
      const draft = (data as any)?.draft || (data as any)?.text;
      if (draft) {
        setExampleReply(draft);
        toast.success("Sample reply generated");
      } else {
        toast.message("No sample returned — try Save to persist your tone");
      }
    } catch (e: any) {
      toast.error(e?.message || "Could not generate sample");
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!categoryId) return;
    setSaving(true);
    try {
      const patch = {
        writing_style: writingStyle,
        format_style: formatStyle,
        example_reply_template: exampleReply || null,
        additional_context: additionalContext || null,
      };
      if (applyToAll) {
        const { error: aiErr } = await supabase
          .from("ai_settings")
          .upsert(
            {
              organization_id: organizationId,
              connection_id: connectionId,
              ...patch,
            } as any,
            { onConflict: "organization_id,connection_id" } as any
          );
        if (aiErr) throw aiErr;
        const { error: catErr } = await supabase
          .from("categories")
          .update(patch as any)
          .eq("organization_id", organizationId)
          .eq("connection_id", connectionId);
        if (catErr) throw catErr;
        toast.success("Tone applied to all categories");
      } else {
        const { error } = await supabase
          .from("categories")
          .update(patch as any)
          .eq("id", categoryId);
        if (error) throw error;
        toast.success(`Tone saved for "${categoryName ?? "category"}"`);
      }
      onSaved?.(patch);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message || "Failed to save tone");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl overflow-y-auto p-0"
      >
        {/* Gradient hero */}
        <div
          className="px-6 pt-6 pb-5 border-b"
          style={{
            background: categoryColor
              ? `linear-gradient(135deg, ${categoryColor}22, transparent 70%)`
              : undefined,
          }}
        >
          <SheetHeader className="space-y-2 text-left">
            <div className="flex items-center gap-2">
              {categoryColor && (
                <span
                  className="w-3 h-3 rounded-full ring-2 ring-background"
                  style={{ backgroundColor: categoryColor }}
                />
              )}
              <Badge variant="secondary" className="gap-1">
                <Sparkles className="w-3 h-3" /> AI Tone
              </Badge>
              {aiDraftEnabled && (
                <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">
                  AI Draft on
                </Badge>
              )}
              {autoReplyEnabled && (
                <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30">
                  Auto-Reply on
                </Badge>
              )}
            </div>
            <SheetTitle className="text-2xl">
              {categoryName ? `Tone for "${categoryName}"` : "Configure AI Tone"}
            </SheetTitle>
            <SheetDescription>
              Set how AI writes drafts and auto-replies for this category. You
              can save it just for this rule or apply it to every category.
            </SheetDescription>
          </SheetHeader>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="px-6 py-5 space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Writing style</Label>
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
              <div className="space-y-1.5">
                <Label>Format</Label>
                <Select value={formatStyle} onValueChange={setFormatStyle}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FORMAT_OPTIONS.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Additional context</Label>
              <Textarea
                rows={3}
                placeholder="Sign-off, do's & don'ts, brand voice — anything the AI should always remember for this category."
                value={additionalContext}
                onChange={(e) => setAdditionalContext(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Example / sample reply</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleGenerateSample}
                  disabled={generating}
                >
                  {generating ? (
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <Wand2 className="w-3.5 h-3.5 mr-1.5" />
                  )}
                  Generate sample
                </Button>
              </div>
              <Textarea
                rows={9}
                placeholder="Paste a reply that nails your tone, or let AI generate one above."
                value={exampleReply}
                onChange={(e) => setExampleReply(e.target.value)}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                AI uses this as the reference template every time it drafts or
                auto-replies for {categoryName ? `"${categoryName}"` : "this category"}.
              </p>
            </div>

            <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-4 py-3">
              <div>
                <div className="text-sm font-medium">Apply to every category</div>
                <div className="text-xs text-muted-foreground">
                  Save these settings as the global default and overwrite all
                  category overrides.
                </div>
              </div>
              <Switch checked={applyToAll} onCheckedChange={setApplyToAll} />
            </div>

            <div className="flex items-center justify-between pt-2">
              <Button asChild variant="ghost" size="sm">
                <Link to="/email-draft">
                  Open full editor <ArrowRight className="w-3.5 h-3.5 ml-1" />
                </Link>
              </Button>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4 mr-2" />
                  )}
                  Save tone
                </Button>
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
