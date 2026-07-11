import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { BRIEF_CSS, fmtTime, relTime, ageDays } from './helm/briefStyle';

/* --- shape a helm_items row into the card shape this page renders --- */
function mapHelmItem(row: any) {
  const payload = row.payload || {};
  const score = Number(row.score) || 0;
  const bucket = score >= 75 ? 'now' : score >= 40 ? 'today' : 'later';
  const received = payload.receivedDateTime || row.created_at;
  const preview = (payload.bodyPreview || row.context || '').toString();
  const draft = row.ai_draft || '';
  const reasons: string[] = [];
  if (payload.isDirect) reasons.push('Direct to you');
  if (payload.importance === 'high') reasons.push('Marked important');
  if (payload.flagStatus === 'flagged') reasons.push('Flagged');
  if (row.is_external) reasons.push('External sender');
  if (row.tier === 'overdue') reasons.push('Overdue');
  if (draft) reasons.push('Draft ready');
  if (reasons.length === 0) reasons.push(row.tier || 'Open');

  return {
    id: row.id,
    bucket,
    score: Math.round(score),
    from: row.sender_name || row.sender_email || 'Unknown sender',
    channel: `Email · ${relTime(received)}`,
    title: row.title || '(no subject)',
    why: preview ? preview.replace(/\s+/g, ' ').slice(0, 200) : 'Open email on your Helm.',
    reasons,
    prepared: !!draft,
  };
}

const Ic = {
  mail: (
    <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  ),
};
const bucketLabel = { now: 'Now', today: 'Today', later: 'Later' } as const;

export default function TheHelm() {
  const { user } = useAuth();
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [items, setItems] = useState<any[]>([]);
  const [waiting, setWaiting] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState(new Date());
  const [clock, setClock] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [helmRes, waitRes] = await Promise.all([
        supabase
          .from('helm_items')
          .select('id,source,tier,score,title,context,sender_name,sender_email,is_external,ai_draft,payload,created_at,status')
          .eq('user_id', user.id)
          .eq('status', 'open')
          .eq('source', 'email')
          .order('score', { ascending: false })
          .limit(40),
        supabase
          .from('follow_up_trackers')
          .select('id,subject,to_recipients,sent_at,due_at,status,replied_at')
          .eq('user_id', user.id)
          .is('replied_at', null)
          .not('status', 'in', '(completed,cancelled,replied)')
          .order('sent_at', { ascending: true })
          .limit(12),
      ]);
      if (cancelled) return;
      setItems((helmRes.data || []).map(mapHelmItem));
      setWaiting(
        (waitRes.data || []).map((r: any) => {
          const to = Array.isArray(r.to_recipients) ? (r.to_recipients as any[]) : [];
          const first: any = to[0] || {};
          const who = first.name || first?.emailAddress?.name || first?.emailAddress?.address || first.address || 'Recipient';
          return { who, what: r.subject || '(no subject)', age: ageDays(r.sent_at) };
        }),
      );
      setRefreshedAt(new Date());
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const sorted = useMemo(() => items.slice().sort((a, b) => b.score - a.score), [items]);
  const visible = showAll ? sorted : sorted.slice(0, 8);
  const hidden = Math.max(0, sorted.length - 8);
  const nowCount = sorted.filter((i) => i.bucket === 'now').length;
  const preparedCount = sorted.filter((i) => i.prepared).length;
  const topPrepared = sorted.find((i) => i.prepared && i.bucket === 'now');
  const greetWord = clock.getHours() < 12 ? 'Good morning' : clock.getHours() < 18 ? 'Good afternoon' : 'Good evening';
  const firstName = ((user?.user_metadata as any)?.full_name || user?.email || 'there').toString().split(/[\s@]/)[0];

  return (
    <>
      <style>{BRIEF_CSS}</style>
      <div className="helm" data-theme={theme}>
        <div className="wrap">
          <div className="bridge">
            <div>
              <div className="greeting display">
                {greetWord}, <span className="accent">{firstName}</span>
              </div>
              <div className="datemeta">
                {clock.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })} · {fmtTime(clock)} · The Helm › Emails
              </div>
              <div className="state">
                <b>{nowCount} email{nowCount === 1 ? '' : 's'}</b> need you now.
                {preparedCount > 0 && <> <b>{preparedCount}</b> already have a draft ready.</>}
                {waiting.length > 0 && <> <b>{waiting.length} thread{waiting.length === 1 ? '' : 's'}</b> waiting on your reply.</>}
              </div>
            </div>
            <div className="controls">
              <span className="pill">
                <span className="dot" />
                {loading ? 'Loading…' : `Inbox updated ${relTime(refreshedAt.toISOString())}`}
              </span>
              <button className="pill" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}>
                {theme === 'dark' ? '☾ Dark' : '☀ Light'}
              </button>
            </div>
          </div>

          <div className="grid">
            <div>
              <div className="panel brief">
                <div className="eyebrow">Inbox brief</div>
                <div className="brief-body">
                  {loading ? (
                    <span className="soft">Reading your inbox…</span>
                  ) : sorted.length === 0 ? (
                    <span className="soft">Inbox is clear. Nothing on the Helm right now.</span>
                  ) : topPrepared ? (
                    <>
                      <span className="hl">
                        {topPrepared.from} needs you on "{topPrepared.title}"
                      </span>{' '}
                      — I've drafted your reply, tap it to review.
                    </>
                  ) : (
                    <>
                      Top of your queue: <span className="hl">{sorted[0].title}</span> from {sorted[0].from}.
                    </>
                  )}
                </div>
              </div>

              <div className="panel">
                <div className="eyebrow">
                  Needs you <span className="count">{sorted.length} open</span>
                </div>
                {loading && <div className="why" style={{ padding: 12 }}>Loading your inbox…</div>}
                {!loading && sorted.length === 0 && <div className="why" style={{ padding: 12 }}>No open emails. You're clear.</div>}
                {visible.map((it) => (
                  <div key={it.id} className={`card ${it.bucket}`}>
                    <div className="card-top">
                      <span className="chip email">
                        {Ic.mail}
                        Email
                      </span>
                      {it.prepared && <span className="prepared">✦ Draft ready</span>}
                      <span className="bucket-tag">{bucketLabel[it.bucket as 'now' | 'today' | 'later']}</span>
                    </div>
                    <div className="from">
                      <b>{it.from}</b> · {it.channel}
                    </div>
                    <div className="title">{it.title}</div>
                    <div className="why">{it.why}</div>
                    <div className="reasons">
                      {it.reasons.map((r: string) => (
                        <span key={r} className="reason">
                          {r}
                        </span>
                      ))}
                    </div>
                    <div className="meter-row">
                      <div className="meter">
                        <i style={{ width: `${it.score}%` }} />
                      </div>
                      <span className="score">{it.score}</span>
                    </div>
                  </div>
                ))}
                {!showAll && hidden > 0 && (
                  <button className="showmore" onClick={() => setShowAll(true)}>
                    Show {hidden} more · open full queue
                  </button>
                )}
              </div>
            </div>

            <div>
              <div className="panel">
                <div className="eyebrow">
                  Waiting on reply <span className="count">{waiting.length}</span>
                </div>
                <div style={{ marginTop: 10 }}>
                  {waiting.length === 0 && !loading && <div className="why">Nothing pending your reply.</div>}
                  {waiting.map((w, i) => (
                    <div className="wait" key={i}>
                      <div>
                        <div className="wait-who">{w.who}</div>
                        <div className="wait-what">{w.what}</div>
                      </div>
                      <span className="age">{w.age}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
