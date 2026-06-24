// Fetch Outlook calendar events for the caller's connection across a time window.
// Used by the Daily Brief CalendarPanel (Today / Week / Month).
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
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const userId = claimsData.claims.sub as string;

    const body = await req.json().catch(() => ({}));
    const { connection_id, start, end } = body ?? {};
    if (!connection_id || !start || !end) {
      return new Response(
        JSON.stringify({ error: 'connection_id, start, end required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Verify connection ownership
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

    const path =
      `/me/calendarview?startDateTime=${encodeURIComponent(start)}` +
      `&endDateTime=${encodeURIComponent(end)}` +
      `&$select=id,subject,bodyPreview,start,end,location,organizer,attendees,isOnlineMeeting,onlineMeeting,webLink,isAllDay,showAs` +
      `&$orderby=start/dateTime&$top=200`;

    const result = await callGraph<{ value: any[] }>(
      userId,
      connection_id,
      'calendar',
      path,
      { headers: { Prefer: 'outlook.timezone="UTC"' } },
    );

    if (!result.ok) {
      return new Response(JSON.stringify({ error: result.error?.message, code: result.error?.code }), {
        status: result.status || 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const events = (result.data?.value ?? []).map((e: any) => ({
      id: e.id,
      subject: e.subject || '(No subject)',
      preview: e.bodyPreview || '',
      start: e.start?.dateTime ? `${e.start.dateTime}Z` : null,
      end: e.end?.dateTime ? `${e.end.dateTime}Z` : null,
      location: e.location?.displayName || '',
      organizer: e.organizer?.emailAddress?.name || e.organizer?.emailAddress?.address || '',
      attendeeCount: Array.isArray(e.attendees) ? e.attendees.length : 0,
      isOnlineMeeting: !!e.isOnlineMeeting,
      joinUrl: e.onlineMeeting?.joinUrl || '',
      webLink: e.webLink || '',
      isAllDay: !!e.isAllDay,
      showAs: e.showAs || 'busy',
    }));

    return new Response(JSON.stringify({ events }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
