import { useState } from 'react';
import { useDailyDigest } from '@/hooks/useDailyDigest';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

function todayLocalISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// tiny, dependency-free markdown renderer for headings, paragraphs, lists
function renderMarkdown(md: string): JSX.Element[] {
  const lines = md.split('\n');
  const out: JSX.Element[] = [];
  let list: string[] = [];
  const flushList = () => {
    if (!list.length) return;
    out.push(<ul key={out.length} className="list-disc pl-6 space-y-1 text-foreground/90">{list.map((li, i) => <li key={i}>{li}</li>)}</ul>);
    list = [];
  };
  lines.forEach((line) => {
    if (/^#\s/.test(line)) { flushList(); out.push(<h1 key={out.length} className="text-2xl font-serif mt-4">{line.replace(/^#\s/, '')}</h1>); }
    else if (/^##\s/.test(line)) { flushList(); out.push(<h2 key={out.length} className="text-xl font-medium mt-3">{line.replace(/^##\s/, '')}</h2>); }
    else if (/^###\s/.test(line)) { flushList(); out.push(<h3 key={out.length} className="text-[11px] font-semibold tracking-[0.14em] uppercase text-muted-foreground mt-3">{line.replace(/^###\s/, '')}</h3>); }
    else if (/^[-*]\s/.test(line)) { list.push(line.replace(/^[-*]\s/, '')); }
    else if (line.trim() === '') { flushList(); }
    else { flushList(); out.push(<p key={out.length} className="text-foreground/90 leading-relaxed">{line}</p>); }
  });
  flushList();
  return out;
}

export default function Brief() {
  const [date, setDate] = useState<string>(todayLocalISO());
  const { data, isLoading } = useDailyDigest(date);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-4">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm"><Link to="/home"><ArrowLeft className="h-4 w-4 mr-1" /> Home</Link></Button>
        <div className="flex-1" />
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-auto" />
      </div>

      <h1 className="text-3xl font-serif">Daily brief</h1>
      <div className="text-xs tracking-[0.14em] uppercase text-muted-foreground">
        {new Date(date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
      </div>

      <Card className="p-6 space-y-3">
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : !data ? (
          <p className="text-muted-foreground">No brief generated for this day yet.</p>
        ) : data.full_brief_md ? (
          <div className="space-y-2">{renderMarkdown(data.full_brief_md)}</div>
        ) : (
          <>
            <h2 className="text-xl font-medium">{data.headline}</h2>
            {data.subline && <p className="text-muted-foreground">{data.subline}</p>}
            {data.narrative && <p className="pt-2 text-foreground/90 leading-relaxed font-serif italic">{data.narrative}</p>}
          </>
        )}
      </Card>
    </div>
  );
}
