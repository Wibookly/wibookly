// Export a single chat conversation (or all of a user's conversations) as
// PDF or XLSX. Returns { filename, mime_type, base64 } so the browser can
// download it. Requires authenticated user — only exports their own data.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import {
  generatePdf,
  generateXlsx,
} from '../_shared/document-generators.ts';
import { getValidAccessToken } from '../_shared/oauth-tokens.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function fmt(ts: string): string {
  try {
    return new Date(ts).toLocaleString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  } catch { return ts; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;
    if (!user) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));
    const format = body.format === 'xlsx' ? 'xlsx' : 'pdf';
    const conversationId: string | undefined = body.conversation_id;
    const destination: 'download' | 'onedrive' = body.destination === 'onedrive' ? 'onedrive' : 'download';
    const connectionId: string | undefined = body.connection_id || body.connectionId;
    const scope: 'one' | 'all' = conversationId ? 'one' : 'all';

    // Fetch conversations
    let convQ = supabase
      .from('chat_conversations')
      .select('id, title, created_at, updated_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true });
    if (scope === 'one') convQ = convQ.eq('id', conversationId!);
    const { data: conversations, error: convErr } = await convQ;
    if (convErr) throw convErr;
    if (!conversations || conversations.length === 0) {
      return new Response(JSON.stringify({ error: 'No conversations found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const convIds = conversations.map((c) => c.id);
    const { data: messages, error: msgErr } = await supabase
      .from('chat_messages')
      .select('conversation_id, role, content, created_at')
      .in('conversation_id', convIds)
      .order('created_at', { ascending: true });
    if (msgErr) throw msgErr;
    const msgs = messages || [];

    const baseLabel = scope === 'one'
      ? `InboxIQ - ${(conversations[0].title || 'Chat').slice(0, 60)}`
      : `InboxIQ - Chat History ${new Date().toISOString().slice(0, 10)}`;

    let file: { filename: string; mime_type: string; base64: string };
    if (format === 'xlsx') {
      file = await generateXlsx({
        filename: baseLabel,
        sheets: [{
          name: 'Chat History',
          headers: ['Conversation', 'Started', 'Timestamp', 'Role', 'Message'],
          rows: msgs.map((m) => {
            const c = conversations.find((c) => c.id === m.conversation_id);
            return [
              c?.title || 'Untitled',
              c ? fmt(c.created_at) : '',
              fmt(m.created_at),
              m.role,
              m.content,
            ];
          }),
        }],
      });
    } else {
      const sections = conversations.map((c) => {
        const lines: string[] = [];
        lines.push(`Started: ${fmt(c.created_at)}`);
        lines.push('');
        for (const m of msgs.filter((m) => m.conversation_id === c.id)) {
          const who = m.role === 'user' ? 'You' : m.role === 'assistant' ? 'InboxIQ' : 'System';
          lines.push(`[${fmt(m.created_at)}] ${who}:`);
          lines.push(m.content || '');
          lines.push('');
        }
        return { heading: c.title || 'Untitled conversation', body: lines.join('\n') };
      });

      file = await generatePdf({
        title: scope === 'one'
          ? (conversations[0].title || 'Chat Export')
          : 'InboxIQ Chat History',
        subtitle: `Exported ${fmt(new Date().toISOString())} • ${conversations.length} conversation${conversations.length === 1 ? '' : 's'}`,
        sections,
        footer: 'InboxIQ — Chat export',
      });
      // Ensure filename matches InboxIQ - prefix
      file.filename = baseLabel + (file.filename.toLowerCase().endsWith('.pdf') ? '.pdf' : '');
    }

    if (destination === 'onedrive') {
      if (!connectionId) {
        return new Response(JSON.stringify({ error: 'No active Microsoft 365 connection.' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { saveToOneDrive } = await import('../_shared/onedrive-save.ts');
      // Decode base64 → bytes
      const bin = atob(file.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const ext = format === 'xlsx' ? 'xlsx' : 'pdf';
      const res = await saveToOneDrive({
        userId: user.id,
        connectionId,
        baseName: baseLabel,
        ext,
        content: bytes,
        contentType: file.mime_type,
        subfolder: 'Exports',
      });
      if (!res.ok) {
        return new Response(JSON.stringify({ error: res.error || 'OneDrive save failed' }), {
          status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({
        destination: 'onedrive',
        webUrl: res.webUrl,
        path: res.path,
        filename: `${baseLabel}.${ext}`,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify(file), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('export-chat error', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

