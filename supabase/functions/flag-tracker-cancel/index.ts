// flag-tracker-cancel: user clicks "Cancel" in the Flagged Email Tracker UI.
// We (1) clear the follow-up flag on the source message in Outlook via Graph,
// then (2) hard-delete the tracker row so it disappears from the report and
// stops any pending AI follow-up sends.
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2';
import { callGraph } from '../_shared/graph-call.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
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

    const { id } = await req.json().catch(() => ({}));
    if (!id) return json({ error: 'Missing tracker id' }, 400);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: row, error: rowErr } = await admin
      .from('tracked_emails')
      .select('id, user_id, connection_id, graph_message_id, categories:trigger_detail')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();
    if (rowErr) return json({ error: rowErr.message }, 500);
    if (!row) return json({ error: 'Not found' }, 404);

    // 1. Clear the flag in Outlook (best-effort). We also strip any
    // FollowUp / FollowUp Nd category so the ingest sweep won't re-add it.
    let flagCleared = false;
    let flagError: string | null = null;
    if (row.graph_message_id && row.connection_id) {
      // Read existing categories so we can filter ours out without wiping user labels.
      const cur = await callGraph<any>(userId, row.connection_id, 'mail',
        `/me/messages/${row.graph_message_id}?$select=categories`);
      const cleanedCategories: string[] = Array.isArray(cur.data?.categories)
        ? cur.data.categories.filter((c: string) => !/^FollowUp(?:\s*\d{1,3}d)?$/i.test(String(c || '')))
        : [];

      const patch = await callGraph<any>(userId, row.connection_id, 'mail',
        `/me/messages/${row.graph_message_id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            flag: { flagStatus: 'notFlagged' },
            categories: cleanedCategories,
          }),
        });
      if (patch.ok) flagCleared = true;
      else flagError = patch.error?.message || 'Graph PATCH failed';
    }

    // 2. Hard-delete the tracker row regardless of Graph result — the user
    // explicitly cancelled, so the row must disappear from the report and
    // the AI queue.
    const { error: delErr } = await admin.from('tracked_emails').delete().eq('id', id);
    if (delErr) return json({ error: delErr.message }, 500);

    return json({ ok: true, flag_cleared: flagCleared, flag_error: flagError });
  } catch (e: any) {
    console.error('flag-tracker-cancel error', e);
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
