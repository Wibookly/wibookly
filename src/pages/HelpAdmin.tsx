import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import {
  Sparkles,
  Plus,
  Trash2,
  Save,
  ArrowLeft,
  Loader2,
  Wand2,
  BookOpen,
  Edit3,
} from 'lucide-react';
import { AIThinking } from '@/components/ai/AIThinking';

const CATEGORIES = [
  { id: 'getting-started', label: 'Getting Started' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'categories-rules', label: 'Categories & Rules' },
  { id: 'ai-features', label: 'AI Features' },
  { id: 'account-billing', label: 'Account & Workspace' },
  { id: 'admin', label: 'Admin Dashboard' },
  { id: 'troubleshooting', label: 'Troubleshooting' },
];

interface Article {
  id: string;
  slug: string;
  title: string;
  category: string;
  summary: string;
  content: string;
  keywords: string[];
  is_published: boolean;
  sort_order: number;
  updated_at: string;
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .slice(0, 80);

export default function HelpAdmin() {
  const navigate = useNavigate();
  const { profile, loading: authLoading } = useAuth();
  const isSuperAdmin =
    profile?.email?.toLowerCase() === 'arahimi@energyforward.com';

  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Article | null>(null);
  const [saving, setSaving] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('help_articles')
      .select('*')
      .order('category')
      .order('sort_order');
    if (error) toast.error(error.message);
    else setArticles((data ?? []) as Article[]);
    setLoading(false);
  };

  useEffect(() => {
    if (!authLoading && isSuperAdmin) load();
  }, [authLoading, isSuperAdmin]);

  if (authLoading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isSuperAdmin) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <Card>
          <CardContent className="p-6">
            <p className="text-foreground">
              The Help & Support content editor is restricted to administrators.
            </p>
            <Button
              className="mt-4"
              onClick={() => navigate('/settings')}
              variant="outline"
            >
              <ArrowLeft className="w-4 h-4 mr-2" /> Back to Settings
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const newArticle = () => {
    setSelected({
      id: '',
      slug: '',
      title: '',
      category: 'getting-started',
      summary: '',
      content: '',
      keywords: [],
      is_published: true,
      sort_order: 0,
      updated_at: new Date().toISOString(),
    });
    setAiPrompt('');
  };

  const save = async () => {
    if (!selected) return;
    if (!selected.title.trim()) {
      toast.error('Title is required');
      return;
    }
    setSaving(true);
    const slug = selected.slug || slugify(selected.title);
    const payload = {
      slug,
      title: selected.title.trim(),
      category: selected.category,
      summary: selected.summary,
      content: selected.content,
      keywords: selected.keywords,
      is_published: selected.is_published,
      sort_order: selected.sort_order,
      created_by: profile?.id ?? null,
    };
    const result = selected.id
      ? await supabase
          .from('help_articles')
          .update(payload)
          .eq('id', selected.id)
          .select()
          .single()
      : await supabase.from('help_articles').insert(payload).select().single();
    setSaving(false);
    if (result.error) {
      toast.error(result.error.message);
      return;
    }
    toast.success(selected.id ? 'Article updated' : 'Article created', {
      description: selected.title,
    });
    setSelected(result.data as Article);
    load();
  };

  const remove = async (a: Article) => {
    if (!confirm(`Delete "${a.title}"? This cannot be undone.`)) return;
    const { error } = await supabase
      .from('help_articles')
      .delete()
      .eq('id', a.id);
    if (error) toast.error(error.message);
    else {
      toast.success('Article deleted');
      if (selected?.id === a.id) setSelected(null);
      load();
    }
  };

  const runAI = async (mode: 'generate' | 'improve') => {
    if (!selected) return;
    if (!aiPrompt.trim()) {
      toast.error('Describe what you want the AI to write or improve');
      return;
    }
    setAiBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        'help-content-ai',
        {
          body: {
            mode,
            prompt: aiPrompt,
            category: selected.category,
            existing:
              mode === 'improve'
                ? {
                    title: selected.title,
                    summary: selected.summary,
                    content: selected.content,
                  }
                : null,
          },
        }
      );
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const a = data.article;
      setSelected({
        ...selected,
        title: selected.title || a.title,
        summary: a.summary,
        content: a.content,
        keywords: a.keywords || [],
      });
      toast.success(
        mode === 'generate' ? 'Draft generated' : 'Article improved',
        { description: 'Review and click Save when ready' }
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'AI request failed');
    } finally {
      setAiBusy(false);
    }
  };

  const grouped = CATEGORIES.map((c) => ({
    ...c,
    items: articles.filter((a) => a.category === c.id),
  }));

  return (
    <div className="min-h-full p-4 lg:p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/settings')}
            className="mb-2"
          >
            <ArrowLeft className="w-4 h-4 mr-1" /> Settings
          </Button>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-primary" />
            Help & Support Editor
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Create and edit the in-app help articles. Use AI to draft new
            articles or improve existing ones.
          </p>
        </div>
        <Button onClick={newArticle}>
          <Plus className="w-4 h-4 mr-2" /> New Article
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        {/* Sidebar list */}
        <Card className="h-fit lg:sticky lg:top-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Articles</CardTitle>
          </CardHeader>
          <CardContent className="p-0 max-h-[70vh] overflow-y-auto">
            {loading ? (
              <div className="p-4 text-center text-muted-foreground text-sm">
                Loading…
              </div>
            ) : articles.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                No articles yet. Click <strong>New Article</strong> to get
                started.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {grouped.map((g) =>
                  g.items.length === 0 ? null : (
                    <div key={g.id} className="py-2">
                      <div className="px-4 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {g.label}
                      </div>
                      {g.items.map((a) => (
                        <button
                          key={a.id}
                          onClick={() => {
                            setSelected(a);
                            setAiPrompt('');
                          }}
                          className={`w-full text-left px-4 py-2 hover:bg-secondary/50 transition-colors ${
                            selected?.id === a.id ? 'bg-secondary/70' : ''
                          }`}
                        >
                          <div className="text-sm font-medium text-foreground truncate">
                            {a.title}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {a.summary || '—'}
                          </div>
                          {!a.is_published && (
                            <Badge
                              variant="secondary"
                              className="mt-1 text-[10px]"
                            >
                              Draft
                            </Badge>
                          )}
                        </button>
                      ))}
                    </div>
                  )
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Editor */}
        <div>
          {!selected ? (
            <Card>
              <CardContent className="p-10 text-center">
                <Edit3 className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
                <h2 className="text-lg font-semibold">Select or create an article</h2>
                <p className="text-muted-foreground text-sm mt-1 max-w-md mx-auto">
                  Pick an article from the left to edit it, or click{' '}
                  <strong>New Article</strong> to create one. You can ask the
                  AI to write a first draft for you.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {/* AI panel */}
              <Card className="border-primary/30 bg-gradient-to-br from-primary/5 via-accent/5 to-transparent">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-primary" />
                    AI Writing Assistant
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Textarea
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    placeholder="e.g. Write a step-by-step guide for connecting a Microsoft 365 mailbox, including admin consent."
                    className="min-h-[80px]"
                    disabled={aiBusy}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      onClick={() => runAI('generate')}
                      disabled={aiBusy}
                    >
                      <Wand2 className="w-4 h-4 mr-2" />
                      Generate Draft
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => runAI('improve')}
                      disabled={aiBusy || !selected.content}
                    >
                      <Sparkles className="w-4 h-4 mr-2" />
                      Improve Existing
                    </Button>
                    {aiBusy && <AIThinking label="Writing your article" />}
                  </div>
                </CardContent>
              </Card>

              {/* Article fields */}
              <Card>
                <CardHeader className="pb-3 flex flex-row items-center justify-between">
                  <CardTitle className="text-base">
                    {selected.id ? 'Edit Article' : 'New Article'}
                  </CardTitle>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Switch
                        checked={selected.is_published}
                        onCheckedChange={(v) =>
                          setSelected({ ...selected, is_published: v })
                        }
                      />
                      <span>{selected.is_published ? 'Published' : 'Draft'}</span>
                    </div>
                    {selected.id && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => remove(selected)}
                        className="text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-3">
                    <div>
                      <Label>Title</Label>
                      <Input
                        value={selected.title}
                        onChange={(e) =>
                          setSelected({ ...selected, title: e.target.value })
                        }
                        placeholder="e.g. How to connect Gmail"
                      />
                    </div>
                    <div>
                      <Label>Category</Label>
                      <Select
                        value={selected.category}
                        onValueChange={(v) =>
                          setSelected({ ...selected, category: v })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CATEGORIES.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label>Summary</Label>
                    <Input
                      value={selected.summary}
                      onChange={(e) =>
                        setSelected({ ...selected, summary: e.target.value })
                      }
                      placeholder="One-sentence summary shown in lists"
                    />
                  </div>
                  <div>
                    <Label>Content (Markdown)</Label>
                    <Textarea
                      value={selected.content}
                      onChange={(e) =>
                        setSelected({ ...selected, content: e.target.value })
                      }
                      placeholder="Write the article body in markdown…"
                      className="min-h-[320px] font-mono text-sm"
                    />
                  </div>
                  <div>
                    <Label>Keywords (comma-separated)</Label>
                    <Input
                      value={selected.keywords.join(', ')}
                      onChange={(e) =>
                        setSelected({
                          ...selected,
                          keywords: e.target.value
                            .split(',')
                            .map((k) => k.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder="gmail, oauth, connect"
                    />
                  </div>
                  <Separator />
                  <div className="flex items-center justify-end gap-2">
                    <Button variant="outline" onClick={() => setSelected(null)}>
                      Cancel
                    </Button>
                    <Button onClick={save} disabled={saving}>
                      {saving ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Save className="w-4 h-4 mr-2" />
                      )}
                      Save
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
