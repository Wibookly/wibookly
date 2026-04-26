import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Loader2, Plus, Trash2, Clock, Save, Zap, FileEdit } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface Category {
  id: string;
  name: string;
  color: string;
  is_enabled: boolean;
  is_follow_up: boolean;
  ai_draft_enabled: boolean;
  auto_reply_enabled: boolean;
  organization_id: string;
  connection_id: string | null;
}

interface Step {
  id: string;
  category_id: string;
  step_order: number;
  days_after_send: number;
  action: 'draft' | 'auto_send';
  message_template: string | null;
  is_enabled: boolean;
}

const COLORS = ['#8B5CF6', '#A855F7', '#D946EF', '#EC4899', '#F43F5E', '#F97316', '#EAB308', '#10B981', '#06B6D4', '#3B82F6'];

export default function FollowUpsPanel({ organizationId }: { organizationId: string | null }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [stepsByCat, setStepsByCat] = useState<Record<string, Step[]>>({});

  async function load() {
    if (!organizationId) return;
    setLoading(true);
    const { data: cats } = await supabase
      .from('categories')
      .select('id,name,color,is_enabled,is_follow_up,ai_draft_enabled,auto_reply_enabled,organization_id,connection_id')
      .eq('organization_id', organizationId)
      .eq('is_follow_up', true)
      .order('sort_order');

    const catList = (cats as Category[]) ?? [];
    setCategories(catList);

    if (catList.length > 0) {
      const { data: steps } = await supabase
        .from('follow_up_steps')
        .select('id,category_id,step_order,days_after_send,action,message_template,is_enabled')
        .in('category_id', catList.map((c) => c.id))
        .order('step_order');

      const grouped: Record<string, Step[]> = {};
      catList.forEach((c) => { grouped[c.id] = []; });
      (steps ?? []).forEach((s) => {
        grouped[s.category_id] = [...(grouped[s.category_id] ?? []), s as Step];
      });
      setStepsByCat(grouped);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [organizationId]);

  function updateCategory(id: string, patch: Partial<Category>) {
    setCategories((prev) => prev.map((c) => c.id === id ? { ...c, ...patch } : c));
  }

  function updateStep(catId: string, stepId: string, patch: Partial<Step>) {
    setStepsByCat((prev) => ({
      ...prev,
      [catId]: (prev[catId] ?? []).map((s) => s.id === stepId ? { ...s, ...patch } : s),
    }));
  }

  function addStep(catId: string) {
    const existing = stepsByCat[catId] ?? [];
    if (existing.length >= 3) {
      toast({ title: 'Max 3 reminders per category', variant: 'destructive' });
      return;
    }
    const order = existing.length + 1;
    const tempStep: Step = {
      id: `new-${Date.now()}`,
      category_id: catId,
      step_order: order,
      days_after_send: order * 2,
      action: 'draft',
      message_template: 'Polite follow-up — no response yet. Reference the original message.',
      is_enabled: true,
    };
    setStepsByCat((prev) => ({ ...prev, [catId]: [...existing, tempStep] }));
  }

  function removeStep(catId: string, stepId: string) {
    setStepsByCat((prev) => ({
      ...prev,
      [catId]: (prev[catId] ?? []).filter((s) => s.id !== stepId),
    }));
  }

  async function addCategory() {
    if (!organizationId) return;
    const conn = categories[0]?.connection_id;
    if (!conn) {
      toast({ title: 'Connect a mailbox first to add follow-up categories', variant: 'destructive' });
      return;
    }
    const idx = categories.length + 1;
    const { data, error } = await supabase
      .from('categories')
      .insert({
        organization_id: organizationId,
        connection_id: conn,
        name: `Follow-up · custom ${idx}`,
        color: COLORS[idx % COLORS.length],
        is_enabled: true,
        is_follow_up: true,
        ai_draft_enabled: true,
        auto_reply_enabled: false,
        sort_order: 100 + idx,
      })
      .select()
      .single();
    if (error) {
      toast({ title: 'Failed to create', description: error.message, variant: 'destructive' });
      return;
    }
    setCategories((prev) => [...prev, data as Category]);
    setStepsByCat((prev) => ({ ...prev, [(data as Category).id]: [] }));
  }

  async function saveAll() {
    setSaving(true);
    try {
      // Update categories
      for (const c of categories) {
        await supabase.from('categories').update({
          name: c.name,
          color: c.color,
          is_enabled: c.is_enabled,
          ai_draft_enabled: c.ai_draft_enabled,
          auto_reply_enabled: c.auto_reply_enabled,
        }).eq('id', c.id);
      }

      // Reconcile steps: delete missing, upsert present
      for (const cat of categories) {
        const currentSteps = stepsByCat[cat.id] ?? [];
        const { data: existing } = await supabase
          .from('follow_up_steps')
          .select('id')
          .eq('category_id', cat.id);
        const existingIds = new Set((existing ?? []).map((e) => e.id));
        const keepIds = new Set(currentSteps.filter((s) => !s.id.startsWith('new-')).map((s) => s.id));

        // Delete removed
        const toDelete = Array.from(existingIds).filter((id) => !keepIds.has(id));
        if (toDelete.length > 0) {
          await supabase.from('follow_up_steps').delete().in('id', toDelete);
        }

        // Upsert each
        for (let i = 0; i < currentSteps.length; i++) {
          const s = currentSteps[i];
          const payload = {
            category_id: cat.id,
            organization_id: cat.organization_id,
            step_order: i + 1,
            days_after_send: s.days_after_send,
            action: s.action,
            message_template: s.message_template,
            is_enabled: s.is_enabled,
          };
          if (s.id.startsWith('new-')) {
            await supabase.from('follow_up_steps').insert(payload);
          } else {
            await supabase.from('follow_up_steps').update(payload).eq('id', s.id);
          }
        }
      }

      toast({ title: 'Follow-ups saved' });
      load();
    } catch (e) {
      toast({ title: 'Save failed', description: String(e), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  async function deleteCategory(id: string) {
    if (!confirm('Delete this follow-up category and all its reminders?')) return;
    await supabase.from('categories').delete().eq('id', id);
    setCategories((prev) => prev.filter((c) => c.id !== id));
    setStepsByCat((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Follow-up Reminders</h2>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Configure follow-up categories that automatically nudge recipients who haven't replied to your sent emails.
            Each category can have up to 3 escalating reminder steps with custom days, action, and message tone.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" onClick={addCategory}><Plus className="w-4 h-4 mr-1" /> Add category</Button>
          <Button onClick={saveAll} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Save all
          </Button>
        </div>
      </div>

      {categories.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No follow-up categories yet. Click <strong>Add category</strong> to create one.
          </CardContent>
        </Card>
      ) : (
        categories.map((cat) => {
          const steps = stepsByCat[cat.id] ?? [];
          return (
            <Card key={cat.id} className="overflow-hidden">
              <CardHeader className="bg-muted/30">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 grid gap-3 md:grid-cols-3">
                    <div>
                      <Label className="text-xs">Name</Label>
                      <Input value={cat.name} onChange={(e) => updateCategory(cat.id, { name: e.target.value })} />
                    </div>
                    <div>
                      <Label className="text-xs">Color</Label>
                      <div className="flex gap-1 flex-wrap mt-1.5">
                        {COLORS.map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => updateCategory(cat.id, { color: c })}
                            className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110"
                            style={{
                              backgroundColor: c,
                              borderColor: cat.color === c ? 'hsl(var(--foreground))' : 'transparent',
                            }}
                            aria-label={`Color ${c}`}
                          />
                        ))}
                      </div>
                    </div>
                    <div className="flex items-end gap-4">
                      <div className="flex items-center gap-2">
                        <Switch checked={cat.is_enabled} onCheckedChange={(v) => updateCategory(cat.id, { is_enabled: v })} />
                        <Label className="text-xs">Active</Label>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => deleteCategory(cat.id)} className="text-destructive hover:text-destructive">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-6 space-y-4">
                <div className="text-xs text-muted-foreground flex items-center gap-2">
                  <Clock className="w-3 h-3" />
                  Reminder steps fire automatically based on days since the original email was sent.
                </div>

                {steps.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">No reminder steps. Add one below.</p>
                ) : (
                  steps.map((step, idx) => (
                    <div key={step.id} className="rounded-lg border p-4 space-y-3 bg-card">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">Step {idx + 1}</Badge>
                          <Switch
                            checked={step.is_enabled}
                            onCheckedChange={(v) => updateStep(cat.id, step.id, { is_enabled: v })}
                          />
                          <span className="text-xs text-muted-foreground">{step.is_enabled ? 'Active' : 'Disabled'}</span>
                        </div>
                        <Button variant="ghost" size="icon" onClick={() => removeStep(cat.id, step.id)}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>

                      <div className="grid gap-3 md:grid-cols-3">
                        <div>
                          <Label className="text-xs">Trigger after (days)</Label>
                          <Input
                            type="number"
                            min={1}
                            max={365}
                            value={step.days_after_send}
                            onChange={(e) => updateStep(cat.id, step.id, { days_after_send: Math.max(1, parseInt(e.target.value) || 1) })}
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Action</Label>
                          <Select
                            value={step.action}
                            onValueChange={(v) => updateStep(cat.id, step.id, { action: v as 'draft' | 'auto_send' })}
                          >
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="draft">
                                <span className="flex items-center gap-2"><FileEdit className="w-3 h-3" /> Create AI draft</span>
                              </SelectItem>
                              <SelectItem value="auto_send">
                                <span className="flex items-center gap-2"><Zap className="w-3 h-3" /> Auto-send reminder</span>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex items-end">
                          <Badge variant={step.action === 'auto_send' ? 'default' : 'outline'} className="text-xs">
                            {step.action === 'auto_send' ? '⚡ Sends automatically' : '✏️ User reviews draft'}
                          </Badge>
                        </div>
                      </div>

                      <div>
                        <Label className="text-xs">Message instructions for AI</Label>
                        <Textarea
                          rows={2}
                          placeholder="e.g. Polite nudge referencing the original message and asking for a quick update."
                          value={step.message_template ?? ''}
                          onChange={(e) => updateStep(cat.id, step.id, { message_template: e.target.value })}
                        />
                      </div>
                    </div>
                  ))
                )}

                {steps.length < 3 && (
                  <Button variant="outline" size="sm" onClick={() => addStep(cat.id)}>
                    <Plus className="w-3 h-3 mr-1" /> Add reminder step ({steps.length}/3)
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
