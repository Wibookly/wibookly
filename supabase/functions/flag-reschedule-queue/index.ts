// flag-reschedule-queue: when a user changes their business-hours / days /
// timezone / holidays settings, shift every upcoming queued or pending
// follow-up to the next allowed send window so nothing fires during a newly
// blocked period and nothing is left stranded past a newly opened one.
//
// Auth: user-authenticated POST. No body required.
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

interface Prefs {
  businessHoursOnly: boolean;
  bhStart: number;
  bhEnd: number;
  businessDays: number[];
  timezone: string;
  holidays: string[];
}

function tzParts(date: Date, tz: string): { hour: number; day: number; ymd: string } {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false, hour: '2-digit', weekday: 'short',
      year: 'numeric', month: '2-digit', day: '2-digit',
    });
    const parts = dtf.formatToParts(date).reduce((acc: any, p) => { acc[p.type] = p.value; return acc; }, {});
    const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return {
      hour: parseInt(parts.hour, 10) || 0,
      day: dayMap[parts.weekday] ?? 1,
      ymd: `${parts.year}-${parts.month}-${parts.day}`,
    };
  } catch {
    return { hour: date.getUTCHours(), day: date.getUTCDay(), ymd: date.toISOString().slice(0, 10) };
  }
}

function isInWindow(d: Date, p: Prefs): boolean {
  if (!p.businessHoursOnly) return true;
  const { hour, day, ymd } = tzParts(d, p.timezone);
  if (p.holidays.includes(ymd)) return false;
  if (!p.businessDays.includes(day)) return false;
  return hour >= p.bhStart && hour < p.bhEnd;
}

function nextWindowStart(from: Date, p: Prefs): Date {
  if (!p.businessHoursOnly) return from;
  let cur = new Date(from.getTime());
  for (let i = 0; i < 14 * 48; i++) {
    if (isInWindow(cur, p)) return cur;
    cur = new Date(cur.getTime() + 30 * 60_000);
  }
  return new Date(from.getTime() + 24 * 3600_000);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: claims } = await supabase.auth.getClaims(authHeader.replace('Bearer ', ''));
  const userId = claims?.claims?.sub as string | undefined;
  if (!userId) return json({ error: 'Unauthorized' }, 401);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: settingsRows } = await admin
    .from('follow_up_settings')
    .select('is_enabled, business_hours_only, business_hours_start, business_hours_end, business_days, timezone, holidays, updated_at, created_at')
    .eq('user_id', userId)
    .order('is_enabled', { ascending: false })
    .order('updated_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1);
  const s = settingsRows?.[0];
  if (!s) return json({ ok: true, rescheduled: 0, reason: 'no_settings' });

  const prefs: Prefs = {
    businessHoursOnly: !!s.business_hours_only,
    bhStart: typeof s.business_hours_start === 'number' ? s.business_hours_start : 8,
    bhEnd: typeof s.business_hours_end === 'number' ? s.business_hours_end : 17,
    businessDays: Array.isArray(s.business_days) ? s.business_days : [1, 2, 3, 4, 5],
    timezone: s.timezone || 'America/New_York',
    holidays: Array.isArray(s.holidays) ? s.holidays : [],
  };

  const now = new Date();
  const { data: rows } = await admin
    .from('tracked_emails')
    .select('id, status, scheduled_send_at, follow_up_at, queued_reason')
    .eq('user_id', userId)
    .in('status', ['queued', 'pending', 'drafted']);

  let rescheduled = 0;
  let alreadyOk = 0;

  for (const r of (rows || []) as any[]) {
    const updates: Record<string, any> = {};

    // 1) Queued sends (have a scheduled_send_at) — re-anchor to next allowed slot.
    if (r.status === 'queued' && r.scheduled_send_at) {
      const target = new Date(r.scheduled_send_at);
      const anchor = target.getTime() > now.getTime() ? target : now;
      const next = nextWindowStart(anchor, prefs);
      if (next.getTime() !== target.getTime()) {
        updates.scheduled_send_at = next.toISOString();
        updates.queued_reason = prefs.businessHoursOnly ? 'outside_business_hours' : null;
      }
    }

    // 2) Pending rows whose follow_up_at falls in a now-blocked slot — push to
    //    the next allowed slot so the cron picks them up at the right time.
    if (r.status === 'pending' && r.follow_up_at && prefs.businessHoursOnly) {
      const target = new Date(r.follow_up_at);
      if (target.getTime() > now.getTime() && !isInWindow(target, prefs)) {
        const next = nextWindowStart(target, prefs);
        if (next.getTime() !== target.getTime()) {
          updates.follow_up_at = next.toISOString();
        }
      }
    }

    if (Object.keys(updates).length) {
      updates.last_checked_at = now.toISOString();
      const { error } = await admin.from('tracked_emails').update(updates).eq('id', r.id);
      if (!error) rescheduled++;
    } else {
      alreadyOk++;
    }
  }

  return json({ ok: true, rescheduled, already_ok: alreadyOk, prefs });
});
