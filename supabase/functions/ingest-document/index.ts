// ingest-document: extract text from uploaded file, chunk, embed, store.
// Supports PDF, DOCX, TXT, MD. Uses npm: specifiers for stability in edge runtime.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

const EMBED_MODEL = "text-embedding-3-small";
const CHUNK_TARGET_TOKENS = 500;
const CHUNK_OVERLAP_TOKENS = 50;
// Approx 4 chars per token
const CHUNK_TARGET_CHARS = CHUNK_TARGET_TOKENS * 4;
const CHUNK_OVERLAP_CHARS = CHUNK_OVERLAP_TOKENS * 4;

async function extractText(
  bytes: Uint8Array,
  mime: string,
  filename: string,
): Promise<string> {
  const lower = filename.toLowerCase();
  // Plain text / markdown
  if (
    mime.startsWith("text/") ||
    lower.endsWith(".txt") ||
    lower.endsWith(".md")
  ) {
    return new TextDecoder().decode(bytes);
  }
  // PDF
  if (mime === "application/pdf" || lower.endsWith(".pdf")) {
    const pdfParse = (await import("npm:pdf-parse@1.1.1")).default;
    const data = await pdfParse(bytes);
    return data.text || "";
  }
  // DOCX
  if (
    mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lower.endsWith(".docx")
  ) {
    const mammoth = await import("npm:mammoth@1.8.0");
    const result = await mammoth.extractRawText({ buffer: bytes });
    return result.value || "";
  }
  throw new Error(`Unsupported file type: ${mime} (${filename})`);
}

function chunkText(
  text: string,
  targetChars: number,
  overlapChars: number,
): string[] {
  const cleaned = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (cleaned.length === 0) return [];
  if (cleaned.length <= targetChars) return [cleaned];

  const chunks: string[] = [];
  let start = 0;
  while (start < cleaned.length) {
    let end = Math.min(start + targetChars, cleaned.length);
    if (end < cleaned.length) {
      // Try to break at paragraph or sentence boundary
      const slice = cleaned.slice(start, end);
      const lastPara = slice.lastIndexOf("\n\n");
      const lastSent = Math.max(
        slice.lastIndexOf(". "),
        slice.lastIndexOf("! "),
        slice.lastIndexOf("? "),
      );
      const breakAt = lastPara > targetChars * 0.5
        ? lastPara
        : lastSent > targetChars * 0.5
          ? lastSent + 1
          : -1;
      if (breakAt > 0) end = start + breakAt;
    }
    const chunk = cleaned.slice(start, end).trim();
    if (chunk.length > 0) chunks.push(chunk);
    if (end >= cleaned.length) break;
    start = Math.max(end - overlapChars, start + 1);
  }
  return chunks;
}

async function embedBatch(inputs: string[]): Promise<number[][]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: EMBED_MODEL, input: inputs }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI embeddings ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  return data.data.map((d: { embedding: number[] }) => d.embedding);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let documentId: string | null = null;
  let serviceClient: ReturnType<typeof createClient> | null = null;

  try {
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } =
      await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub;

    serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const body = await req.json();
    const {
      storage_path,
      title,
      mime_type,
      filename,
      connection_id,
      manual_text,
      source_type = "upload",
    } = body || {};

    if (!title) {
      return new Response(JSON.stringify({ error: "title required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve organization for the user
    const { data: profile } = await serviceClient
      .from("user_profiles")
      .select("organization_id")
      .eq("user_id", userId)
      .maybeSingle();
    const organizationId = profile?.organization_id;
    if (!organizationId) {
      return new Response(
        JSON.stringify({ error: "No organization for user" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Get raw text
    let rawText = "";
    if (source_type === "manual") {
      rawText = String(manual_text || "").trim();
      if (!rawText) {
        return new Response(
          JSON.stringify({ error: "manual_text required for manual source" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    } else {
      if (!storage_path) {
        return new Response(
          JSON.stringify({ error: "storage_path required" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      const { data: fileBlob, error: dlErr } = await serviceClient.storage
        .from("knowledge-files")
        .download(storage_path);
      if (dlErr || !fileBlob) {
        throw new Error(`Failed to download file: ${dlErr?.message}`);
      }
      const bytes = new Uint8Array(await fileBlob.arrayBuffer());
      rawText = await extractText(
        bytes,
        mime_type || fileBlob.type || "",
        filename || storage_path,
      );
    }

    if (!rawText.trim()) {
      throw new Error("No text could be extracted from the document");
    }

    // Insert document row (processing)
    const { data: docRow, error: insErr } = await serviceClient
      .from("knowledge_documents")
      .insert({
        user_id: userId,
        organization_id: organizationId,
        connection_id: connection_id || null,
        title,
        source_type,
        source_ref: storage_path || null,
        content: rawText.slice(0, 200000),
        metadata: { mime_type, filename },
        status: "processing",
      })
      .select("id")
      .single();
    if (insErr || !docRow) throw new Error(`Insert failed: ${insErr?.message}`);
    documentId = docRow.id;

    // Chunk
    const chunks = chunkText(rawText, CHUNK_TARGET_CHARS, CHUNK_OVERLAP_CHARS);
    if (chunks.length === 0) throw new Error("No chunks produced");

    // Embed in batches of 100
    const allEmbeddings: number[][] = [];
    for (let i = 0; i < chunks.length; i += 100) {
      const batch = chunks.slice(i, i + 100);
      const emb = await embedBatch(batch);
      allEmbeddings.push(...emb);
    }

    // Insert chunks
    const rows = chunks.map((content, idx) => ({
      document_id: documentId,
      user_id: userId,
      organization_id: organizationId,
      connection_id: connection_id || null,
      chunk_index: idx,
      content,
      embedding: allEmbeddings[idx] as unknown as string,
      token_count: Math.ceil(content.length / 4),
    }));
    // Insert in pages of 50
    for (let i = 0; i < rows.length; i += 50) {
      const slice = rows.slice(i, i + 50);
      const { error: chunkErr } = await serviceClient
        .from("knowledge_chunks")
        .insert(slice);
      if (chunkErr) throw new Error(`Chunk insert: ${chunkErr.message}`);
    }

    await serviceClient
      .from("knowledge_documents")
      .update({
        status: "indexed",
        chunk_count: chunks.length,
        indexed_at: new Date().toISOString(),
      })
      .eq("id", documentId);

    return new Response(
      JSON.stringify({
        document_id: documentId,
        chunk_count: chunks.length,
        status: "indexed",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("ingest-document error:", e);
    if (documentId && serviceClient) {
      await serviceClient
        .from("knowledge_documents")
        .update({
          status: "failed",
          error_message: e instanceof Error ? e.message : String(e),
        })
        .eq("id", documentId);
    }
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
