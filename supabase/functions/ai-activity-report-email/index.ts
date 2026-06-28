// ai-activity-report-email: build an AI Activity Report for the calling user
// across a date range and email it to their account email.
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const auth = req.headers.get('Authorization') || '';
    const token = auth.replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'unauthorized' }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: userData } = await admin.auth.getUser(token);
    const user = userData?.user;
    if (!user) return json({ error: 'unauthorized' }, 401);

    const body = await req.json().catch(() => ({}));
    const { from, to, range_label, recipient_override } = body || {};

    const startIso = from ? new Date(from).toISOString() : new Date(Date.now() - 30 * 86400_000).toISOString();
    const endIso = to ? new Date(`${to}T23:59:59`).toISOString() : new Date().toISOString();

    // Resolve org for this user.
    const { data: profile } = await admin
      .from('user_profiles')
      .select('organization_id')
      .eq('id', user.id)
      .maybeSingle();

    const orgId = profile?.organization_id;

    const [activityRes, chatMsgRes, chatConvRes, meetingsRes] = await Promise.all([
      admin.from('ai_activity_logs').select('*').eq('user_id', user.id)
        .eq('organization_id', orgId)
        .gte('created_at', startIso).lte('created_at', endIso),
      admin.from('chat_messages').select('id', { count: 'exact', head: true })
        .eq('user_id', user.id).eq('role', 'user')
        .gte('created_at', startIso).lte('created_at', endIso),
      admin.from('chat_conversations').select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .gte('created_at', startIso).lte('created_at', endIso),
      admin.from('meeting_sessions').select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .gte('started_at', startIso).lte('started_at', endIso),
    ]);

    const logs: any[] = activityRes.data || [];
    const stats = {
      totalDrafts: logs.filter((l) => l.activity_type === 'draft').length,
      totalAutoReplies: logs.filter((l) => l.activity_type === 'auto_reply').length,
      totalScheduledEvents: logs.filter((l) => l.activity_type === 'scheduled_event').length,
      totalEmails: logs.length,
      totalChatMessages: chatMsgRes.count || 0,
      totalChatConversations: chatConvRes.count || 0,
      totalMeetings: meetingsRes.count || 0,
    };

    const categoryMap = new Map<string, { drafts: number; autoReplies: number }>();
    for (const log of logs) {
      const cur = categoryMap.get(log.category_name) || { drafts: 0, autoReplies: 0 };
      if (log.activity_type === 'draft') cur.drafts++;
      else if (log.activity_type === 'auto_reply') cur.autoReplies++;
      categoryMap.set(log.category_name, cur);
    }
    const categories = Array.from(categoryMap.entries())
      .map(([categoryName, v]) => ({ categoryName, ...v }))
      .sort((a, b) => (b.drafts + b.autoReplies) - (a.drafts + a.autoReplies));

    const recipientEmail = recipient_override || user.email;
    if (!recipientEmail) return json({ error: 'no_recipient' }, 400);

    const { error: sendErr } = await admin.functions.invoke('send-transactional-email', {
      body: {
        templateName: 'ai-activity-report',
        recipientEmail,
        idempotencyKey: `ai-activity-report-${user.id}-${Date.now()}`,
        templateData: {
          range_label: range_label || 'all time',
          generated_at: new Date().toISOString(),
          stats,
          categories,
        },
      },
    });
    if (sendErr) return json({ error: sendErr.message }, 500);

    return json({ ok: true, sent_to: recipientEmail });
  } catch (e: any) {
    console.error('ai-activity-report-email error', e);
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
