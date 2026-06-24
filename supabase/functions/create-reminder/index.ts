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
    const action = String(body?.action || 'create');

    const {
      connection_id,
      title,
      start,
      end,
      notes = '',
      attendee_email = '',
      reminder_minutes_before_start = 15,
      location = '',
      is_online_meeting = false,
    } = body ?? {};

    if (!connection_id || !start || !end) {
      return new Response(
        JSON.stringify({ error: 'connection_id, start, end required' }),
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

    // === Availability check: returns busy events overlapping [start,end] ===
    if (action === 'availability') {
      const startIso = new Date(start).toISOString();
      const endIso = new Date(end).toISOString();
      const path =
        `/me/calendarView?startDateTime=${encodeURIComponent(startIso)}` +
        `&endDateTime=${encodeURIComponent(endIso)}` +
        `&$select=id,subject,start,end,showAs,isAllDay&$top=25&$orderby=start/dateTime`;
      const res = await callGraph<any>(userId, connection_id, 'calendar', path);
      if (!res.ok) {
        return new Response(
          JSON.stringify({ error: res.error?.message || 'availability lookup failed', code: res.error?.code }),
          { status: res.status || 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      const events = ((res.data as any)?.value || []).filter((e: any) => {
        const sa = String(e.showAs || '').toLowerCase();
        return sa !== 'free' && sa !== 'workingelsewhere';
      });
      return new Response(
        JSON.stringify({ ok: true, available: events.length === 0, conflicts: events }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (!title) {
      return new Response(
        JSON.stringify({ error: 'title required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
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

    if (location && String(location).trim()) {
      eventBody.location = { displayName: String(location).trim() };
    }

    if (is_online_meeting) {
      eventBody.isOnlineMeeting = true;
      eventBody.onlineMeetingProvider = 'teamsForBusiness';
    }

    if (attendee_email) {
      const list = Array.isArray(attendee_email) ? attendee_email : String(attendee_email).split(/[,;\s]+/).filter(Boolean);
      eventBody.attendees = list.map((addr: string) => ({
        emailAddress: { address: addr },
        type: 'required',
      }));
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

    let event: any = result.data ?? {};

    // When a Teams meeting was requested, ensure the Teams join link is
    // visible inside the event body. Microsoft Graph sometimes returns the
    // event before the onlineMeeting block is populated, and the body we
    // posted overrides the auto-injected Teams block. Re-fetch the event
    // and PATCH the body to include the join URL if it isn't already there.
    if (is_online_meeting && event.id) {
      try {
        const refetch = await callGraph<any>(
          userId,
          connection_id,
          'calendar',
          `/me/events/${event.id}?$select=id,subject,body,webLink,onlineMeeting,onlineMeetingUrl`,
        );
        if (refetch.ok && refetch.data) {
          event = { ...event, ...refetch.data };
          const joinUrl: string | undefined =
            refetch.data?.onlineMeeting?.joinUrl ?? refetch.data?.onlineMeetingUrl;
          const currentBody: string = refetch.data?.body?.content ?? '';
          if (joinUrl && !currentBody.includes(joinUrl)) {
            const notesHtml = (notes || '').replace(/\n/g, '<br/>');
            const teamsBlock = `
              <div style="font-family:Segoe UI,Arial,sans-serif;border-top:1px solid #e5e7eb;margin-top:16px;padding-top:12px;">
                <p style="margin:0 0 6px;font-size:14px;color:#0f172a;"><strong>Microsoft Teams meeting</strong></p>
                <p style="margin:0 0 4px;font-size:13px;">
                  <a href="${joinUrl}" style="color:#5b5fc7;font-weight:600;text-decoration:none;">Click here to join the meeting</a>
                </p>
                <p style="margin:0;font-size:11px;color:#64748b;">Generated by InboxIQ</p>
              </div>`;
            const newBody = `${notesHtml}${teamsBlock}`;
            await callGraph<any>(userId, connection_id, 'calendar', `/me/events/${event.id}`, {
              method: 'PATCH',
              body: JSON.stringify({
                body: { contentType: 'HTML', content: newBody },
              }),
            });
            event.onlineMeeting = { ...(event.onlineMeeting || {}), joinUrl };
          }
        }
      } catch (e) {
        console.warn('Teams join URL injection failed (non-fatal)', e);
      }
    }


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
