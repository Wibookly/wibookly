import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ArrowLeft,
  ChevronRight,
  LifeBuoy,
  PlayCircle,
  RotateCcw,
  Search,
  BookOpen,
  Sparkles,
  MessageSquareWarning,
} from 'lucide-react';
import {
  HELP_ARTICLES,
  HELP_CATEGORIES,
  HelpArticle,
  HelpCategoryId,
  getContextualArticles,
  searchArticles,
} from '@/config/help-content';
import { MiniMarkdown } from './MiniMarkdown';
import { RESTART_SETUP_WIZARD_EVENT } from './events';
import { HelpChat } from './HelpChat';
import { HelpIssueForm } from './HelpIssueForm';

type HelpTab = 'articles' | 'chat' | 'issue';

interface HelpPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional article id to deep-link to when the panel opens. */
  initialArticleId?: string | null;
}

export function HelpPanel({ open, onOpenChange, initialArticleId }: HelpPanelProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [tab, setTab] = useState<HelpTab>('articles');
  const [query, setQuery] = useState('');
  const [activeArticleId, setActiveArticleId] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<HelpCategoryId | null>(null);

  // Deep-link to a specific article when requested.
  useEffect(() => {
    if (open && initialArticleId) {
      setTab('articles');
      setActiveArticleId(initialArticleId);
      setActiveCategory(null);
      setQuery('');
    }
  }, [open, initialArticleId]);

  // Reset internal state when the panel closes
  useEffect(() => {
    if (!open) {
      setQuery('');
      setActiveArticleId(null);
      setActiveCategory(null);
      // Keep the last-used tab so opening Help feels continuous.
    }
  }, [open]);

  const contextual = useMemo(() => getContextualArticles(location.pathname), [location.pathname]);
  const searchResults = useMemo(() => (query.trim() ? searchArticles(query) : []), [query]);

  const activeArticle: HelpArticle | undefined = activeArticleId
    ? HELP_ARTICLES.find((a) => a.id === activeArticleId)
    : undefined;

  const articlesInCategory = activeCategory
    ? HELP_ARTICLES.filter((a) => a.category === activeCategory)
    : [];

  const openArticle = (id: string) => setActiveArticleId(id);

  const restartWizard = () => {
    onOpenChange(false);
    window.dispatchEvent(new CustomEvent(RESTART_SETUP_WIZARD_EVENT));
  };

  const goTo = (path: string) => {
    onOpenChange(false);
    navigate(path);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md p-0 flex flex-col"
        aria-label="Help and support panel"
      >
        <SheetHeader className="px-5 pt-5 pb-3 border-b">
          <div className="flex items-center gap-2">
            <LifeBuoy className="w-5 h-5 text-primary" aria-hidden />
            <SheetTitle>Help & Support</SheetTitle>
          </div>
          <SheetDescription className="text-xs">
            Search articles, ask the AI assistant, or send your admin team an issue.
          </SheetDescription>
        </SheetHeader>

        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as HelpTab)}
          className="flex-1 flex flex-col overflow-hidden"
        >
          <div className="px-5 pt-3">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="articles" className="text-xs">
                <BookOpen className="h-3.5 w-3.5 mr-1.5" /> Articles
              </TabsTrigger>
              <TabsTrigger value="chat" className="text-xs">
                <Sparkles className="h-3.5 w-3.5 mr-1.5" /> AI Chat
              </TabsTrigger>
              <TabsTrigger value="issue" className="text-xs">
                <MessageSquareWarning className="h-3.5 w-3.5 mr-1.5" /> Issue
              </TabsTrigger>
            </TabsList>
          </div>

          {/* === Articles tab === */}
          <TabsContent
            value="articles"
            className="flex-1 overflow-hidden mt-0 flex flex-col"
          >
            {!activeArticle && (
              <div className="px-5 pt-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search help articles…"
                    className="pl-9"
                    aria-label="Search help articles"
                  />
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
              {activeArticle ? (
                <article className="space-y-4">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setActiveArticleId(null)}
                    className="-ml-2"
                  >
                    <ArrowLeft className="w-4 h-4 mr-1" /> Back
                  </Button>
                  <div>
                    <Badge variant="secondary" className="mb-2 text-[10px] uppercase">
                      {HELP_CATEGORIES.find((c) => c.id === activeArticle.category)?.label}
                    </Badge>
                    <h3 className="text-lg font-semibold text-foreground">{activeArticle.title}</h3>
                    <p className="text-sm text-muted-foreground mt-1">{activeArticle.summary}</p>
                  </div>

                  {/* Primary CTA — jump straight to the dashboard page this article describes */}
                  {activeArticle.routes && activeArticle.routes.length > 0 && (
                    <Button
                      onClick={() => goTo(activeArticle.routes![0])}
                      className="w-full justify-center gap-2"
                    >
                      <ExternalLink className="w-4 h-4" />
                      Open this section in the dashboard
                    </Button>
                  )}

                  {/* Optional dashboard screenshot to orient the user */}
                  {activeArticle.image && (
                    <figure className="rounded-md border overflow-hidden bg-muted">
                      <img
                        src={activeArticle.image.src}
                        alt={activeArticle.image.alt}
                        loading="lazy"
                        className="w-full h-auto block"
                      />
                      <figcaption className="text-[11px] text-muted-foreground px-2 py-1.5 border-t bg-background">
                        {activeArticle.image.alt}
                      </figcaption>
                    </figure>
                  )}

                  {activeArticle.intro && (
                    <div className="pt-2 border-t">
                      <MiniMarkdown source={activeArticle.intro} />
                    </div>
                  )}

                  {activeArticle.steps && activeArticle.steps.length > 0 && (
                    <div className="pt-2 border-t space-y-3">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        Step-by-step
                      </p>
                      <ol className="space-y-2.5">
                        {activeArticle.steps.map((s, i) => (
                          <li
                            key={i}
                            className="rounded-md border bg-card p-3 hover:border-primary/40 transition-colors"
                          >
                            <p className="text-sm font-semibold text-foreground">{s.title}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{s.description}</p>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}

                  {activeArticle.body && (
                    <div className="pt-2 border-t">
                      <MiniMarkdown source={activeArticle.body} />
                    </div>
                  )}

                  {activeArticle.outro && (
                    <div className="pt-2 border-t">
                      <MiniMarkdown source={activeArticle.outro} />
                    </div>
                  )}

                  {activeArticle.routes && activeArticle.routes.length > 1 && (
                    <div className="pt-3 border-t space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        Related pages
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {activeArticle.routes.slice(1).map((r) => (
                          <Button
                            key={r}
                            variant="outline"
                            size="sm"
                            onClick={() => goTo(r)}
                            className="text-xs"
                          >
                            {r}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                </article>
              ) : query.trim() ? (
                <section aria-label="Search results">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                    {searchResults.length} result{searchResults.length === 1 ? '' : 's'}
                  </p>
                  {searchResults.length === 0 ? (
                    <div className="space-y-3 py-2">
                      <p className="text-sm text-muted-foreground">
                        No articles matched "{query}".
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setTab('chat')}
                      >
                        <Sparkles className="w-4 h-4 mr-2" /> Ask the AI assistant
                      </Button>
                    </div>
                  ) : (
                    <ul className="space-y-1">
                      {searchResults.map((a) => (
                        <ArticleListItem key={a.id} article={a} onOpen={openArticle} />
                      ))}
                    </ul>
                  )}
                </section>
              ) : activeCategory ? (
                <section aria-label="Category articles">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setActiveCategory(null)}
                    className="-ml-2 mb-2"
                  >
                    <ArrowLeft className="w-4 h-4 mr-1" /> All topics
                  </Button>
                  <h4 className="text-base font-semibold mb-3">
                    {HELP_CATEGORIES.find((c) => c.id === activeCategory)?.label}
                  </h4>
                  <ul className="space-y-1">
                    {articlesInCategory.map((a) => (
                      <ArticleListItem key={a.id} article={a} onOpen={openArticle} />
                    ))}
                  </ul>
                </section>
              ) : (
                <>
                  {contextual.length > 0 && (
                    <section aria-label="Help for this page">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                        For this page
                      </p>
                      <ul className="space-y-1">
                        {contextual.map((a) => (
                          <ArticleListItem key={a.id} article={a} onOpen={openArticle} />
                        ))}
                      </ul>
                    </section>
                  )}

                  <section aria-label="Quick actions">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                      Quick actions
                    </p>
                    <div className="grid grid-cols-1 gap-2">
                      <Button variant="outline" className="justify-start" onClick={restartWizard}>
                        <RotateCcw className="w-4 h-4 mr-2" />
                        Restart Setup Wizard
                      </Button>
                      <Button
                        variant="outline"
                        className="justify-start"
                        onClick={() => setTab('chat')}
                      >
                        <Sparkles className="w-4 h-4 mr-2" />
                        Ask the AI Assistant
                      </Button>
                      <Button
                        variant="outline"
                        className="justify-start"
                        onClick={() => setTab('issue')}
                      >
                        <MessageSquareWarning className="w-4 h-4 mr-2" />
                        Submit an issue
                      </Button>
                    </div>
                  </section>

                  <section aria-label="Browse by topic">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                      Browse by topic
                    </p>
                    <ul className="divide-y divide-border rounded-md border">
                      {HELP_CATEGORIES.map((c) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => setActiveCategory(c.id)}
                            className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-muted/50 transition-colors"
                          >
                            <span>
                              <span className="text-sm font-medium block">{c.label}</span>
                              <span className="text-xs text-muted-foreground">{c.description}</span>
                            </span>
                            <ChevronRight className="w-4 h-4 text-muted-foreground" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>

                  <section aria-label="Video tutorials">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                      Video tutorials
                    </p>
                    <div className="rounded-md border border-dashed p-4 text-center">
                      <PlayCircle className="w-6 h-6 text-muted-foreground mx-auto mb-1" />
                      <p className="text-sm text-muted-foreground">
                        Video walkthroughs are coming soon.
                      </p>
                    </div>
                  </section>
                </>
              )}
            </div>
          </TabsContent>

          {/* === AI Chat tab === */}
          <TabsContent
            value="chat"
            className="flex-1 overflow-hidden mt-0 px-5 py-3 data-[state=active]:flex data-[state=active]:flex-col"
          >
            <HelpChat />
          </TabsContent>

          {/* === Issue tab === */}
          <TabsContent
            value="issue"
            className="flex-1 overflow-y-auto mt-0 px-5 py-4"
          >
            <HelpIssueForm />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

function ArticleListItem({
  article,
  onOpen,
}: {
  article: HelpArticle;
  onOpen: (id: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(article.id)}
        className="w-full text-left px-3 py-2 rounded-md hover:bg-muted/50 transition-colors group"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{article.title}</p>
            <p className="text-xs text-muted-foreground truncate">{article.summary}</p>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5 group-hover:translate-x-0.5 transition-transform" />
        </div>
      </button>
    </li>
  );
}
