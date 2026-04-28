/**
 * Builds a compact knowledge string from HELP_ARTICLES so the chatbot
 * can ground answers without us duplicating content. Sent on every
 * request — keeps the edge function stateless and the source of truth
 * fully editable in `help-content.ts`.
 */
import {
  HELP_ARTICLES,
  HELP_CATEGORIES,
  ROUTE_HELP_MAP,
} from '@/config/help-content';

export function buildHelpKnowledge(): string {
  const byCategory = new Map<string, typeof HELP_ARTICLES>();
  for (const a of HELP_ARTICLES) {
    const list = byCategory.get(a.category) ?? [];
    list.push(a);
    byCategory.set(a.category, list);
  }

  const sections: string[] = [];
  for (const cat of HELP_CATEGORIES) {
    const items = byCategory.get(cat.id) ?? [];
    if (items.length === 0) continue;
    sections.push(`## ${cat.label}\n${cat.description}`);
    for (const a of items) {
      const stepsText = (a.steps || [])
        .map((s) => `- ${s.title}: ${s.description}`)
        .join('\n');
      const parts = [
        `### ${a.title}`,
        a.summary,
        a.intro || '',
        stepsText,
        a.body || '',
        a.outro || '',
      ].filter(Boolean);
      sections.push(parts.join('\n\n'));
    }
  }
  return sections.join('\n\n');
}

export function describePageContext(pathname: string): string {
  const ids = (Object.keys(ROUTE_HELP_MAP) as string[])
    .filter((r) => pathname === r || pathname.startsWith(`${r}/`))
    .sort((a, b) => b.length - a.length);
  const route = ids[0] ?? pathname;
  return `route ${route}`;
}
