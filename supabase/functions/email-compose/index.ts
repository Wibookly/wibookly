// Email Composer helper for the AI Chat inline composer.
// Actions:
//   - draft     : produce { subject, body } from a natural-language prompt
//   - contacts  : autocomplete recipients from Outlook /me/people
//   - signature : return the user's HTML signature for the composer
//   - send      : send through Outlook /me/sendMail
import { createClient } from 'npm:@supabase/supabase-js@2';
import { callGraph } from '../_shared/graph-call.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function buildSignature(p: any, userEmail: string | null): string {
  if (!p) return '';
  if (p.email_signature && String(p.email_signature).trim()) {
    return String(p.email_signature);
  }
  const name = p.full_name || '';
  const title = p.title || '';
  const phone = p.phone || '';
  const mobile = p.mobile || '';
  const website = p.website || '';
  const logo = p.signature_logo_url || '';
  const font = p.signature_font || 'Arial, sans-serif';
  const color = p.signature_color || '#333333';
  if (!name && !title && !phone && !mobile && !website && !logo) return '';
  const rows: string[] = [];
  if (phone) rows.push(`<tr><td style="padding:2px 0;"><span style="font-size:14px;">📞</span></td><td style="padding:2px 0 2px 8px;">Main: ${phone}</td></tr>`);
  if (mobile) rows.push(`<tr><td style="padding:2px 0;"><span style="font-size:14px;">📱</span></td><td style="padding:2px 0 2px 8px;">Mobile: ${mobile}</td></tr>`);
  if (website) {
    const clean = website.replace(/^https?:\/\//, '');
    rows.push(`<tr><td style="padding:2px 0;"><span style="font-size:14px;">🌐</span></td><td style="padding:2px 0 2px 8px;"><a href="${website}" style="color:${color};text-decoration:none;">${clean}</a></td></tr>`);
  }
  if (userEmail) {
    rows.push(`<tr><td style="padding:2px 0;"><span style="font-size:14px;">✉️</span></td><td style="padding:2px 0 2px 8px;"><a href="mailto:${userEmail}" style="color:${color};text-decoration:none;">${userEmail}</a></td></tr>`);
  }
  return `<div style="font-family:${font};font-size:14px;color:${color};">
  <p style="margin:0 0 12px 0;">Best regards,</p>
  <table cellpadding="0" cellspacing="0" border="0" style="font-family:${font};font-size:14px;color:${color};">
    <tr>
      ${logo ? `<td style="vertical-align:top;padding-right:16px;border-right:2px solid #e5e5e5;"><img src="${logo}" alt="Logo" style="max-height:80px;max-width:120px;"/></td>` : ''}
      <td style="vertical-align:top;${logo ? 'padding-left:16px;' : ''}">
        ${name ? `<div style="font-size:16px;font-weight:bold;color:${color};margin-bottom:2px;">${name}</div>` : ''}
        ${title ? `<div style="font-size:14px;color:#2563eb;margin-bottom:8px;">${title}</div>` : ''}
        <table cellpadding="0" cellspacing="0" border="0" style="font-size:13px;color:${color};">
          ${rows.join('')}
        </table>
      </td>
    </tr>
  </table>
</div>`;
}

async function draftWithLLM(prompt: string, senderName: string | null): Promise<{ subject: string; body: string }> {
  const key = Deno.env.get('LOVABLE_API_KEY');
  if (!key) return { subject: '', body: prompt };
  const sys = `You write professional business emails. Reply ONLY with strict JSON of shape {"subject":"...","body":"<p>...</p>"}.
- subject: ≤ 80 chars, no quotes.
- body: clean HTML using <p> paragraphs, <ul><li> for lists, <strong>. Open with a brief greeting (e.g. "Hi {first name}," or "Hello,") and close with a sign-off line (e.g. "Thanks,"). DO NOT include the sender signature — that is added separately.
- Match a concise, friendly, professional tone${senderName ? ` from ${senderName}` : ''}.
- Use the user's request below verbatim for intent; do not invent facts not implied.`;
  const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) return { subject: '', body: `<p>${prompt}</p>` };
  const j = await res.json();
  const txt = j?.choices?.[0]?.message?.content || '{}';
  try {
    const parsed = JSON.parse(txt);
    return { subject: String(parsed.subject || '').slice(0, 200), body: String(parsed.body || '') };
  } catch {
    return { subject: '', body: `<p>${prompt}</p>` };
  }
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
    const token = authHeader.replace('Bearer ', '');
    const { data: claims, error: cerr } = await supabase.auth.getClaims(token);
    if (cerr || !claims?.claims) return json({ error: 'Unauthorized' }, 401);
    const userId = claims.claims.sub as string;

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || '');
    const connectionId = String(body?.connection_id || '');

    if (!action) return json({ error: 'action required' }, 400);

    // For everything except `draft`, we need a verified connection.
    let connEmail: string | null = null;
    if (action !== 'draft') {
      if (!connectionId) return json({ error: 'connection_id required' }, 400);
      const { data: conn } = await supabase
        .from('provider_connections')
        .select('id, provider, email')
        .eq('id', connectionId)
        .eq('user_id', userId)
        .maybeSingle();
      if (!conn || conn.provider !== 'outlook') return json({ error: 'Outlook connection not found' }, 404);
      connEmail = (conn as any).email || null;
    }

    if (action === 'draft') {
      const prompt = String(body?.prompt || '').trim();
      if (!prompt) return json({ error: 'prompt required' }, 400);
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', userId)
        .maybeSingle();
      const draft = await draftWithLLM(prompt, (profile as any)?.full_name || null);
      return json({ ok: true, draft });
    }

    if (action === 'signature') {
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, title, email_signature, phone, mobile, website, signature_logo_url, signature_font, signature_color')
        .eq('id', userId)
        .maybeSingle();
      const html = buildSignature(profile, connEmail);
      return json({ ok: true, signature: html, from_email: connEmail });
    }

    if (action === 'contacts') {
      const q = String(body?.query || '').trim();
      if (q.length < 1) return json({ ok: true, results: [] });
      const top = Math.min(Math.max(Number(body?.top) || 8, 1), 25);
      const endpoint = `/me/people?$search="${encodeURIComponent(q).replace(/"/g, '%22')}"&$top=${top}&$select=displayName,scoredEmailAddresses,emailAddresses,personType`;
      const res = await callGraph(userId, connectionId, 'user', endpoint, {
        headers: { ConsistencyLevel: 'eventual' },
      });
      if (!res.ok) return json({ ok: false, error: res.error?.message || 'people lookup failed' }, 500);
      const seen = new Set<string>();
      const results = ((res.data as any)?.value || []).flatMap((p: any) => {
        const emails = (p.scoredEmailAddresses?.length ? p.scoredEmailAddresses : p.emailAddresses) || [];
        return emails.map((e: any) => ({
          name: p.displayName || e.name || e.address,
          email: e.address,
          relevance: e.relevanceScore ?? null,
        }));
      }).filter((c: any) => {
        if (!c.email) return false;
        const k = c.email.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      return json({ ok: true, results });
    }

    if (action === 'send') {
      const to: string[] = (Array.isArray(body?.to) ? body.to : []).filter((e: any) => typeof e === 'string' && e.includes('@'));
      if (!to.length) return json({ error: 'at least one valid To recipient is required' }, 400);
      const cc: string[] = (Array.isArray(body?.cc) ? body.cc : []).filter((e: any) => typeof e === 'string' && e.includes('@'));
      const bcc: string[] = (Array.isArray(body?.bcc) ? body.bcc : []).filter((e: any) => typeof e === 'string' && e.includes('@'));
      const subject = String(body?.subject || '').trim();
      const html = String(body?.body || '').trim();
      if (!subject) return json({ error: 'subject required' }, 400);
      if (!html) return json({ error: 'body required' }, 400);
      const toRecip = (arr: string[]) => arr.map((a) => ({ emailAddress: { address: a } }));
      const message: Record<string, any> = {
        subject,
        body: { contentType: 'HTML', content: html },
        toRecipients: toRecip(to),
      };
      if (cc.length) message.ccRecipients = toRecip(cc);
      if (bcc.length) message.bccRecipients = toRecip(bcc);
      const res = await callGraph(userId, connectionId, 'mail', '/me/sendMail', {
        method: 'POST',
        body: JSON.stringify({ message, saveToSentItems: true }),
      });
      if (!res.ok) return json({ error: res.error?.message || 'send failed', code: res.error?.code }, res.status || 500);
      return json({ ok: true, sent_at: new Date().toISOString(), to, cc, bcc, subject });
    }

    return json({ error: `unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
