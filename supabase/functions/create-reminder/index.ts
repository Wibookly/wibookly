// Create a reminder: posts a Microsoft 365 calendar event AND inserts a
// daily_brief_tasks row so it shows up in the Daily Brief action items.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { callGraph } from '../_shared/graph-call.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const userId = claimsData.claims.sub as string;

    const body = await req.json().catch(() => ({}));
    const {
      connection_id,
      title,
      start,
      end,
      notes = '',
      attendee_email = '',
      reminder_minutes_before_start = 15,
    } = body ?? {};

    if (!connection_id || !title || !start || !end) {
      return new Response(
        JSON.stringify({ error: 'connection_id, title, start, end required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const { data: conn } = await supabase
      .from('provider_connections')
      .select('id, provider')
      .eq('id', connection_id)
      .eq('user_id', userId)
      .maybeSingle();
    if (!conn || conn.provider !== 'outlook') {
      return new Response(
        JSON.stringify({ error: 'Connection not found or not Outlook' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const eventBody: Record<string, unknown> = {
      subject: title,
      body: { contentType: 'HTML', content: (notes || '').replace(/\n/g, '<br/>') },
      start: { dateTime: new Date(start).toISOString().replace('Z', ''), timeZone: 'UTC' },
      end: { dateTime: new Date(end).toISOString().replace('Z', ''), timeZone: 'UTC' },
      isReminderOn: true,
      reminderMinutesBeforeStart: Number(reminder_minutes_before_start) || 15,
      categories: ['InboxIQ Reminder'],
    };

    if (attendee_email) {
      eventBody.attendees = [
        {
          emailAddress: { address: attendee_email },
          type: 'required',
        },
      ];
    }

    const result = await callGraph<any>(userId, connection_id, 'calendar', '/me/events', {
      method: 'POST',
      body: JSON.stringify(eventBody),
    });

    if (!result.ok) {
      return new Response(
        JSON.stringify({ error: result.error?.message, code: result.error?.code }),
        { status: result.status || 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const event = result.data ?? {};

    // Insert a daily_brief_tasks row tied to this event so it surfaces in
    // tomorrow's brief and is queryable. Use today's brief date.
    const today = new Date().toISOString().slice(0, 10);
    try {
      await supabase.from('daily_brief_tasks').insert({
        user_id: userId,
        connection_id,
        brief_date: today,
        source: 'reminder',
        fingerprint: `reminder:${event.id || crypto.randomUUID()}`,
        priority: 1,
        urgency: 'medium',
        title,
        action: title,
        why: notes || 'Reminder set via AI Chat',
        status: 'scheduled',
        reminder_at: new Date(start).toISOString(),
        calendar_event_id: event.id || null,
      });
    } catch (e) {
      console.warn('daily_brief_tasks insert failed', e);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        event: { id: event.id, webLink: event.webLink, start, end, title },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
