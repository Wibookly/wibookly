// ticket-updated-email: sends an email to the ticket owner when an admin posts
// a reply or status change. Triggered by SupportIssuesPanel.
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
    const APP_BASE = Deno.env.get('APP_BASE_URL') || 'https://inboxiq.energyforward.com';
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const auth = req.headers.get('Authorization') || '';
    const token = auth.replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'unauthorized' }, 401);
    const { data: userData } = await admin.auth.getUser(token);
    if (!userData?.user) return json({ error: 'unauthorized' }, 401);

    const { issue_id, reply_excerpt } = await req.json().catch(() => ({}));
    if (!issue_id) return json({ error: 'missing issue_id' }, 400);

    const { data: issue, error } = await admin
      .from('support_issues')
      .select('id, subject, user_email, status')
      .eq('id', issue_id)
      .maybeSingle();
    if (error || !issue) return json({ error: 'issue_not_found' }, 404);
    if (!issue.user_email) return json({ error: 'no_recipient' }, 400);

    const { error: sendErr } = await admin.functions.invoke('send-transactional-email', {
      body: {
        templateName: 'ticket-updated',
        recipientEmail: issue.user_email,
        idempotencyKey: `ticket-updated-${issue.id}-${Date.now()}`,
        templateData: {
          subject: issue.subject,
          status: issue.status,
          reply_excerpt: reply_excerpt || '',
          ticket_url: `${APP_BASE}/help`,
        },
      },
    });
    if (sendErr) return json({ error: sendErr.message }, 500);

    return json({ ok: true, sent_to: issue.user_email });
  } catch (e: any) {
    console.error('ticket-updated-email error', e);
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
