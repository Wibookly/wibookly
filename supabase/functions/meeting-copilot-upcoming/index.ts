// Fetches the user's upcoming meetings from Microsoft Graph for the Meeting Copilot page.
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { getValidAccessToken } from '../_shared/oauth-tokens.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function detectPlatform(joinUrl?: string): string {
  if (!joinUrl) return 'other';
  if (joinUrl.includes('teams.microsoft.com')) return 'teams';
  if (joinUrl.includes('zoom.us')) return 'zoom';
  if (joinUrl.includes('meet.google.com')) return 'meet';
  if (joinUrl.includes('webex.com')) return 'webex';
  return 'other';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await sb.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const token = await getValidAccessToken(user.id, 'outlook');
    if (!token) {
      return new Response(JSON.stringify({ meetings: [], error: 'no_outlook_connection' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));
    const requestedTimezone = typeof body?.timezone === 'string' && body.timezone.trim()
      ? body.timezone.trim()
      : 'UTC';

    const start = new Date().toISOString();
    const end = new Date(Date.now() + 7 * 86400000).toISOString();
    const url = `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${start}&endDateTime=${end}&$select=id,subject,start,end,attendees,onlineMeeting,location&$orderby=start/dateTime&$top=25`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Prefer: `outlook.timezone="${requestedTimezone}"` },
    });

    if (!res.ok) {
      const text = await res.text();
      return new Response(JSON.stringify({ meetings: [], error: 'graph_error', detail: text.slice(0, 300) }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const data = await res.json();

    // Load per-meeting preferences
    const { data: prefs } = await sb
      .from('meeting_copilot_preferences')
      .select('meeting_external_id, copilot_enabled')
      .eq('user_id', user.id);
    const prefMap = new Map((prefs || []).map((p: any) => [p.meeting_external_id, p.copilot_enabled]));

    const now = Date.now();
    const meetings = (data.value || []).map((ev: any) => {
      const startMs = new Date(ev.start.dateTime).getTime();
      const endMs = new Date(ev.end.dateTime).getTime();
      const isLive = now >= startMs && now <= endMs;
      const minutes = Math.round((endMs - startMs) / 60000);
      return {
        id: ev.id,
        title: ev.subject || '(no title)',
        startTime: ev.start.dateTime,
        endTime: ev.end.dateTime,
        isLive,
        attendeeCount: ev.attendees?.length || 0,
        attendees: (ev.attendees || []).map((a: any) => a.emailAddress?.address).filter(Boolean),
        joinUrl: ev.onlineMeeting?.joinUrl || null,
        platform: detectPlatform(ev.onlineMeeting?.joinUrl),
        durationMin: minutes,
        copilotEnabled: prefMap.has(ev.id) ? prefMap.get(ev.id) : true,
      };
    });

    return new Response(JSON.stringify({ meetings }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ meetings: [], error: e?.message || 'unknown' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
