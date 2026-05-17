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
      strict_connection = false,
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

    /* ---------- Knowledge chunks (hybrid via SQL RPC) ---------- */
    if (sources.includes('knowledge') && embeddingLiteral) {
      const { data: hybrid, error: hybridErr } = await admin.rpc('search_knowledge_hybrid', {
        query_embedding: embeddingLiteral,
        query_text: query,
        p_user_id: user.id,
        p_connection_id: connection_id,
        strict_connection,
        match_count: Math.max(top_k, semantic_k),
      });
      if (hybridErr) {
        console.error('search_knowledge_hybrid error', hybridErr);
      } else {
        for (const r of (hybrid || []).slice(0, top_k)) {
          citations.push({
            source: 'knowledge',
            id: r.chunk_id,
            title: r.title || 'Document',
            snippet: snippet(r.content),
            score: Number(r.combined_score) || 0,
            metadata: {
              document_id: r.document_id,
              chunk_index: r.chunk_index,
              similarity: r.similarity,
              keyword_rank: r.keyword_rank,
              source_type: r.source_type,
              source_ref: r.source_ref,
              extracted_metadata: r.extracted_metadata,
              connection_id: r.connection_id,
            },
          });
        }
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
