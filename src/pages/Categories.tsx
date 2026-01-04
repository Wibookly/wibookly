import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Save, RefreshCw, Plus, Trash2 } from 'lucide-react';
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

interface Category {
  id: string;
  name: string;
  color: string;
  is_enabled: boolean;
  ai_draft_enabled: boolean;
  auto_reply_enabled: boolean;
  writing_style: string;
  sort_order: number;
}

interface Rule {
  id: string;
  category_id: string;
  rule_type: string;
  rule_value: string;
  is_enabled: boolean;
}

const WRITING_STYLES = [
  { value: 'professional', label: 'Professional' },
  { value: 'concise', label: 'Concise' },
  { value: 'friendly', label: 'Friendly' },
  { value: 'detailed', label: 'Detailed' },
];

const DEFAULT_CATEGORIES = [
  { name: '1: Urgent', color: '#EF4444' },
  { name: '2: Follow Up', color: '#F97316' },
  { name: '3: Approvals', color: '#EAB308' },
  { name: '4: Meetings', color: '#22C55E' },
  { name: '5: Customers', color: '#06B6D4' },
  { name: '6: Vendors', color: '#3B82F6' },
  { name: '7: Internal', color: '#8B5CF6' },
  { name: '8: Projects', color: '#EC4899' },
  { name: '9: Finance', color: '#14B8A6' },
  { name: '10: FYI', color: '#6B7280' },
];

export default function Categories() {
  const { organization } = useAuth();
  const { toast } = useToast();
  const [categories, setCategories] = useState<Category[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (!organization?.id) return;
    fetchData();
  }, [organization?.id]);

  const fetchData = async () => {
    if (!organization?.id) return;

    const [categoriesRes, rulesRes] = await Promise.all([
      supabase
        .from('categories')
        .select('*')
        .eq('organization_id', organization.id)
        .order('sort_order'),
      supabase
        .from('rules')
        .select('*')
        .eq('organization_id', organization.id)
    ]);

    if (categoriesRes.error) {
      toast({
        title: 'Error',
        description: 'Failed to load categories',
        variant: 'destructive'
      });
    } else {
      // Map categories with default values for new columns
      const cats = (categoriesRes.data || []).map(cat => ({
        ...cat,
        auto_reply_enabled: cat.auto_reply_enabled ?? false,
        writing_style: cat.writing_style ?? 'professional'
      }));
      setCategories(cats);
    }

    setRules(rulesRes.data || []);
    setLoading(false);
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
      is_enabled: true
    };
    
    setRules([...rules, newRule]);
    setHasChanges(true);
  };

  const updateRule = (id: string, field: keyof Rule, value: any) => {
    setRules(prev =>
      prev.map(rule =>
        rule.id === id ? { ...rule, [field]: value } : rule
      )
    );
    setHasChanges(true);
  };

  const deleteRule = async (id: string) => {
    if (id.startsWith('temp-')) {
      setRules(prev => prev.filter(r => r.id !== id));
    } else {
      await supabase.from('rules').delete().eq('id', id);
      setRules(prev => prev.filter(r => r.id !== id));
      toast({ title: 'Rule deleted' });
    }
    setHasChanges(true);
  };

  const saveChanges = async () => {
    if (!organization?.id) return;

    // Validate all category data before saving
    for (const category of categories) {
      const nameValidation = validateField(categoryNameSchema, category.name);
      if (!nameValidation.success) {
        toast({
          title: 'Validation Error',
          description: `Category "${category.name}": ${nameValidation.error}`,
          variant: 'destructive'
        });
        return;
      }

      const colorValidation = validateField(categoryColorSchema, category.color);
      if (!colorValidation.success) {
        toast({
          title: 'Validation Error',
          description: `Category "${category.name}": ${colorValidation.error}`,
          variant: 'destructive'
        });
        return;
      }
    }

    // Validate all rules
    const rulesWithValues = rules.filter(r => r.rule_value.trim());
    for (const rule of rulesWithValues) {
      const validation = validateRuleValue(rule.rule_type, rule.rule_value);
      if (!validation.success) {
        toast({
          title: 'Validation Error',
          description: validation.error,
          variant: 'destructive'
        });
        return;
      }
    }

    setSaving(true);

    try {
      // Save categories
      for (const category of categories) {
        await supabase
          .from('categories')
          .update({
            name: category.name.trim(),
            color: category.color,
            is_enabled: category.is_enabled,
            ai_draft_enabled: category.ai_draft_enabled,
            auto_reply_enabled: category.auto_reply_enabled,
            writing_style: category.writing_style
          })
          .eq('id', category.id);
      }

      // Save rules
      for (const rule of rulesWithValues) {
        const validatedValue = rule.rule_value.trim();
        
        if (rule.id.startsWith('temp-')) {
          await supabase.from('rules').insert({
            organization_id: organization.id,
            category_id: rule.category_id,
            rule_type: rule.rule_type,
            rule_value: validatedValue,
            is_enabled: rule.is_enabled
          });
        } else {
          await supabase.from('rules').update({
            rule_type: rule.rule_type,
            rule_value: validatedValue,
            is_enabled: rule.is_enabled
          }).eq('id', rule.id);
        }
      }

      toast({
        title: 'Saved',
        description: 'Categories and rules updated successfully'
      });
      setHasChanges(false);
      fetchData();
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to save changes',
        variant: 'destructive'
      });
    } finally {
      setSaving(false);
    }
  };

  const syncCategories = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('sync-categories');
      
      if (error) throw error;
      
      toast({
        title: 'Sync Complete',
        description: data?.message || 'Labels/folders created in your email provider'
      });
    } catch (error) {
      toast({
        title: 'Sync Failed',
        description: 'Failed to sync categories to email provider',
        variant: 'destructive'
      });
    }
  };

  const getRulesForCategory = (categoryId: string) => {
    return rules.filter(r => r.category_id === categoryId);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl animate-fade-in">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Categories</h1>
          <p className="mt-1 text-muted-foreground">
            Customize how your emails are organized
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={syncCategories}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Sync Categories
          </Button>
          <Button onClick={saveChanges} disabled={!hasChanges || saving}>
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            <Save className="w-4 h-4 mr-2" />
            Save Changes
          </Button>
        </div>
      </div>

      {/* Categories Table */}
      <div className="bg-card rounded-lg border border-border overflow-hidden mb-8">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Color</TableHead>
              <TableHead className="w-48">Category Name</TableHead>
              <TableHead className="w-40">Writing Style</TableHead>
              <TableHead className="w-24 text-center">Enabled</TableHead>
              <TableHead className="w-24 text-center">AI Draft</TableHead>
              <TableHead className="w-28 text-center">Auto Reply</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.map((category) => (
              <TableRow key={category.id}>
                <TableCell>
                  <input
                    type="color"
                    value={category.color}
                    onChange={(e) => updateCategory(category.id, 'color', e.target.value)}
                    className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    value={category.name}
                    onChange={(e) => updateCategory(category.id, 'name', e.target.value)}
                    className="max-w-xs"
                  />
                </TableCell>
                <TableCell>
                  <Select
                    value={category.writing_style}
                    onValueChange={(val) => updateCategory(category.id, 'writing_style', val)}
                    disabled={!category.is_enabled}
                  >
                    <SelectTrigger className="w-32">
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
                </TableCell>
                <TableCell className="text-center">
                  <Switch
                    checked={category.is_enabled}
                    onCheckedChange={(checked) => updateCategory(category.id, 'is_enabled', checked)}
                  />
                </TableCell>
                <TableCell className="text-center">
                  <Switch
                    checked={category.ai_draft_enabled}
                    onCheckedChange={(checked) => updateCategory(category.id, 'ai_draft_enabled', checked)}
                    disabled={!category.is_enabled}
                  />
                </TableCell>
                <TableCell className="text-center">
                  <Switch
                    checked={category.auto_reply_enabled}
                    onCheckedChange={(checked) => updateCategory(category.id, 'auto_reply_enabled', checked)}
                    disabled={!category.is_enabled || !category.ai_draft_enabled}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
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

        {categories.filter(c => c.is_enabled).map((category) => {
          const categoryRules = getRulesForCategory(category.id);
          
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
                <div className="space-y-2">
                  {categoryRules.map((rule) => (
                    <div
                      key={rule.id}
                      className="flex items-center gap-3 p-3 bg-muted/50 rounded-md"
                    >
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

                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteRule(rule.id)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
