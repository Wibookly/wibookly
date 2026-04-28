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
import {
  ArrowLeft,
  ChevronRight,
  LifeBuoy,
  PlayCircle,
  RotateCcw,
  Search,
  Sparkles,
  Mail,
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

interface HelpPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional article id to deep-link to when the panel opens. */
  initialArticleId?: string | null;
}

export function HelpPanel({ open, onOpenChange, initialArticleId }: HelpPanelProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [activeArticleId, setActiveArticleId] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<HelpCategoryId | null>(null);

  // Deep-link to a specific article when requested.
  useEffect(() => {
    if (open && initialArticleId) {
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
            Search articles, get help for this page, or restart the setup wizard.
          </SheetDescription>

          {!activeArticle && (
            <div className="relative pt-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 mt-1 w-4 h-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search help articles…"
                className="pl-9"
                aria-label="Search help articles"
                autoFocus
              />
            </div>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          {/* === Article detail view === */}
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
              <div className="pt-2 border-t">
                <MiniMarkdown source={activeArticle.body} />
              </div>
              {activeArticle.routes && activeArticle.routes.length > 0 && (
                <div className="pt-3 border-t space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Jump to
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {activeArticle.routes.map((r) => (
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
            /* === Search results === */
            <section aria-label="Search results">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                {searchResults.length} result{searchResults.length === 1 ? '' : 's'}
              </p>
              {searchResults.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">
                  No articles matched "{query}". Try different keywords or browse by topic below.
                </p>
              ) : (
                <ul className="space-y-1">
                  {searchResults.map((a) => (
                    <ArticleListItem key={a.id} article={a} onOpen={openArticle} />
                  ))}
                </ul>
              )}
            </section>
          ) : activeCategory ? (
            /* === Category browse view === */
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
              {/* === Contextual help === */}
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

              {/* === Quick links === */}
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
                    onClick={() => goTo('/ai-chat')}
                  >
                    <Sparkles className="w-4 h-4 mr-2" />
                    Ask the AI Assistant
                  </Button>
                  <Button
                    variant="outline"
                    className="justify-start"
                    asChild
                  >
                    <a href="mailto:support@energyforward.com?subject=InboxIQ%20support%20request">
                      <Mail className="w-4 h-4 mr-2" />
                      Contact Support
                    </a>
                  </Button>
                </div>
              </section>

              {/* === Browse by topic === */}
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

              {/* === Video tutorials placeholder === */}
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
