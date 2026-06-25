// graph-preflight: runs Microsoft Graph self-diagnostic probes for the calling user.
// Probes never send emails and always clean up any test artifacts they create.
// Writes one row per probe to public.graph_health and returns the results.
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2';
import { callGraph } from '../_shared/graph-call.ts';
import { getValidAccessToken } from '../_shared/oauth-tokens.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const REQUIRED_SCOPES = ['Mail.Read', 'Mail.ReadWrite', 'offline_access'];

function decodeJwtPayload(token: string): any | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const padded = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    return JSON.parse(atob(padded));
  } catch { return null; }
}

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
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: claims } = await supabase.auth.getClaims(authHeader.replace('Bearer ', ''));
    const userId = claims?.claims?.sub as string | undefined;
    if (!userId) return json({ error: 'Unauthorized' }, 401);

    // Resolve user's Outlook connection
    const { data: conn } = await admin
      .from('provider_connections')
      .select('id, connected_email')
      .eq('user_id', userId)
      .eq('provider', 'outlook')
      .not('connected_email', 'is', null)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    const results: { probe: string; status: 'pass' | 'fail' | 'warn' | 'skipped'; detail?: any }[] = [];
    const persist = async () => {
      if (!results.length) return;
      await admin.from('graph_health').insert(results.map((r) => ({
        user_id: userId,
        connection_id: conn?.id || null,
        probe: r.probe,
        status: r.status,
        detail: r.detail || null,
      })));
    };

    if (!conn) {
      results.push({ probe: 'identity', status: 'fail', detail: { message: 'No Microsoft Outlook connection found. Connect it from Integrations.' } });
      await persist();
      return json({ results, ok: false });
    }

    // Probe 1: identity
    const id = await callGraph(userId, conn.id, 'user', '/me?$select=id,userPrincipalName,mail');
    if (!id.ok) {
      results.push({ probe: 'identity', status: 'fail', detail: { message: id.error?.message || 'Identity call failed', code: id.error?.code } });
      await persist();
      return json({ results, ok: false });
    }
    results.push({ probe: 'identity', status: 'pass', detail: { email: id.data?.mail || id.data?.userPrincipalName, id: id.data?.id } });

    // Probe 2: scopes — decode the token directly
    const token = await getValidAccessToken(userId, 'outlook', conn.id);
    const payload = token ? decodeJwtPayload(token) : null;
    const scopeStr = String(payload?.scp || payload?.scope || '');
    const grantedScopes = scopeStr.split(/[ ,]+/).filter(Boolean);
    const missing = REQUIRED_SCOPES.filter((s) => !grantedScopes.some((g) => g.toLowerCase() === s.toLowerCase()));
    if (missing.length) {
      results.push({ probe: 'scopes', status: 'fail', detail: { message: `Missing scopes: ${missing.join(', ')}. Reconnect Microsoft and grant Mail.ReadWrite.`, missing, granted: grantedScopes } });
      // skip dependent probes
      results.push({ probe: 'read_sent_flags', status: 'skipped' });
      results.push({ probe: 'read_conversation', status: 'skipped' });
      results.push({ probe: 'subscription', status: 'skipped' });
      results.push({ probe: 'draft_write', status: 'skipped' });
      await persist();
      return json({ results, ok: false });
    }
    results.push({ probe: 'scopes', status: 'pass', detail: { granted: grantedScopes } });

    // Probe 3: read sent items with flag/category fields
    const sent = await callGraph<any>(userId, conn.id, 'mail',
      `/me/mailFolders('sentitems')/messages?$top=1&$select=id,subject,flag,categories,conversationId,toRecipients,sentDateTime`);
    let sampleMessageId: string | null = null;
    let sampleConversationId: string | null = null;
    if (!sent.ok) {
      results.push({ probe: 'read_sent_flags', status: 'fail', detail: { message: sent.error?.message, code: sent.error?.code } });
    } else {
      const msg = sent.data?.value?.[0];
      sampleMessageId = msg?.id || null;
      sampleConversationId = msg?.conversationId || null;
      const hasShape = !!msg && ('flag' in msg) && ('categories' in msg);
      results.push({
        probe: 'read_sent_flags',
        status: hasShape || sent.data?.value?.length === 0 ? 'pass' : 'warn',
        detail: { sample_subject: msg?.subject, sample_id: sampleMessageId },
      });
    }

    // Probe 4: read conversation
    if (sampleConversationId) {
      const conv = await callGraph<any>(userId, conn.id, 'mail',
        `/me/messages?$filter=${encodeURIComponent(`conversationId eq '${sampleConversationId}'`)}&$select=id,from,receivedDateTime&$top=5`);
      if (!conv.ok) {
        results.push({ probe: 'read_conversation', status: 'fail', detail: { message: conv.error?.message, code: conv.error?.code } });
      } else {
        results.push({ probe: 'read_conversation', status: 'pass', detail: { count: conv.data?.value?.length || 0 } });
      }
    } else {
      results.push({ probe: 'read_conversation', status: 'warn', detail: { message: 'No sent messages to use for conversation test.' } });
    }

    // Probe 5: subscription — attempt to create; webhook validation usually fails in sandbox → downgrade to WARN
    const supaUrl = Deno.env.get('SUPABASE_URL')!;
    const notifyUrl = `${supaUrl}/functions/v1/flag-tracker-ingest`;
    const expiration = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const sub = await callGraph<any>(userId, conn.id, 'mail', '/subscriptions', {
      method: 'POST',
      body: JSON.stringify({
        changeType: 'created,updated',
        notificationUrl: notifyUrl,
        resource: "me/mailFolders('sentitems')/messages",
        expirationDateTime: expiration,
        clientState: `preflight-${userId.slice(0, 8)}`,
      }),
    });
    if (sub.ok) {
      results.push({ probe: 'subscription', status: 'pass', detail: { id: sub.data?.id } });
      if (sub.data?.id) {
        await callGraph(userId, conn.id, 'mail', `/subscriptions/${sub.data.id}`, { method: 'DELETE' });
      }
    } else {
      results.push({ probe: 'subscription', status: 'warn',
        detail: { message: `Webhook validation could not complete (${sub.error?.code || sub.status}). Delta polling will be used instead.`, raw: sub.error?.message } });
    }

    // Probe 6: createReply + delete
    if (sampleMessageId) {
      const draft = await callGraph<any>(userId, conn.id, 'mail',
        `/me/messages/${sampleMessageId}/createReply`, { method: 'POST', body: '{}' });
      if (!draft.ok) {
        results.push({ probe: 'draft_write', status: 'fail', detail: { message: draft.error?.message, code: draft.error?.code } });
      } else {
        const draftId = draft.data?.id;
        const del = draftId
          ? await callGraph(userId, conn.id, 'mail', `/me/messages/${draftId}`, { method: 'DELETE' })
          : { ok: false, error: { message: 'no draft id returned' } } as any;
        if (!del.ok) {
          results.push({ probe: 'draft_write', status: 'warn',
            detail: { message: 'Draft created but cleanup failed — please delete it manually.', draftId, raw: del.error?.message } });
        } else {
          results.push({ probe: 'draft_write', status: 'pass' });
        }
      }
    } else {
      results.push({ probe: 'draft_write', status: 'warn', detail: { message: 'No sample sent message to test reply draft.' } });
    }

    await persist();
    const critical = ['identity', 'scopes', 'read_sent_flags', 'read_conversation', 'draft_write'];
    const ok = critical.every((p) => results.find((r) => r.probe === p)?.status === 'pass');
    return json({ ok, results });
  } catch (e: any) {
    console.error('graph-preflight error', e);
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
