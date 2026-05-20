import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { useActiveEmail } from '@/contexts/ActiveEmailContext';
import { UserAvatarDropdown } from '@/components/app/UserAvatarDropdown';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { toast as sonnerToast } from 'sonner';
import { Loader2, Plus, Trash2, GripVertical, Check, Play, Cloud, CloudOff, ChevronDown, ChevronUp, Mail, RefreshCw, Star, Download, Sparkles } from 'lucide-react';
import { CategoryToneSheet } from '@/components/categories/CategoryToneSheet';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

// Outlook-compatible category palette. These hex values match what Outlook
// actually renders for its built-in preset colors (preset0..preset24), so the
// dot in InboxIQ matches the folder/category color in Outlook Web/Desktop.
const OUTLOOK_PRESET_PALETTE: { name: string; hex: string }[] = [
  { name: 'Red',          hex: '#E74C3C' },
  { name: 'Orange',       hex: '#E67E22' },
  { name: 'Brown',        hex: '#C19A6B' },
  { name: 'Yellow',       hex: '#F1C40F' },
  { name: 'Green',        hex: '#2ECC71' },
  { name: 'Teal',         hex: '#16A085' },
  { name: 'Olive',        hex: '#95A5A6' },
  { name: 'Blue',         hex: '#3498DB' },
  { name: 'Purple',       hex: '#9B59B6' },
  { name: 'Cranberry',    hex: '#E84F9C' },
  { name: 'Steel',        hex: '#7F8C8D' },
  { name: 'Dark Steel',   hex: '#2C3E50' },
  { name: 'Gray',         hex: '#BDC3C7' },
  { name: 'Dark Gray',    hex: '#34495E' },
  { name: 'Black',        hex: '#000000' },
  { name: 'Dark Red',     hex: '#C0392B' },
  { name: 'Dark Orange',  hex: '#D35400' },
  { name: 'Dark Brown',   hex: '#8B4F2F' },
  { name: 'Dark Yellow',  hex: '#B7950B' },
  { name: 'Dark Green',   hex: '#27AE60' },
  { name: 'Dark Teal',    hex: '#0E8068' },
  { name: 'Dark Olive',   hex: '#6B6F39' },
  { name: 'Dark Blue',    hex: '#216FA8' },
  { name: 'Dark Purple',  hex: '#71368A' },
  { name: 'Dark Cranberry', hex: '#AD1457' },
];
import { categoryNameSchema, categoryColorSchema, validateField, validateRuleValue } from '@/lib/validation';
import { HelpTip } from '@/components/help/HelpTip';
import { HelpDot } from '@/components/help/HelpDot';
import { PageHero } from '@/components/app/PageHero';
import { Tags } from 'lucide-react';
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
  show_in_favorites: boolean;
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
  { name: 'Urgent',    color: '#E74C3C' }, // Red
  { name: 'No Reply Tracker', color: '#E67E22' }, // Orange
  { name: 'Approvals', color: '#F1C40F' }, // Yellow
  { name: 'Events',    color: '#2ECC71' }, // Green
  { name: 'Customers', color: '#16A085' }, // Teal
  { name: 'Vendors',   color: '#3498DB' }, // Blue
  { name: 'Internal',  color: '#9B59B6' }, // Purple
  { name: 'Projects',  color: '#E84F9C' }, // Cranberry
  { name: 'Finance',   color: '#27AE60' }, // Dark Green
  { name: 'FYI',       color: '#7F8C8D' }, // Steel
];

interface SortableRowProps {
  category: Category;
  index: number;
  updateCategory: (id: string, field: keyof Category, value: any) => void;
  requestDisable: (category: Category) => void;
  onConfigureTone: (category: Category) => void;
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

function SortableRow({ category, index, updateCategory, requestDisable, onConfigureTone }: SortableRowProps) {
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
      <TableCell>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="w-6 h-6 rounded-full border-2 border-white shadow-md cursor-pointer hover:scale-110 transition-transform"
              style={{ backgroundColor: category.color }}
              aria-label="Pick category color"
            />
          </PopoverTrigger>
          <PopoverContent className="w-64 p-3" align="start">
            <div className="text-xs font-medium text-muted-foreground mb-2">
              Outlook category colors
            </div>
            <div className="grid grid-cols-5 gap-2">
              {OUTLOOK_PRESET_PALETTE.map((p) => {
                const selected = category.color?.toUpperCase() === p.hex.toUpperCase();
                return (
                  <button
                    key={p.hex}
                    type="button"
                    title={p.name}
                    onClick={() => updateCategory(category.id, 'color', p.hex)}
                    className={`w-8 h-8 rounded-full border-2 transition-all ${
                      selected ? 'border-foreground scale-110' : 'border-white hover:scale-105'
                    }`}
                    style={{ backgroundColor: p.hex }}
                  >
                    {selected && <Check className="w-4 h-4 mx-auto text-white drop-shadow" />}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-muted-foreground mt-2 leading-snug">
              Only these colors exist in Outlook. Picking one guarantees the
              folder color matches.
            </p>
          </PopoverContent>
        </Popover>
      </TableCell>
      <TableCell>
        <Input
          value={category.name}
          onChange={(e) => updateCategory(category.id, 'name', e.target.value)}
          className="max-w-xs"
        />
      </TableCell>
        <TableCell>
          <div className="flex items-center gap-2">
            <div className="text-sm text-muted-foreground flex-1 truncate">
              {WRITING_STYLES.find(s => s.value === category.writing_style)?.label || 'Professional & Polished'}
            </div>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 gap-1 rounded-full"
                    onClick={() => onConfigureTone(category)}
                    disabled={!category.is_enabled}
                  >
                    <Sparkles className="w-3 h-3" />
                    Tone
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Configure AI tone for this category</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </TableCell>
      <TableCell className="text-center">
        <Switch
          checked={category.is_enabled}
          onCheckedChange={(checked) => {
            if (!checked && category.is_enabled) {
              requestDisable(category);
            } else {
              updateCategory(category.id, 'is_enabled', checked);
            }
          }}
        />
      </TableCell>
      <TableCell className="text-center">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-block">
                <Switch
                  checked={category.ai_draft_enabled}
                  onCheckedChange={(checked) => {
                    updateCategory(category.id, 'ai_draft_enabled', checked);
                    if (checked && !category.ai_draft_enabled) onConfigureTone(category);
                  }}
                  disabled={!category.is_enabled}
                />
              </span>
            </TooltipTrigger>
            {!category.is_enabled && (
              <TooltipContent>Turn on <b>Active</b> first to enable AI Draft.</TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      </TableCell>
      <TableCell className="text-center">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-block">
                <Switch
                  checked={category.auto_reply_enabled}
                  onCheckedChange={(checked) => {
                    updateCategory(category.id, 'auto_reply_enabled', checked);
                    if (checked && !category.auto_reply_enabled) onConfigureTone(category);
                  }}
                  disabled={!category.is_enabled || !category.ai_draft_enabled}
                />
              </span>
            </TooltipTrigger>
            {(!category.is_enabled || !category.ai_draft_enabled) && (
              <TooltipContent>
                {!category.is_enabled
                  ? 'Turn on Active first, then enable AI Draft.'
                  : 'Turn on AI Draft first to enable Auto-Reply.'}
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
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

function sanitizeCategoryName(name: string): string {
  return name
    .replace(/^\s*(?:[⭐★]|[^\p{L}\p{N}\s]\s*)?\d{1,2}\s*[:.-]\s*/u, '')
    .trim();
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
  const [pendingDisableCategory, setPendingDisableCategory] = useState<Category | null>(null);
  const [toneCategory, setToneCategory] = useState<Category | null>(null);
  
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInitialLoad = useRef(true);

  const getSyncFailureMessage = (data: any, fallback: string) => {
    const failedResult = data?.results?.find((result: any) => result?.failed > 0 || result?.error);
    return failedResult?.error || fallback;
  };

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
        last_synced_at: cat.last_synced_at ?? null,
        show_in_favorites: (cat as any).show_in_favorites ?? false,
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
    const category = categories.find(cat => cat.id === id);

    setCategories(prev =>
      prev.map(cat => {
        if (cat.id !== id) return cat;
        // Cascade: turning a category OFF also disables AI Draft, AI Auto-Reply,
        // and Favorite. Rules for this category are deleted below.
        if (field === 'is_enabled' && value === false) {
          return {
            ...cat,
            is_enabled: false,
            ai_draft_enabled: false,
            auto_reply_enabled: false,
            show_in_favorites: false,
          };
        }
        // Turning AI Draft off also disables Auto-Reply (which depends on it).
        if (field === 'ai_draft_enabled' && value === false) {
          return { ...cat, ai_draft_enabled: false, auto_reply_enabled: false };
        }
        return { ...cat, [field]: value };
      })
    );

    // When a category is turned OFF: immediately remove ALL attached rules
    // from local state so they do not get saved back by autosave.
    if (field === 'is_enabled' && value === false) {
      setRules(prev => prev.filter(r => r.category_id !== id));
      const persistedRuleIds = rules
        .filter(rule => rule.category_id === id && !rule.id.startsWith('temp-'))
        .map(rule => rule.id);

      // Best-effort immediate DB cleanup; saveChanges also enforces this so
      // stale rules cannot survive and come back when the category is re-enabled.
      if (persistedRuleIds.length > 0) {
        (async () => {
          const { error } = await supabase
            .from('rules')
            .delete()
            .in('id', persistedRuleIds);

          if (error) {
            console.error('Failed to delete rules for disabled category', category?.name ?? id, error);
          }
        })();
      }
    }

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
      // Live sync after delete so the provider rule is removed immediately.
      syncRulesToEmailProvider().catch((e) => console.error('Auto rule sync after delete failed:', e));
    }
    setHasChanges(true);
  };

  const saveChanges = useCallback(async (
    showToast = false,
    options: { syncCategories?: boolean } = {}
  ): Promise<boolean> => {
    if (!organization?.id) return false;
    const shouldSyncCategories = options.syncCategories ?? true;

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
          return false;
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
          return false;
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
          return false;
      }
    }

    setSaving(true);

    try {
      // Save categories with updated sort_order
      for (const category of categories) {
        const sanitizedName = sanitizeCategoryName(category.name);
        await supabase
          .from('categories')
          .update({
            name: sanitizedName,
            color: category.color,
            is_enabled: category.is_enabled,
            ai_draft_enabled: category.ai_draft_enabled,
            auto_reply_enabled: category.auto_reply_enabled,
            writing_style: category.writing_style,
            sort_order: category.sort_order,
            show_in_favorites: category.show_in_favorites,
          } as any)
          .eq('id', category.id);
      }

      const disabledCategoryIds = categories
        .filter(category => !category.is_enabled)
        .map(category => category.id);

      if (disabledCategoryIds.length > 0) {
        await supabase
          .from('rules')
          .delete()
          .in('category_id', disabledCategoryIds);
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

      // Build a friendly summary of what was just saved
      const catCount = categories.length;
      const ruleCount = rulesWithValues.length;
      const summary: string[] = [];
      if (catCount) summary.push(`${catCount} ${catCount === 1 ? 'category' : 'categories'}`);
      if (ruleCount) summary.push(`${ruleCount} ${ruleCount === 1 ? 'rule' : 'rules'}`);
      sonnerToast.success('Changes saved', {
        description: summary.length
          ? `Updated ${summary.join(' and ')}.`
          : 'Your changes have been saved.',
      });

      // Live auto-sync: push category folders/colors AND rules to the provider
      // on every change so the user never needs to click "Re-sync All".
      if (shouldSyncCategories) {
        await syncCategoriesToEmailProvider();
        // Sync rules in the background (non-blocking) so newly-saved rules
        // start filtering email immediately.
        syncRulesToEmailProvider().catch((e) => console.error('Auto rule sync failed:', e));
      }

      return true;
    } catch (error) {
      if (showToast) {
        toast({
          title: 'Error',
          description: 'Failed to save changes',
          variant: 'destructive'
        });
      }
      return false;
    } finally {
      setSaving(false);
    }
  }, [organization?.id, activeConnection?.id, categories, rules, toast]);

  // Background sync categories only (rules require manual sync)
  const syncCategoriesToEmailProvider = async () => {
    if (!activeConnection?.id) return;
    
    try {
      const { data, error } = await supabase.functions.invoke('sync-categories', {
        body: { connection_id: activeConnection.id }
      });

      if (error) {
        throw error;
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      if (data?.results?.some((result: any) => result?.failed > 0 || result?.error)) {
        throw new Error(getSyncFailureMessage(data, 'Failed to sync category folders.'));
      }
      
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
          last_synced_at: cat.last_synced_at ?? null,
          show_in_favorites: (cat as any).show_in_favorites ?? false,
        }));
        setCategories(cats);
      }
    } catch (error) {
      console.error('Background category sync failed:', error);
    }
  };

  // Background sync of rules — fired automatically after each save so the user
  // never has to click the per-rule Play button or "Re-sync All".
  const syncRulesToEmailProvider = async () => {
    if (!activeConnection?.id) return;
    try {
      const { data, error } = await supabase.functions.invoke('sync-rules', {
        body: { connection_id: activeConnection.id }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      // Clear any per-rule "needs sync" markers and refresh timestamps.
      setRulesNeedingSync(new Set());
      const { data: updatedRules } = await supabase
        .from('rules')
        .select('*')
        .eq('organization_id', organization?.id)
        .eq('connection_id', activeConnection.id);
      if (updatedRules) {
        setRules(prev => {
          const tempRules = prev.filter(r => r.id.startsWith('temp-'));
          const dbRules = updatedRules.map(r => ({
            ...r,
            is_advanced: r.is_advanced ?? false,
            subject_contains: r.subject_contains ?? null,
            body_contains: r.body_contains ?? null,
            condition_logic: (r.condition_logic as 'and' | 'or') ?? 'and',
            recipient_filter: r.recipient_filter ?? null,
            last_synced_at: r.last_synced_at ?? null,
          }));
          return [...dbRules, ...tempRules];
        });
      }
    } catch (error) {
      console.error('Background rule sync failed:', error);
    }
  };

  // Track which rules need syncing (modified but not synced)
  const [rulesNeedingSync, setRulesNeedingSync] = useState<Set<string>>(new Set());

  // Re-sync everything for the active connection: rebuild folders/labels (and clean up
  // legacy single-digit duplicates), then re-apply every rule against existing emails.
  const [resyncing, setResyncing] = useState(false);
  const resyncAll = async () => {
    if (!activeConnection?.id) return;
    setResyncing(true);
    try {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }

      if (hasChanges) {
        const saved = await saveChanges(true, { syncCategories: false });
        if (!saved) {
          throw new Error('Failed to save your latest category changes before re-syncing.');
        }
      }

      toast({
        title: 'Re-sync started',
        description: 'Rebuilding folders and re-applying rules. This can take a minute…'
      });

      const catRes = await supabase.functions.invoke('sync-categories', {
        body: { connection_id: activeConnection.id }
      });
      if (catRes.error) throw catRes.error;
      if (catRes.data?.error) throw new Error(catRes.data.error);
      if (catRes.data?.results?.some((result: any) => result?.failed > 0 || result?.error)) {
        throw new Error(getSyncFailureMessage(catRes.data, 'Failed to sync category folders.'));
      }

      const ruleRes = await supabase.functions.invoke('sync-rules', {
        body: { connection_id: activeConnection.id }
      });
      if (ruleRes.error) throw ruleRes.error;
      if (ruleRes.data?.error) throw new Error(ruleRes.data.error);
      if (ruleRes.data?.results?.some((result: any) => result?.failed > 0 || result?.error)) {
        throw new Error(getSyncFailureMessage(ruleRes.data, 'Failed to re-apply category rules.'));
      }

      // Clear per-rule "needs sync" markers and refetch fresh timestamps
      setRulesNeedingSync(new Set());
      await fetchData();

      toast({
        title: 'Re-sync complete',
        description: 'Folders rebuilt, duplicates cleaned, rules re-applied.'
      });
    } catch (err: any) {
      console.error('Re-sync all failed:', err);
      toast({
        title: 'Re-sync failed',
        description: err?.message ?? String(err),
        variant: 'destructive'
      });
    } finally {
      setResyncing(false);
    }
  };

  const [emailingScript, setEmailingScript] = useState(false);
  const emailOutlookScript = async () => {
    if (!activeConnection?.id) return;
    setEmailingScript(true);
    try {
      const { error } = await supabase.functions.invoke('send-outlook-script', {
        body: { connectionId: activeConnection.id },
      });
      if (error) throw error;
      toast({
        title: '📧 Script emailed!',
        description: 'Check your inbox for InboxIQ-Setup.ps1 with installation instructions.',
      });
    } catch (e: any) {
      toast({
        title: 'Could not send script',
        description: e?.message || 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setEmailingScript(false);
    }
  };

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
        body: { rule_id: ruleId, connection_id: activeConnection.id }
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

    // Wait until the user has been idle for 5 full seconds before saving
    // and pushing to the email provider. This avoids spamming Outlook with
    // partial reorders while the user is still dragging categories around —
    // each new change resets the timer, so only the FINAL state is pushed.
    saveTimeoutRef.current = setTimeout(() => {
      saveChanges(false);
    }, 5000);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [hasChanges, categories, rules, saveChanges]);

  const getRulesForCategory = (categoryId: string) => {
    return rules.filter(r => r.category_id === categoryId);
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
      <div className="min-h-full p-4 lg:p-6 max-w-7xl mx-auto w-full">
        <div className="mb-4 flex justify-end">
          <UserAvatarDropdown />
        </div>
        <div className="w-full animate-fade-in bg-card/80 backdrop-blur-sm rounded-xl border border-border shadow-lg p-6">
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
    <div className="min-h-full p-4 lg:p-6 max-w-7xl mx-auto w-full">
      {/* User Avatar Row */}
      <div className="mb-4 flex justify-end">
        <UserAvatarDropdown />
      </div>

      <PageHero
        eyebrow="AI Intelligence"
        title="Email Intelligence"
        description="Customize how your emails are organized. Drag to reorder, edit rules, and re-sync labels."
        accent="purple"
        icon={<Tags className="w-5 h-5 text-white" strokeWidth={2} />}
        actions={
          <>
            <div className="flex items-center gap-2 text-sm text-white/90">
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : lastSaved ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>Saved</span>
                </>
              ) : null}
            </div>
            <Button
              variant="secondary"
              onClick={resyncAll}
              disabled={resyncing || !activeConnection?.id}
              className="bg-white/15 text-white border border-white/25 hover:bg-white/25"
              title="Re-create folders/labels and re-apply all rules to existing emails."
            >
              {resyncing ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              Re-sync All
            </Button>
          </>
        }
      />

      <div className="w-full animate-fade-in bg-card/80 backdrop-blur-sm rounded-xl border border-border shadow-lg p-6">

      {/* Categories Table with Drag and Drop */}
      <div className="bg-card rounded-lg border border-border overflow-hidden mb-8">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12"></TableHead>
              <TableHead className="w-16"><span className="inline-flex items-center gap-1">Color <HelpTip id="category.color" /></span></TableHead>
              <TableHead className="w-48"><span className="inline-flex items-center gap-1">Category Name <HelpTip id="category.name" /></span></TableHead>
              <TableHead className="w-40">AI Draft Style</TableHead>
              <TableHead className="w-24 text-center"><span className="inline-flex items-center gap-1">Active <HelpTip id="category.enabled" /></span></TableHead>
              <TableHead className="w-24 text-center"><span className="inline-flex items-center gap-1">AI Draft <HelpTip id="category.aiDrafts" /></span></TableHead>
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
                    requestDisable={setPendingDisableCategory}
                    onConfigureTone={(c) => setToneCategory(c)}
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
          <h2 className="text-xl font-semibold tracking-tight inline-flex items-center gap-2">Rules <HelpTip id="rule.conditions" /></h2>
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
                  <span className="font-medium">{category.name}</span>
                  <span className="text-sm text-muted-foreground">
                    ({categoryRules.length} rule{categoryRules.length !== 1 ? 's' : ''})
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => addRule(category.id)}
                  className="border-2 border-primary/60 text-primary hover:bg-primary hover:text-primary-foreground shadow-sm"
                >
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
                          onClick={() => updateRuleBasic(rule.id, 'is_advanced', !rule.is_advanced)}
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

      <AlertDialog open={!!pendingDisableCategory} onOpenChange={(open) => !open && setPendingDisableCategory(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable "{pendingDisableCategory?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the <strong>"{pendingDisableCategory?.name}"</strong> folder from your Outlook mailbox, move every email currently inside it back to the <strong>Inbox</strong>, and permanently remove any rules attached to this category. This action runs the next time changes sync (within a few seconds).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep enabled</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDisableCategory) {
                  updateCategory(pendingDisableCategory.id, 'is_enabled', false);
                  toast({
                    title: 'Category disabled',
                    description: `Removing "${pendingDisableCategory.name}" folder and moving emails back to Inbox…`,
                  });
                }
                setPendingDisableCategory(null);
              }}
            >
              Disable & move emails to Inbox
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}