/**
 * Renders a tiny subset of markdown safely as React nodes:
 * - **bold**
 * - `inline code`
 * - leading "# / ## / ###" headings
 * - "- " bullet lists and "1. " numbered lists
 * - blank lines as paragraph breaks
 *
 * This avoids pulling in a markdown library for short help articles.
 */
import { Fragment, ReactNode } from 'react';

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Split on **bold** and `code` while preserving the delimiters
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  const parts = text.split(regex);
  parts.forEach((part, i) => {
    if (!part) return;
    if (part.startsWith('**') && part.endsWith('**')) {
      nodes.push(<strong key={i}>{part.slice(2, -2)}</strong>);
    } else if (part.startsWith('`') && part.endsWith('`')) {
      nodes.push(
        <code key={i} className="px-1 py-0.5 rounded bg-muted text-[0.85em] font-mono">
          {part.slice(1, -1)}
        </code>
      );
    } else {
      nodes.push(<Fragment key={i}>{part}</Fragment>);
    }
  });
  return nodes;
}

export function MiniMarkdown({ source }: { source: string }) {
  const lines = source.split('\n');
  const blocks: ReactNode[] = [];
  let listBuffer: { ordered: boolean; items: string[] } | null = null;
  let paragraphBuffer: string[] = [];
  let key = 0;

  const flushParagraph = () => {
    if (paragraphBuffer.length) {
      blocks.push(
        <p key={`p-${key++}`} className="text-sm leading-relaxed text-foreground">
          {renderInline(paragraphBuffer.join(' '))}
        </p>
      );
      paragraphBuffer = [];
    }
  };
  const flushList = () => {
    if (listBuffer) {
      const Tag = listBuffer.ordered ? 'ol' : 'ul';
      blocks.push(
        <Tag
          key={`l-${key++}`}
          className={`text-sm leading-relaxed text-foreground space-y-1 pl-5 ${
            listBuffer.ordered ? 'list-decimal' : 'list-disc'
          }`}
        >
          {listBuffer.items.map((it, i) => (
            <li key={i}>{renderInline(it)}</li>
          ))}
        </Tag>
      );
      listBuffer = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = /^(#{1,3})\s+(.*)$/.exec(line);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const cls =
        level === 1
          ? 'text-base font-semibold text-foreground mt-2'
          : level === 2
          ? 'text-sm font-semibold text-foreground mt-2'
          : 'text-sm font-medium text-foreground mt-2';
      blocks.push(
        <p key={`h-${key++}`} className={cls}>
          {renderInline(text)}
        </p>
      );
      continue;
    }

    const ulMatch = /^[-*]\s+(.*)$/.exec(line);
    const olMatch = /^\d+\.\s+(.*)$/.exec(line);
    if (ulMatch || olMatch) {
      flushParagraph();
      const ordered = Boolean(olMatch);
      const item = (ulMatch?.[1] ?? olMatch?.[1]) as string;
      if (!listBuffer || listBuffer.ordered !== ordered) {
        flushList();
        listBuffer = { ordered, items: [] };
      }
      listBuffer.items.push(item);
      continue;
    }

    paragraphBuffer.push(line);
  }
  flushParagraph();
  flushList();

  return <div className="space-y-3">{blocks}</div>;
}
