import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Save, RefreshCw } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface Category {
  id: string;
  name: string;
  color: string;
  is_enabled: boolean;
  ai_draft_enabled: boolean;
  sort_order: number;
}

export default function Categories() {
  const { organization } = useAuth();
  const { toast } = useToast();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (!organization?.id) return;
    fetchCategories();
  }, [organization?.id]);

  const fetchCategories = async () => {
    if (!organization?.id) return;

    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .eq('organization_id', organization.id)
      .order('sort_order');

    if (error) {
      toast({
        title: 'Error',
        description: 'Failed to load categories',
        variant: 'destructive'
      });
    } else {
      setCategories(data || []);
    }
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

  const saveChanges = async () => {
    setSaving(true);

    try {
      for (const category of categories) {
        await supabase
          .from('categories')
          .update({
            name: category.name,
            color: category.color,
            is_enabled: category.is_enabled,
            ai_draft_enabled: category.ai_draft_enabled
          })
          .eq('id', category.id);
      }

      toast({
        title: 'Saved',
        description: 'Categories updated successfully'
      });
      setHasChanges(false);
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
    toast({
      title: 'Sync Started',
      description: 'Categories will be synced to your email provider'
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl animate-fade-in">
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

      <div className="bg-card rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Color</TableHead>
              <TableHead>Category Name</TableHead>
              <TableHead className="w-24 text-center">Enabled</TableHead>
              <TableHead className="w-24 text-center">AI Draft</TableHead>
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
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
