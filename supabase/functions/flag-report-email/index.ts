// flag-report-email: build a Flagged Email Report for the calling user across
// a date range and send it to their account email via send-transactional-email.
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
    const { from, to, recipient_override, range_label } = body || {};

    let q = admin.from('tracked_emails').select('*').eq('user_id', user.id).order('sent_at', { ascending: false }).limit(500);
    if (from) q = q.gte('sent_at', new Date(from).toISOString());
    if (to) q = q.lte('sent_at', new Date(to).toISOString());
    const { data: rows, error } = await q;
    if (error) return json({ error: error.message }, 500);

    const now = Date.now();
    const stats = {
      total: rows?.length || 0,
      pending: rows?.filter((r: any) => r.status === 'pending').length || 0,
      replied: rows?.filter((r: any) => r.status === 'replied').length || 0,
      followUpsSent: rows?.reduce((s: number, r: any) => s + (r.attempts || 0), 0) || 0,
      missed: rows?.filter((r: any) =>
        r.status === 'exhausted' || (r.status === 'pending' && new Date(r.follow_up_at).getTime() < now)
      ).length || 0,
    };

    const buildSchedule = (r: any) => {
      const hist = Array.isArray(r.follow_up_history) ? r.follow_up_history : [];
      const out: { label: string; status: string; date: string | null }[] = [];
      for (let i = 1; i <= 3; i++) {
        const h = hist[i - 1];
        if (h?.sent_at) out.push({ label: `Follow-up ${i}`, status: 'Sent', date: h.sent_at });
        else if (i === (r.attempts || 0) + 1 && r.status === 'pending') {
          out.push({ label: `Follow-up ${i}`, status: 'Scheduled', date: r.follow_up_at });
        } else if (i <= (r.attempts || 0)) {
          out.push({ label: `Follow-up ${i}`, status: 'Sent', date: h?.sent_at || null });
        } else {
          out.push({ label: `Follow-up ${i}`, status: 'Pending', date: null });
        }
      }
      return out;
    };

    const reportRows = (rows || []).map((r: any) => ({
      subject: r.subject || '(no subject)',
      recipient_name: r.recipient_name || '',
      recipient_address: r.recipient_address || '',
      sent_at: r.sent_at,
      flag_due: r.trigger_type === 'flag' ? (r.trigger_detail?.dueDateTime || r.follow_up_at) : r.follow_up_at,
      follow_up_schedule: buildSchedule(r),
      status: r.status,
    }));

    const recipientEmail = recipient_override || user.email;
    if (!recipientEmail) return json({ error: 'no_recipient' }, 400);

    const { error: sendErr } = await admin.functions.invoke('send-transactional-email', {
      body: {
        templateName: 'flagged-email-report',
        recipientEmail,
        idempotencyKey: `flag-report-${user.id}-${Date.now()}`,
        templateData: {
          range_label: range_label || 'all time',
          generated_at: new Date().toISOString(),
          stats,
          rows: reportRows,
        },
      },
    });
    if (sendErr) return json({ error: sendErr.message }, 500);

    return json({ ok: true, sent_to: recipientEmail, row_count: reportRows.length });
  } catch (e: any) {
    console.error('flag-report-email error', e);
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
