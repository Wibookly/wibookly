import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { X, CheckCircle, FileText, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  sessionId: string;
  title: string;
  onClose: () => void;
}

interface Transcript { id: string; speaker: string; text: string; spoken_at: string; }
interface ActionItem { id: string; description: string; assigned_to: string | null; completed: boolean; }
interface Suggestion { id: string; content: string; suggestion_type: string | null; }

const groupTranscript = (items: Transcript[]) => items.reduce<Transcript[]>((acc, item) => {
  const speaker = item.speaker || 'Speaker';
  const text = item.text.replace(/\s+/g, ' ').trim();
  if (!text) return acc;
  const last = acc[acc.length - 1];
  if (last && last.speaker === speaker) {
    last.text = `${last.text} ${text}`.replace(/\s+/g, ' ').trim();
    last.spoken_at = item.spoken_at;
    return acc;
  }
  acc.push({ ...item, speaker, text });
  return acc;
}, []);

export default function SessionDetailDialog({ sessionId, title, onClose }: Props) {
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [tab, setTab] = useState<'actions' | 'transcript' | 'suggestions'>('actions');
  const groupedTranscript = groupTranscript(transcripts);

  useEffect(() => {
    (async () => {
      const [{ data: t }, { data: a }, { data: s }] = await Promise.all([
        supabase.from('meeting_transcripts').select('id, speaker, text, spoken_at')
          .eq('session_id', sessionId).order('spoken_at', { ascending: true }),
        supabase.from('meeting_action_items').select('id, description, assigned_to, completed')
          .eq('session_id', sessionId).order('created_at', { ascending: true }),
        supabase.from('meeting_suggestions').select('id, content, suggestion_type')
          .eq('session_id', sessionId).order('generated_at', { ascending: true }),
      ]);
      setTranscripts((t || []) as Transcript[]);
      setActions((a || []) as ActionItem[]);
      setSuggestions((s || []) as Suggestion[]);
    })();
  }, [sessionId]);

  const toggleAction = async (id: string, next: boolean) => {
    setActions((cur) => cur.map((x) => x.id === id ? { ...x, completed: next } : x));
    await supabase.from('meeting_action_items').update({ completed: next }).eq('id', id);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <header className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="min-w-0">
            <div className="text-overline" style={{ color: 'var(--text-2)' }}>SESSION SUMMARY</div>
            <h3 className="text-h5 truncate" style={{ color: 'var(--text-1)' }}>{title}</h3>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:opacity-80" style={{ color: 'var(--text-2)' }}>
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="flex gap-1 px-4 pt-4">
          {[
            { id: 'actions', label: `Action Items (${actions.length})`, Icon: CheckCircle },
            { id: 'transcript', label: `Transcript (${transcripts.length})`, Icon: FileText },
            { id: 'suggestions', label: `Suggestions (${suggestions.length})`, Icon: Sparkles },
          ].map((t) => (
            <button key={t.id} onClick={() => setTab(t.id as any)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors"
              style={{
                background: tab === t.id ? 'color-mix(in srgb, var(--c-purple) 14%, transparent)' : 'transparent',
                color: tab === t.id ? 'var(--c-purple)' : 'var(--text-2)',
              }}>
              <t.Icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {tab === 'actions' && (
            <div className="space-y-2">
              {actions.length === 0 && <Empty>No action items captured.</Empty>}
              {actions.map((a) => (
                <label key={a.id} className="flex items-start gap-3 rounded-xl p-3 cursor-pointer"
                  style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                  <input type="checkbox" checked={a.completed} onChange={(e) => toggleAction(a.id, e.target.checked)}
                    className="mt-0.5" />
                  <div className="flex-1">
                    <div className="text-sm" style={{ color: 'var(--text-1)', textDecoration: a.completed ? 'line-through' : 'none' }}>
                      {a.description}
                    </div>
                    {a.assigned_to && (
                      <div className="text-xs mt-1" style={{ color: 'var(--text-2)' }}>Owner: {a.assigned_to}</div>
                    )}
                  </div>
                </label>
              ))}
            </div>
          )}

          {tab === 'transcript' && (
            <div className="space-y-3">
              {groupedTranscript.length === 0 && <Empty>No transcript saved for this session.</Empty>}
              {groupedTranscript.map((t) => (
                <div key={t.id} className="rounded-xl p-3" style={{ background: 'var(--surface-2)' }}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold" style={{ color: 'var(--c-purple)' }}>● {t.speaker}</span>
                    <span className="text-xs" style={{ color: 'var(--text-2)' }}>
                      {new Date(t.spoken_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--text-1)' }}>{t.text}</p>
                </div>
              ))}
            </div>
          )}

          {tab === 'suggestions' && (
            <div className="space-y-3">
              {suggestions.length === 0 && <Empty>No live suggestions were generated.</Empty>}
              {suggestions.map((s) => (
                <div key={s.id} className="rounded-xl p-4"
                  style={{
                    background: 'linear-gradient(135deg, color-mix(in srgb, var(--c-purple) 16%, transparent), color-mix(in srgb, var(--c-cyan) 10%, transparent))',
                    border: '1px solid color-mix(in srgb, var(--c-purple) 30%, transparent)',
                  }}>
                  {s.suggestion_type && (
                    <span className="text-xs font-bold px-2 py-0.5 rounded-md mr-2"
                      style={{ background: 'var(--c-purple)', color: '#fff' }}>
                      {s.suggestion_type.toUpperCase()}
                    </span>
                  )}
                  <p className="text-sm leading-relaxed mt-2" style={{ color: 'var(--text-1)' }}>{s.content}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <footer className="px-6 py-3 border-t flex justify-end" style={{ borderColor: 'var(--border)' }}>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </footer>
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl p-6 text-sm text-center" style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}>
      {children}
    </div>
  );
}
