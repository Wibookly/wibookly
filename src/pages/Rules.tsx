import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Plus, Trash2, Save } from 'lucide-react';

interface Category {
  id: string;
  name: string;
  color: string;
}

interface Rule {
  id: string;
  category_id: string;
  rule_type: string;
  rule_value: string;
  is_enabled: boolean;
}

export default function Rules() {
  const { organization } = useAuth();
  const { toast } = useToast();
  const [categories, setCategories] = useState<Category[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!organization?.id) return;
    fetchData();
  }, [organization?.id]);

  const fetchData = async () => {
    if (!organization?.id) return;

    const [categoriesRes, rulesRes] = await Promise.all([
      supabase
        .from('categories')
        .select('id, name, color')
        .eq('organization_id', organization.id)
        .eq('is_enabled', true)
        .order('sort_order'),
      supabase
        .from('rules')
        .select('*')
        .eq('organization_id', organization.id)
    ]);

    setCategories(categoriesRes.data || []);
    setRules(rulesRes.data || []);
    
    if (categoriesRes.data?.[0]) {
      setSelectedCategory(categoriesRes.data[0].id);
    }
    
    setLoading(false);
  };

  const filteredRules = rules.filter(r => r.category_id === selectedCategory);

  const addRule = () => {
    if (!selectedCategory || !organization?.id) return;
    
    const newRule: Rule = {
      id: `temp-${Date.now()}`,
      category_id: selectedCategory,
      rule_type: 'sender',
      rule_value: '',
      is_enabled: true
    };
    
    setRules([...rules, newRule]);
  };

  const updateRule = (id: string, field: keyof Rule, value: any) => {
    setRules(prev =>
      prev.map(rule =>
        rule.id === id ? { ...rule, [field]: value } : rule
      )
    );
  };

  const deleteRule = async (id: string) => {
    if (id.startsWith('temp-')) {
      setRules(prev => prev.filter(r => r.id !== id));
    } else {
      await supabase.from('rules').delete().eq('id', id);
      setRules(prev => prev.filter(r => r.id !== id));
      toast({ title: 'Rule deleted' });
    }
  };

  const saveRules = async () => {
    if (!organization?.id) return;
    setSaving(true);

    try {
      const categoryRules = filteredRules.filter(r => r.rule_value.trim());
      
      for (const rule of categoryRules) {
        if (rule.id.startsWith('temp-')) {
          await supabase.from('rules').insert({
            organization_id: organization.id,
            category_id: rule.category_id,
            rule_type: rule.rule_type,
            rule_value: rule.rule_value,
            is_enabled: rule.is_enabled
          });
        } else {
          await supabase.from('rules').update({
            rule_type: rule.rule_type,
            rule_value: rule.rule_value,
            is_enabled: rule.is_enabled
          }).eq('id', rule.id);
        }
      }

      toast({ title: 'Rules saved successfully' });
      fetchData();
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to save rules',
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
    <div className="max-w-3xl animate-fade-in">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Rules</h1>
        <p className="mt-1 text-muted-foreground">
          Create rules to automatically categorize emails
        </p>
      </div>

      <div className="space-y-6">
        <div className="flex items-end gap-4">
          <div className="flex-1">
            <Label>Select Category</Label>
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger className="mt-1.5">
                <SelectValue placeholder="Select a category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: cat.color }}
                      />
                      {cat.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={addRule} disabled={!selectedCategory}>
            <Plus className="w-4 h-4 mr-2" />
            Add Rule
          </Button>
        </div>

        {filteredRules.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground bg-card rounded-lg border border-border">
            No rules for this category yet. Click "Add Rule" to create one.
          </div>
        ) : (
          <div className="space-y-3">
            {filteredRules.map((rule) => (
              <div
                key={rule.id}
                className="flex items-center gap-4 p-4 bg-card rounded-lg border border-border"
              >
                <Select
                  value={rule.rule_type}
                  onValueChange={(val) => updateRule(rule.id, 'rule_type', val)}
                >
                  <SelectTrigger className="w-32">
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

                <div className="flex items-center gap-2">
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
              </div>
            ))}
          </div>
        )}

        {filteredRules.length > 0 && (
          <div className="flex justify-end">
            <Button onClick={saveRules} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              <Save className="w-4 h-4 mr-2" />
              Save Rules
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
