import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { useActiveEmail } from '@/contexts/ActiveEmailContext';
import { UserAvatarDropdown } from '@/components/app/UserAvatarDropdown';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Plus, Trash2, GripVertical, Check, Play, Cloud, CloudOff, ChevronDown, ChevronUp, Mail, RefreshCw } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { categoryNameSchema, categoryColorSchema, validateField, validateRuleValue } from '@/lib/validation';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface Category {
  id: string;
  name: string;
  color: string;
  is_enabled: boolean;
  ai_draft_enabled: boolean;
  auto_reply_enabled: boolean;
  writing_style: string;
  sort_order: number;
  last_synced_at: string | null;
}

interface Rule {
  id: string;
  category_id: string;
  rule_type: string;
  rule_value: string;
  is_enabled: boolean;
  is_advanced: boolean;
  subject_contains: string | null;
  body_contains: string | null;
  condition_logic: 'and' | 'or';
  recipient_filter: string | null;
  last_synced_at: string | null;
}

const WRITING_STYLES = [
  { value: 'professional', label: 'Professional & Polished' },
  { value: 'friendly', label: 'Friendly & Approachable' },
  { value: 'concierge', label: 'Concierge / White-Glove' },
  { value: 'direct', label: 'Direct & Efficient' },
  { value: 'empathetic', label: 'Empathetic & Supportive' },
];

const DEFAULT_CATEGORIES = [
  { name: 'Urgent', color: '#EF4444' },
  { name: 'Follow Up', color: '#F97316' },
  { name: 'Approvals', color: '#EAB308' },
  { name: 'Meetings', color: '#22C55E' },
  { name: 'Customers', color: '#06B6D4' },
  { name: 'Vendors', color: '#3B82F6' },
  { name: 'Internal', color: '#8B5CF6' },
  { name: 'Projects', color: '#EC4899' },
  { name: 'Finance', color: '#14B8A6' },
  { name: 'FYI', color: '#6B7280' },
];

interface SortableRowProps {
  category: Category;
  index: number;
  updateCategory: (id: string, field: keyof Category, value: any) => void;
}

function formatSyncTime(syncTime: string | null): string {
  if (!syncTime) return 'Never synced';
  const date = new Date(syncTime);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

function SortableRow({ category, index, updateCategory }: SortableRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: category.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <TableRow ref={setNodeRef} style={style}>
      <TableCell className="w-12">
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing p-1 hover:bg-muted rounded"
        >
          <GripVertical className="w-4 h-4 text-muted-foreground" />
        </div>
      </TableCell>
      <TableCell className="w-12 font-medium text-muted-foreground">
        {category.sort_order + 1}:
      </TableCell>
      <TableCell>
        <div className="relative">
          <div
            className="w-6 h-6 rounded-full border-2 border-white shadow-md cursor-pointer"
            style={{ backgroundColor: category.color }}
          />
          <input
            type="color"
            value={category.color}
            onChange={(e) => updateCategory(category.id, 'color', e.target.value)}
            className="absolute inset-0 w-6 h-6 opacity-0 cursor-pointer"
          />
        </div>
      </TableCell>
      <TableCell>
        <Input
          value={category.name}
          onChange={(e) => updateCategory(category.id, 'name', e.target.value)}
          className="max-w-xs"
        />
      </TableCell>
        <TableCell>
          <div className="text-sm text-muted-foreground">
            {WRITING_STYLES.find(s => s.value === category.writing_style)?.label || 'Professional & Polished'}
          </div>
        </TableCell>
      <TableCell className="text-center">
        <Switch
          checked={category.is_enabled}
          onCheckedChange={(checked) => updateCategory(category.id, 'is_enabled', checked)}
          className={category.is_enabled ? 'data-[state=checked]:bg-green-500' : ''}
        />
      </TableCell>
      <TableCell className="text-center">
        <Switch
          checked={category.ai_draft_enabled}
          onCheckedChange={(checked) => updateCategory(category.id, 'ai_draft_enabled', checked)}
          disabled={!category.is_enabled}
          className={category.ai_draft_enabled && category.is_enabled ? 'data-[state=checked]:bg-blue-500' : ''}
        />
      </TableCell>
      <TableCell className="text-center">
        <Switch
          checked={category.auto_reply_enabled}
          onCheckedChange={(checked) => updateCategory(category.id, 'auto_reply_enabled', checked)}
          disabled={!category.is_enabled || !category.ai_draft_enabled}
          className={category.auto_reply_enabled && category.is_enabled && category.ai_draft_enabled ? 'data-[state=checked]:bg-orange-500' : ''}
        />
      </TableCell>
      <TableCell className="text-center">
        {category.is_enabled ? (
          category.last_synced_at ? (
            <div className="flex items-center justify-center gap-1 text-green-600">
              <Cloud className="w-4 h-4" />
              <span className="text-xs">{formatSyncTime(category.last_synced_at)}</span>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-1 text-muted-foreground">
              <CloudOff className="w-4 h-4" />
              <span className="text-xs">Pending</span>
            </div>
          )
        ) : (
          <span className="text-xs text-muted-foreground">-</span>
        )}
      </TableCell>
    </TableRow>
  );
}

export default function Categories() {
  const { organization } = useAuth();
  const { activeConnection, loading: emailLoading } = useActiveEmail();
  const { toast } = useToast();
  const [categories, setCategories] = useState<Category[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isInitialLoad = useRef(true);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    if (!organization?.id || !activeConnection?.id) {
      if (!emailLoading) setLoading(false);
      return;
    }
    fetchData();
  }, [organization?.id, activeConnection?.id]);

  const fetchData = async () => {
    if (!organization?.id || !activeConnection?.id) return;
    setLoading(true);

    const [categoriesRes, rulesRes] = await Promise.all([
      supabase
        .from('categories')
        .select('*')
        .eq('organization_id', organization.id)
        .eq('connection_id', activeConnection.id)
        .order('sort_order'),
      supabase
        .from('rules')
        .select('*')
        .eq('organization_id', organization.id)
        .eq('connection_id', activeConnection.id)
    ]);

    if (categoriesRes.error) {
      toast({
        title: 'Error',
        description: 'Failed to load categories',
        variant: 'destructive'
      });
    } else {
      const cats = (categoriesRes.data || []).map(cat => ({
        ...cat,
        auto_reply_enabled: cat.auto_reply_enabled ?? false,
        writing_style: cat.writing_style ?? 'professional',
        last_synced_at: cat.last_synced_at ?? null
      }));
      setCategories(cats);
    }

    setRules((rulesRes.data || []).map(r => ({
      ...r,
      is_advanced: r.is_advanced ?? false,
      subject_contains: r.subject_contains ?? null,
      body_contains: r.body_contains ?? null,
      condition_logic: (r.condition_logic as 'and' | 'or') ?? 'and',
      recipient_filter: r.recipient_filter ?? null,
      last_synced_at: r.last_synced_at ?? null
    })));
    setLoading(false);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setCategories((items) => {
        const oldIndex = items.findIndex((i) => i.id === active.id);
        const newIndex = items.findIndex((i) => i.id === over.id);
        const newItems = arrayMove(items, oldIndex, newIndex);
        // Update sort_order based on new positions
        return newItems.map((item, index) => ({
          ...item,
          sort_order: index
        }));
      });
      setHasChanges(true);
    }
  };

  const updateCategory = (id: string, field: keyof Category, value: any) => {
    setCategories(prev =>
      prev.map(cat =>
        cat.id === id ? { ...cat, [field]: value } : cat
      )
    );
    setHasChanges(true);
  };

  const addRule = (categoryId: string) => {
    if (!organization?.id) return;
    
    const newRule: Rule = {
      id: `temp-${Date.now()}`,
      category_id: categoryId,
      rule_type: 'sender',
      rule_value: '',
      is_enabled: true,
      is_advanced: false,
      subject_contains: null,
      body_contains: null,
      condition_logic: 'and',
      recipient_filter: null,
      last_synced_at: null
    };
    
    setRules([...rules, newRule]);
    setHasChanges(true);
  };

  // Basic updateRule without sync tracking (internal use only)
  const updateRuleBasic = (id: string, field: keyof Rule, value: any) => {
    setRules(prev =>
      prev.map(rule =>
        rule.id === id ? { ...rule, [field]: value } : rule
      )
    );
    setHasChanges(true);
  };

  // Placeholder for updateRule - will be set after rulesNeedingSync is defined
  let updateRule = updateRuleBasic;

  const deleteRule = async (id: string) => {
    if (id.startsWith('temp-')) {
      setRules(prev => prev.filter(r => r.id !== id));
    } else {
      // Find the rule and its category to cleanup emails
      const rule = rules.find(r => r.id === id);
      if (rule) {
        const category = categories.find(c => c.id === rule.category_id);
        if (category) {
          toast({ title: 'Cleaning up emails...', description: 'Removing labels and moving emails back to inbox' });
          
          try {
            // Call cleanup function to remove labels from existing emails
            const { data, error } = await supabase.functions.invoke('cleanup-rule', {
              body: {
                rule_type: rule.rule_type,
                rule_value: rule.rule_value,
                category_name: category.name,
                category_sort_order: category.sort_order
              }
            });
            
            if (error) {
              console.error('Cleanup error:', error);
            } else if (data?.totalEmailsProcessed > 0) {
              toast({ 
                title: 'Emails cleaned up', 
                description: `Removed labels from ${data.totalEmailsProcessed} emails` 
              });
            }
          } catch (error) {
            console.error('Failed to cleanup rule:', error);
            // Continue with deletion even if cleanup fails
          }
        }
      }
      
      await supabase.from('rules').delete().eq('id', id);
      setRules(prev => prev.filter(r => r.id !== id));
      toast({ title: 'Rule deleted' });
    }
    setHasChanges(true);
  };

  const saveChanges = useCallback(async (showToast = false) => {
    if (!organization?.id) return;

    // Validate all category data before saving
    for (const category of categories) {
      const nameValidation = validateField(categoryNameSchema, category.name);
      if (!nameValidation.success) {
        if (showToast) {
          toast({
            title: 'Validation Error',
            description: `Category "${category.name}": ${nameValidation.error}`,
            variant: 'destructive'
          });
        }
        return;
      }

      const colorValidation = validateField(categoryColorSchema, category.color);
      if (!colorValidation.success) {
        if (showToast) {
          toast({
            title: 'Validation Error',
            description: `Category "${category.name}": ${colorValidation.error}`,
            variant: 'destructive'
          });
        }
        return;
      }
    }

    // Validate all rules
    const rulesWithValues = rules.filter(r => r.rule_value.trim());
    for (const rule of rulesWithValues) {
      const validation = validateRuleValue(rule.rule_type, rule.rule_value);
      if (!validation.success) {
        if (showToast) {
          toast({
            title: 'Validation Error',
            description: validation.error,
            variant: 'destructive'
          });
        }
        return;
      }
    }

    setSaving(true);

    try {
      // Save categories with updated sort_order
      for (const category of categories) {
        await supabase
          .from('categories')
          .update({
            name: category.name.trim(),
            color: category.color,
            is_enabled: category.is_enabled,
            ai_draft_enabled: category.ai_draft_enabled,
            auto_reply_enabled: category.auto_reply_enabled,
            writing_style: category.writing_style,
            sort_order: category.sort_order
          })
          .eq('id', category.id);
      }

      // Save rules
      for (const rule of rulesWithValues) {
        const validatedValue = rule.rule_value.trim();
        
        if (rule.id.startsWith('temp-')) {
          const { data } = await supabase.from('rules').insert({
            organization_id: organization.id,
            connection_id: activeConnection?.id,
            category_id: rule.category_id,
            rule_type: rule.rule_type,
            rule_value: validatedValue,
            is_enabled: rule.is_enabled,
            is_advanced: rule.is_advanced,
            subject_contains: rule.subject_contains?.trim() || null,
            body_contains: rule.body_contains?.trim() || null,
            condition_logic: rule.condition_logic,
            recipient_filter: rule.recipient_filter
          }).select().single();
          
          // Update local state with real ID
          if (data) {
            setRules(prev => prev.map(r => r.id === rule.id ? { ...r, id: data.id } : r));
          }
        } else {
          await supabase.from('rules').update({
            rule_type: rule.rule_type,
            rule_value: validatedValue,
            is_enabled: rule.is_enabled,
            is_advanced: rule.is_advanced,
            subject_contains: rule.subject_contains?.trim() || null,
            body_contains: rule.body_contains?.trim() || null,
            condition_logic: rule.condition_logic,
            recipient_filter: rule.recipient_filter
          }).eq('id', rule.id);
        }
      }

      setHasChanges(false);
      setLastSaved(new Date());

      // Only sync categories automatically, NOT rules
      // Rules require manual sync via the Play button
      syncCategoriesToEmailProvider();
    } catch (error) {
      if (showToast) {
        toast({
          title: 'Error',
          description: 'Failed to save changes',
          variant: 'destructive'
        });
      }
    } finally {
      setSaving(false);
    }
  }, [organization?.id, activeConnection?.id, categories, rules, toast]);

  // Background sync categories only (rules require manual sync)
  const syncCategoriesToEmailProvider = async () => {
    if (!activeConnection?.id) return;
    
    try {
      await supabase.functions.invoke('sync-categories', {
        body: { connectionId: activeConnection.id }
      });
      
      // Refetch categories to get updated sync timestamps
      const categoriesRes = await supabase
        .from('categories')
        .select('*')
        .eq('organization_id', organization?.id)
        .eq('connection_id', activeConnection.id)
        .order('sort_order');
      
      if (categoriesRes.data) {
        const cats = categoriesRes.data.map(cat => ({
          ...cat,
          auto_reply_enabled: cat.auto_reply_enabled ?? false,
          writing_style: cat.writing_style ?? 'professional',
          last_synced_at: cat.last_synced_at ?? null
        }));
        setCategories(cats);
      }
    } catch (error) {
      console.error('Background category sync failed:', error);
    }
  };

  // Track which rules need syncing (modified but not synced)
  const [rulesNeedingSync, setRulesNeedingSync] = useState<Set<string>>(new Set());

  // Mark rule as needing sync when modified
  const markRuleNeedsSync = (ruleId: string) => {
    if (!ruleId.startsWith('temp-')) {
      setRulesNeedingSync(prev => new Set(prev).add(ruleId));
    }
  };

  // Override updateRule to track sync needs - this is the one used in the UI
  updateRule = (id: string, field: keyof Rule, value: any) => {
    setRules(prev =>
      prev.map(rule =>
        rule.id === id ? { ...rule, [field]: value } : rule
      )
    );
    setHasChanges(true);
    markRuleNeedsSync(id);
  };

  // Check if a rule needs syncing - ONLY when explicitly marked (not just because never synced)
  const ruleNeedsSync = (ruleId: string) => {
    // Temp rules can't be synced yet
    if (ruleId.startsWith('temp-')) return false;
    // Only return true if explicitly marked as needing sync
    return rulesNeedingSync.has(ruleId);
  };

  // Check if a rule has never been synced (for initial display)
  const ruleNeverSynced = (ruleId: string) => {
    if (ruleId.startsWith('temp-')) return true;
    const rule = rules.find(r => r.id === ruleId);
    return rule && !rule.last_synced_at;
  };

  // Sync a single rule manually
  const syncSingleRule = async (ruleId: string) => {
    try {
      await supabase.functions.invoke('sync-rules', {
        body: { ruleId }
      });
      
      // Clear sync needed indicator for this rule
      setRulesNeedingSync(prev => {
        const next = new Set(prev);
        next.delete(ruleId);
        return next;
      });
      
      // Refetch rules to get updated sync timestamps
      const { data: updatedRules } = await supabase
        .from('rules')
        .select('*')
        .eq('organization_id', organization?.id);
      
      if (updatedRules) {
        setRules(prev => {
          // Preserve temporary rules that haven't been saved yet
          const tempRules = prev.filter(r => r.id.startsWith('temp-'));
          const dbRules = updatedRules.map(r => ({
            ...r,
            is_advanced: r.is_advanced ?? false,
            subject_contains: r.subject_contains ?? null,
            body_contains: r.body_contains ?? null,
            condition_logic: (r.condition_logic as 'and' | 'or') ?? 'and',
            recipient_filter: r.recipient_filter ?? null,
            last_synced_at: r.last_synced_at ?? null
          }));
          return [...dbRules, ...tempRules];
        });
      }
      
      toast({ title: 'Rule synced successfully' });
    } catch (error) {
      console.error('Failed to sync rule:', error);
      toast({
        title: 'Error',
        description: 'Failed to sync rule',
        variant: 'destructive'
      });
    }
  };

  // Auto-save effect with debounce
  useEffect(() => {
    if (isInitialLoad.current) {
      isInitialLoad.current = false;
      return;
    }

    if (!hasChanges) return;

    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Set new timeout for auto-save (1.5 seconds debounce)
    saveTimeoutRef.current = setTimeout(() => {
      saveChanges(false);
    }, 1500);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [hasChanges, categories, rules, saveChanges]);

  const getRulesForCategory = (categoryId: string) => {
    return rules.filter(r => r.category_id === categoryId);
  };


  // Get display name with number prefix
  const getDisplayName = (category: Category, index: number) => {
    return `${index + 1}: ${category.name}`;
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
        <div className="max-w-6xl mb-4 flex justify-end">
          <UserAvatarDropdown />
        </div>
        <div className="max-w-6xl animate-fade-in bg-card/80 backdrop-blur-sm rounded-xl border border-border shadow-lg p-6">
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Mail className="w-12 h-12 text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold mb-2">No Email Connected</h2>
            <p className="text-muted-foreground mb-6">
              Connect a Gmail or Outlook account to start managing your categories
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
      <div className="max-w-6xl mb-4 flex justify-end">
        <UserAvatarDropdown />
      </div>
      
      <div className="max-w-6xl animate-fade-in bg-card/80 backdrop-blur-sm rounded-xl border border-border shadow-lg p-6">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Categories</h1>
            <p className="mt-1 text-muted-foreground">
              Customize how your emails are organized. Drag to reorder.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : lastSaved ? (
                <>
                  <Check className="w-4 h-4 text-green-500" />
                  <span>Saved</span>
                </>
              ) : null}
            </div>
          </div>
        </div>

      {/* Categories Table with Drag and Drop */}
      <div className="bg-card rounded-lg border border-border overflow-hidden mb-8">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12"></TableHead>
              <TableHead className="w-12">#</TableHead>
              <TableHead className="w-16">Color</TableHead>
              <TableHead className="w-48">Category Name</TableHead>
              <TableHead className="w-40">AI Draft Style</TableHead>
              <TableHead className="w-24 text-center">Active</TableHead>
              <TableHead className="w-24 text-center">AI Draft</TableHead>
              <TableHead className="w-28 text-center">AI Auto-Reply</TableHead>
              <TableHead className="w-28 text-center">Sync Status</TableHead>
            </TableRow>
          </TableHeader>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <TableBody>
              <SortableContext
                items={categories.map(c => c.id)}
                strategy={verticalListSortingStrategy}
              >
                {categories.map((category, index) => (
                  <SortableRow
                    key={category.id}
                    category={category}
                    index={index}
                    updateCategory={updateCategory}
                  />
                ))}
              </SortableContext>
            </TableBody>
          </DndContext>
        </Table>
      </div>

      {/* Rules Section */}
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Rules</h2>
          <p className="mt-1 text-muted-foreground">
            Create rules to automatically categorize emails by sender, domain, or keyword
          </p>
        </div>

        {categories.filter(c => c.is_enabled).map((category, index) => {
          const categoryRules = getRulesForCategory(category.id);
          const displayIndex = categories.findIndex(c => c.id === category.id);
          
          return (
            <div key={category.id} className="bg-card rounded-lg border border-border p-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div
                    className="w-4 h-4 rounded-full"
                    style={{ backgroundColor: category.color }}
                  />
                  <span className="font-medium">{displayIndex + 1}: {category.name}</span>
                  <span className="text-sm text-muted-foreground">
                    ({categoryRules.length} rule{categoryRules.length !== 1 ? 's' : ''})
                  </span>
                </div>
                <Button size="sm" variant="outline" onClick={() => addRule(category.id)}>
                  <Plus className="w-4 h-4 mr-1" />
                  Add Rule
                </Button>
              </div>

              {categoryRules.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">
                  No rules yet. Add a rule to automatically categorize emails.
                </p>
              ) : (
                <div className="space-y-3">
                  {categoryRules.map((rule) => (
                    <div
                      key={rule.id}
                      className="p-3 bg-muted/50 rounded-md space-y-3"
                    >
                      {/* Main rule row */}
                      <div className="flex items-center gap-3">
                        <Select
                          value={rule.rule_type}
                          onValueChange={(val) => updateRule(rule.id, 'rule_type', val)}
                        >
                          <SelectTrigger className="w-28">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="sender">Sender</SelectItem>
                            <SelectItem value="domain">Domain</SelectItem>
                            <SelectItem value="keyword">Keyword</SelectItem>
                          </SelectContent>
                        </Select>

                        <Input
                          placeholder={
                            rule.rule_type === 'sender' ? 'john@example.com' :
                            rule.rule_type === 'domain' ? 'example.com' :
                            'keyword...'
                          }
                          value={rule.rule_value}
                          onChange={(e) => updateRule(rule.id, 'rule_value', e.target.value)}
                          className="flex-1"
                        />

                        <Switch
                          checked={rule.is_enabled}
                          onCheckedChange={(checked) => updateRule(rule.id, 'is_enabled', checked)}
                          className={rule.is_enabled ? 'data-[state=checked]:bg-green-500' : ''}
                        />

                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => syncSingleRule(rule.id)}
                                disabled={rule.id.startsWith('temp-') || saving}
                                className={`relative
                                  ${ruleNeedsSync(rule.id) 
                                    ? 'text-red-500 hover:text-red-600 hover:bg-red-50' 
                                    : ruleNeverSynced(rule.id)
                                      ? 'text-amber-500 hover:text-amber-600 hover:bg-amber-50'
                                      : 'text-green-600 hover:text-green-700 hover:bg-green-50'}
                                `}
                              >
                                {ruleNeedsSync(rule.id) && (
                                  <span className="absolute inset-0 rounded-md border-2 border-red-500 animate-[pulse_1s_ease-in-out_infinite]" />
                                )}
                                <RefreshCw className={`w-4 h-4 ${ruleNeedsSync(rule.id) ? 'animate-spin' : ''}`} />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              {ruleNeedsSync(rule.id) 
                                ? 'Click to sync changes' 
                                : ruleNeverSynced(rule.id)
                                  ? 'Click to run this rule'
                                  : 'Rule is synced'}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>

                        {/* Sync status */}
                        {!rule.id.startsWith('temp-') && (
                          rule.last_synced_at ? (
                            <div className="flex items-center gap-1 text-green-600 min-w-[80px]">
                              <Cloud className="w-4 h-4" />
                              <span className="text-xs">{formatSyncTime(rule.last_synced_at)}</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1 text-muted-foreground min-w-[80px]">
                              <CloudOff className="w-4 h-4" />
                              <span className="text-xs">Pending</span>
                            </div>
                          )
                        )}

                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteRule(rule.id)}
                          className="text-red-500 hover:text-red-600 hover:bg-red-50"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>

                      {/* Advanced toggle */}
                      <div className="flex items-center gap-2 pl-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => updateRule(rule.id, 'is_advanced', !rule.is_advanced)}
                          className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                        >
                          {rule.is_advanced ? (
                            <>
                              <ChevronUp className="w-3 h-3 mr-1" />
                              Hide Advanced
                            </>
                          ) : (
                            <>
                              <ChevronDown className="w-3 h-3 mr-1" />
                              Advanced Options
                            </>
                          )}
                        </Button>
                      </div>

                      {/* Advanced fields */}
                      {rule.is_advanced && (
                        <div className="pl-1 pt-2 border-t border-border/50 space-y-2">
                          {/* AND/OR between sender and recipient - on the left */}
                          <div className="flex items-center gap-3">
                            <Select
                              value={rule.condition_logic}
                              onValueChange={(val) => updateRule(rule.id, 'condition_logic', val as 'and' | 'or')}
                            >
                              <SelectTrigger className="w-20 h-7 text-xs bg-muted border-0">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="and">AND</SelectItem>
                                <SelectItem value="or">OR</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          {/* Recipient filter */}
                          <div className="flex items-center gap-3">
                            <span className="text-sm text-muted-foreground w-28">Recipient</span>
                            <Select
                              value={rule.recipient_filter || 'any'}
                              onValueChange={(val) => updateRule(rule.id, 'recipient_filter', val === 'any' ? null : val)}
                            >
                              <SelectTrigger className="w-40">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="any">Any</SelectItem>
                                <SelectItem value="to_me">To Me</SelectItem>
                                <SelectItem value="cc_me">CC Me</SelectItem>
                                <SelectItem value="to_or_cc_me">To or CC Me</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          {/* AND/OR between recipient and subject - on the left */}
                          <div className="flex items-center gap-3">
                            <Select
                              value={rule.condition_logic}
                              onValueChange={(val) => updateRule(rule.id, 'condition_logic', val as 'and' | 'or')}
                            >
                              <SelectTrigger className="w-20 h-7 text-xs bg-muted border-0">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="and">AND</SelectItem>
                                <SelectItem value="or">OR</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          {/* Subject contains */}
                          <div className="flex items-center gap-3">
                            <span className="text-sm text-muted-foreground w-28">Subject contains</span>
                            <Input
                              placeholder="e.g., Invoice, Project Alpha"
                              value={rule.subject_contains || ''}
                              onChange={(e) => updateRule(rule.id, 'subject_contains', e.target.value || null)}
                              className="flex-1"
                            />
                          </div>

                          {/* AND/OR between subject and body - on the left */}
                          <div className="flex items-center gap-3">
                            <Select
                              value={rule.condition_logic}
                              onValueChange={(val) => updateRule(rule.id, 'condition_logic', val as 'and' | 'or')}
                            >
                              <SelectTrigger className="w-20 h-7 text-xs bg-muted border-0">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="and">AND</SelectItem>
                                <SelectItem value="or">OR</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          {/* Body contains */}
                          <div className="flex items-center gap-3">
                            <span className="text-sm text-muted-foreground w-28">Body contains</span>
                            <Input
                              placeholder="e.g., urgent, deadline, payment"
                              value={rule.body_contains || ''}
                              onChange={(e) => updateRule(rule.id, 'body_contains', e.target.value || null)}
                              className="flex-1"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}