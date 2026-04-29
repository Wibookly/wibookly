// Hybrid retrieval: semantic (pgvector cosine) + keyword (ILIKE) search
// across knowledge_chunks and email_messages, scoped to a connection.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!;

interface Citation {
  source: 'knowledge' | 'email';
  id: string;
  title: string;
  snippet: string;
  score: number;
  metadata: Record<string, any>;
}

async function embedQuery(query: string): Promise<number[] | null> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: query.slice(0, 8000),
    }),
  });
  if (!res.ok) {
    console.error('embed query failed', res.status, await res.text());
    return null;
  }
  const data = await res.json();
  return data.data?.[0]?.embedding || null;
}

function snippet(text: string, maxLen = 300): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > maxLen ? clean.slice(0, maxLen) + '…' : clean;
}

// Reciprocal-rank fusion combining semantic + keyword rankings
function rrf(results: Array<{ id: string; rank: number }>[], k = 60): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of results) {
    for (const item of list) {
      const prev = scores.get(item.id) ?? 0;
      scores.set(item.id, prev + 1 / (k + item.rank));
    }
  }
  return scores;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const {
      query,
      connection_id,
      sources = ['knowledge', 'email'],
      top_k = 8,
      semantic_k = 20,
      keyword_k = 20,
    } = await req.json();

    if (!query || typeof query !== 'string') {
      return new Response(JSON.stringify({ error: 'query is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!connection_id) {
      return new Response(JSON.stringify({ error: 'connection_id is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Verify user owns the connection (and grab org)
    const { data: conn } = await admin
      .from('provider_connections')
      .select('id, user_id, organization_id')
      .eq('id', connection_id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!conn) {
      return new Response(JSON.stringify({ error: 'Connection not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const queryEmbedding = await embedQuery(query);
    const embeddingLiteral = queryEmbedding ? `[${queryEmbedding.join(',')}]` : null;

    const citations: Citation[] = [];

    /* ---------- Knowledge chunks ---------- */
    if (sources.includes('knowledge')) {
      // Semantic
      let semanticChunks: any[] = [];
      if (embeddingLiteral) {
        const { data, error } = await admin.rpc('match_knowledge_chunks', {
          query_embedding: embeddingLiteral,
          p_user_id: user.id,
          p_connection_id: connection_id,
          match_count: semantic_k,
        }).maybeSingle ? await admin.rpc('match_knowledge_chunks', {
          query_embedding: embeddingLiteral,
          p_user_id: user.id,
          p_connection_id: connection_id,
          match_count: semantic_k,
        }) : { data: [], error: null };

        // Fallback: direct query using order on cosine distance if RPC missing
        if (error || !data) {
          const { data: directData } = await admin
            .from('knowledge_chunks')
            .select('id, content, document_id, chunk_index, embedding')
            .eq('user_id', user.id)
            .or(`connection_id.eq.${connection_id},connection_id.is.null`)
            .not('embedding', 'is', null)
            .limit(200);
          // We can't compute cosine in JS efficiently here, accept top by recency as fallback
          semanticChunks = (directData || []).slice(0, semantic_k);
        } else {
          semanticChunks = data;
        }
      }

      // Keyword
      const { data: keywordChunks } = await admin
        .from('knowledge_chunks')
        .select('id, content, document_id, chunk_index')
        .eq('user_id', user.id)
        .or(`connection_id.eq.${connection_id},connection_id.is.null`)
        .ilike('content', `%${query.slice(0, 100)}%`)
        .limit(keyword_k);

      const semList = semanticChunks.map((c: any, i: number) => ({ id: c.id, rank: i + 1 }));
      const kwList = (keywordChunks || []).map((c: any, i: number) => ({ id: c.id, rank: i + 1 }));
      const fused = rrf([semList, kwList]);

      // Build lookup
      const all = new Map<string, any>();
      for (const c of [...semanticChunks, ...(keywordChunks || [])]) all.set(c.id, c);

      // Resolve titles
      const docIds = Array.from(new Set(Array.from(all.values()).map((c: any) => c.document_id)));
      const { data: docs } = await admin
        .from('knowledge_documents')
        .select('id, title')
        .in('id', docIds.length ? docIds : ['00000000-0000-0000-0000-000000000000']);
      const titleById = new Map((docs || []).map((d: any) => [d.id, d.title]));

      const sorted = Array.from(fused.entries()).sort((a, b) => b[1] - a[1]);
      for (const [id, score] of sorted.slice(0, top_k)) {
        const c = all.get(id);
        if (!c) continue;
        citations.push({
          source: 'knowledge',
          id,
          title: titleById.get(c.document_id) || 'Document',
          snippet: snippet(c.content),
          score,
          metadata: { document_id: c.document_id, chunk_index: c.chunk_index },
        });
      }
    }

    /* ---------- Email messages ---------- */
    if (sources.includes('email')) {
      let semanticEmails: any[] = [];
      if (embeddingLiteral) {
        const { data, error } = await admin.rpc('match_email_messages', {
          query_embedding: embeddingLiteral,
          p_user_id: user.id,
          p_connection_id: connection_id,
          match_count: semantic_k,
        });
        if (!error && data) semanticEmails = data;
      }

      const { data: keywordEmails } = await admin
        .from('email_messages')
        .select('id, subject, from_email, body_clean, sent_at, thread_id')
        .eq('user_id', user.id)
        .eq('connection_id', connection_id)
        .or(`subject.ilike.%${query.slice(0, 100)}%,body_clean.ilike.%${query.slice(0, 100)}%`)
        .order('sent_at', { ascending: false })
        .limit(keyword_k);

      const semList = semanticEmails.map((e: any, i: number) => ({ id: e.id, rank: i + 1 }));
      const kwList = (keywordEmails || []).map((e: any, i: number) => ({ id: e.id, rank: i + 1 }));
      const fused = rrf([semList, kwList]);

      const all = new Map<string, any>();
      for (const e of [...semanticEmails, ...(keywordEmails || [])]) all.set(e.id, e);

      const sorted = Array.from(fused.entries()).sort((a, b) => b[1] - a[1]);
      for (const [id, score] of sorted.slice(0, top_k)) {
        const e = all.get(id);
        if (!e) continue;
        citations.push({
          source: 'email',
          id,
          title: e.subject || '(no subject)',
          snippet: snippet(e.body_clean || ''),
          score,
          metadata: {
            thread_id: e.thread_id,
            from_email: e.from_email,
            sent_at: e.sent_at,
          },
        });
      }
    }

    // Final sort by score desc
    citations.sort((a, b) => b.score - a.score);

    return new Response(JSON.stringify({
      query,
      connection_id,
      results: citations.slice(0, top_k * 2),
      counts: {
        knowledge: citations.filter(c => c.source === 'knowledge').length,
        email: citations.filter(c => c.source === 'email').length,
      },
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err: any) {
    console.error('retrieve-context error', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
