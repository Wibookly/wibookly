import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { BRIEF_CSS, fmtTime, relTime } from './helm/briefStyle';

const Ic = {
  cal: (
    <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M8 2v4M16 2v4M3 10h18" />
    </svg>
  ),
};

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function fmtDur(a?: string, b?: string) {
  if (!a || !b) return '';
  const m = Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

export default function TheHelmCalendar() {
  const { user } = useAuth();
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [clock, setClock] = useState(new Date());
  const [rangeDays, setRangeDays] = useState<1 | 3 | 7>(3);
  const [refreshedAt, setRefreshedAt] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const start = startOfDay(new Date());
      const end = new Date(addDays(start, rangeDays));
      end.setHours(23, 59, 59, 999);
      const { data } = await supabase.functions.invoke('calendar-events', {
        body: { start_date: start.toISOString(), end_date: end.toISOString() },
      });
      if (cancelled) return;
      setEvents((data?.events || []) as any[]);
      setRefreshedAt(new Date());
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, rangeDays]);

  const grouped = useMemo(() => {
    const now = Date.now();
    const map = new Map<string, any[]>();
    events.forEach((e) => {
      const s = e.start?.dateTime || e.start;
      if (!s) return;
      const d = new Date(s);
      const key = d.toDateString();
      if (!map.has(key)) map.set(key, []);
      const en = e.end?.dateTime || e.end;
      const startMs = new Date(s).getTime();
      const endMs = en ? new Date(en).getTime() : 0;
      const live = startMs <= now && endMs >= now;
      const attendees = e.attendees || [];
      map.get(key)!.push({
        time: fmtTime(d),
        duration: fmtDur(s, en),
        label: e.subject || e.title || '(untitled)',
        organizer: e.organizer?.emailAddress?.name || e.organizer?.name || '',
        attendeeCount: attendees.length,
        live,
        flag: !e.body && attendees.length > 1 ? 'No agenda' : undefined,
        startMs,
      });
    });
    const days: { key: string; date: Date; items: any[] }[] = [];
    for (let i = 0; i < rangeDays; i++) {
      const d = addDays(new Date(), i);
      const key = d.toDateString();
      const items = (map.get(key) || []).sort((a, b) => a.startMs - b.startMs);
      days.push({ key, date: d, items });
    }
    return days;
  }, [events, rangeDays]);

  const todayCount = grouped[0]?.items.length ?? 0;
  const noAgenda = grouped.flatMap((d) => d.items).filter((i) => i.flag).length;
  const nextUp = grouped.flatMap((d) => d.items).find((i) => i.startMs >= Date.now());
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
                {clock.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })} · {fmtTime(clock)} · The Helm › Calendar
              </div>
              <div className="state">
                <b>{todayCount} meeting{todayCount === 1 ? '' : 's'}</b> today
                {noAgenda > 0 && <>, <b>{noAgenda}</b> without an agenda</>}.
                {nextUp && <> Next up: <b>{nextUp.label}</b> at {nextUp.time}.</>}
              </div>
            </div>
            <div className="controls">
              <span className="week-nav">
                {[1, 3, 7].map((n) => (
                  <button
                    key={n}
                    className="pill"
                    style={rangeDays === n ? { borderColor: 'var(--accent)', color: 'var(--text)' } : undefined}
                    onClick={() => setRangeDays(n as 1 | 3 | 7)}
                  >
                    {n === 1 ? 'Today' : `${n} days`}
                  </button>
                ))}
              </span>
              <span className="pill">
                <span className="dot" />
                {loading ? 'Loading…' : `Calendar updated ${relTime(refreshedAt.toISOString())}`}
              </span>
              <button className="pill" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}>
                {theme === 'dark' ? '☾ Dark' : '☀ Light'}
              </button>
            </div>
          </div>

          <div className="grid single">
            <div className="panel">
              <div className="eyebrow">
                Schedule <span className="count">{events.length} events</span>
              </div>

              {loading && <div className="why" style={{ padding: 12 }}>Loading calendar…</div>}
              {!loading && events.length === 0 && (
                <div className="why" style={{ padding: 12 }}>No meetings in this range. Enjoy the space.</div>
              )}

              {grouped.map((day) => (
                <div key={day.key}>
                  <div className="day-head">
                    <div className="day-title">
                      {day.date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}
                    </div>
                    <div className="day-sub">
                      {day.items.length === 0 ? 'clear' : `${day.items.length} event${day.items.length === 1 ? '' : 's'}`}
                    </div>
                  </div>
                  <div className="timeline">
                    {day.items.length === 0 && <div className="why" style={{ padding: 6 }}>—</div>}
                    {day.items.map((s, i) => (
                      <div className="tl" key={i}>
                        <span className={`tl-time ${s.live ? 'live' : ''}`}>{s.time}</span>
                        <span className={`tl-mark ${s.live ? 'live' : ''}`} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="tl-label">
                            <span className="chip meeting" style={{ marginRight: 8 }}>
                              {Ic.cal}Meeting
                            </span>
                            {s.label}
                          </div>
                          <div className="tl-meta">
                            {s.duration}
                            {s.organizer && <> · {s.organizer}</>}
                            {s.attendeeCount > 0 && <> · {s.attendeeCount} attendee{s.attendeeCount === 1 ? '' : 's'}</>}
                          </div>
                          {s.flag && <div className="tl-flag">⚑ {s.flag}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
