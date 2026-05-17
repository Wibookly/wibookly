// m365-extract-file: download a Microsoft 365 file (mail attachment / OneDrive / SharePoint),
// extract text, chunk, embed, and store in knowledge_documents + knowledge_chunks.
// Idempotent on (user_id, connection_id, source_type, external_id).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callGraphBinary } from "../_shared/graph-call.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

const EMBED_MODEL = "text-embedding-3-small";
const CHUNK_TARGET_CHARS = 2000;
const CHUNK_OVERLAP_CHARS = 200;
const MAX_BYTES = 25 * 1024 * 1024;       // 25 MB hard cap
const MIN_TEXT_CHARS = 20;

const SUPPORTED_MIME = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // docx
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",       // xlsx
  "text/plain",
  "text/markdown",
  "text/csv",
]);

function mimeFromName(name: string, fallback?: string): string {
  const n = name.toLowerCase();
  if (n.endsWith(".pdf")) return "application/pdf";
  if (n.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (n.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (n.endsWith(".txt")) return "text/plain";
  if (n.endsWith(".md")) return "text/markdown";
  if (n.endsWith(".csv")) return "text/csv";
  return fallback || "application/octet-stream";
}

async function extractText(bytes: Uint8Array, mime: string, filename: string): Promise<string> {
  const m = (mime || "").toLowerCase();
  const n = filename.toLowerCase();
  if (m.startsWith("text/") || n.endsWith(".txt") || n.endsWith(".md") || n.endsWith(".csv")) {
    return new TextDecoder().decode(bytes);
  }
  if (m === "application/pdf" || n.endsWith(".pdf")) {
    const pdfParse = (await import("npm:pdf-parse@1.1.1")).default;
    const data = await pdfParse(bytes);
    return data.text || "";
  }
  if (m.includes("wordprocessingml") || n.endsWith(".docx")) {
    const mammoth = await import("npm:mammoth@1.8.0");
    const result = await mammoth.extractRawText({ buffer: bytes });
    return result.value || "";
  }
  if (m.includes("spreadsheetml") || n.endsWith(".xlsx")) {
    const XLSX = await import("npm:xlsx@0.18.5");
    const wb = XLSX.read(bytes, { type: "array" });
    const parts: string[] = [];
    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      parts.push(`# Sheet: ${sheetName}`);
      parts.push(XLSX.utils.sheet_to_csv(ws));
    }
    return parts.join("\n\n");
  }
  throw new Error(`Unsupported file type: ${mime} (${filename})`);
}

function chunkText(text: string): string[] {
  const cleaned = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (!cleaned) return [];
  if (cleaned.length <= CHUNK_TARGET_CHARS) return [cleaned];
  const chunks: string[] = [];
  let start = 0;
  while (start < cleaned.length) {
    let end = Math.min(start + CHUNK_TARGET_CHARS, cleaned.length);
    if (end < cleaned.length) {
      const slice = cleaned.slice(start, end);
      const lastPara = slice.lastIndexOf("\n\n");
      const lastSent = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
      const breakAt = lastPara > CHUNK_TARGET_CHARS * 0.5
        ? lastPara
        : lastSent > CHUNK_TARGET_CHARS * 0.5 ? lastSent + 1 : -1;
      if (breakAt > 0) end = start + breakAt;
    }
    const chunk = cleaned.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= cleaned.length) break;
    start = Math.max(end - CHUNK_OVERLAP_CHARS, start + 1);
  }
  return chunks;
}

async function embedBatch(inputs: string[]): Promise<number[][]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input: inputs }),
  });
  if (!res.ok) throw new Error(`OpenAI embeddings ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.data.map((d: { embedding: number[] }) => d.embedding);
}

// Lightweight invoice metadata extractor (regex; best-effort)
function extractInvoiceMetadata(text: string): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  const slice = text.slice(0, 20000);

  // Total amount: look for "Total", "Amount Due", "Balance Due" near a currency value
  const totalRegex = /(?:total(?:\s+due)?|amount\s+due|balance\s+due|grand\s+total)\s*[:\-]?\s*([\$€£]?\s*[\d,]+(?:\.\d{2})?)/i;
  const totalMatch = slice.match(totalRegex);
  if (totalMatch) meta.total_amount_text = totalMatch[1].trim();

  // Any currency value (fallback list)
  const currencyMatches = [...slice.matchAll(/[\$€£]\s*([\d,]+(?:\.\d{2})?)/g)].map((m) => m[0]);
  if (currencyMatches.length) meta.currency_values = currencyMatches.slice(0, 10);

  // Invoice number
  const invNum = slice.match(/invoice\s*(?:#|number|no\.?)\s*[:\-]?\s*([A-Z0-9\-]{3,})/i);
  if (invNum) meta.invoice_number = invNum[1];

  // Date (ISO-ish or DD/MM/YYYY)
  const date = slice.match(/(?:invoice\s+date|date)\s*[:\-]?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/i);
  if (date) meta.invoice_date = date[1];

  // Vendor: first non-empty line that's not a generic word
  const firstLines = text.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 8);
  if (firstLines.length) meta.likely_vendor = firstLines[0].slice(0, 120);

  return meta;
}

interface ExtractBody {
  connection_id: string;
  source_type: "mail_attachment" | "onedrive" | "sharepoint";
  external_id: string;          // unique id we use for idempotency
  title: string;
  mime_type?: string;
  // mail_attachment
  message_id?: string;
  attachment_id?: string;
  // onedrive
  drive_item_id?: string;
  // sharepoint
  drive_id?: string;
  item_id?: string;
  // metadata pass-through (web_url, sender, etc.)
  source_ref?: string;
  extra_metadata?: Record<string, unknown>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let documentId: string | null = null;
  let admin: ReturnType<typeof createClient> | null = null;

  try {
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const body = (await req.json()) as ExtractBody;
    if (!body?.connection_id || !body?.source_type || !body?.external_id || !body?.title) {
      return new Response(
        JSON.stringify({ error: "connection_id, source_type, external_id, title required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Resolve organization
    const { data: profile } = await admin
      .from("user_profiles").select("organization_id").eq("user_id", userId).maybeSingle();
    const organizationId = profile?.organization_id;
    if (!organizationId) throw new Error("No organization for user");

    // Idempotency: skip if already completed
    const { data: existing } = await admin
      .from("knowledge_documents")
      .select("id, extraction_status, chunk_count")
      .eq("user_id", userId)
      .eq("connection_id", body.connection_id)
      .eq("source_type", body.source_type)
      .eq("external_id", body.external_id)
      .maybeSingle();

    if (existing && existing.extraction_status === "completed") {
      return new Response(JSON.stringify({
        document_id: existing.id, status: "completed", skipped: true, chunk_count: existing.chunk_count,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Build Graph endpoint
    let endpoint = "";
    let api: "mail" | "onedrive" | "sharepoint" = "mail";
    if (body.source_type === "mail_attachment") {
      if (!body.message_id || !body.attachment_id) throw new Error("message_id + attachment_id required");
      endpoint = `/me/messages/${encodeURIComponent(body.message_id)}/attachments/${encodeURIComponent(body.attachment_id)}/$value`;
      api = "mail";
    } else if (body.source_type === "onedrive") {
      if (!body.drive_item_id) throw new Error("drive_item_id required");
      endpoint = `/me/drive/items/${encodeURIComponent(body.drive_item_id)}/content`;
      api = "onedrive";
    } else if (body.source_type === "sharepoint") {
      if (!body.drive_id || !body.item_id) throw new Error("drive_id + item_id required");
      endpoint = `/drives/${encodeURIComponent(body.drive_id)}/items/${encodeURIComponent(body.item_id)}/content`;
      api = "sharepoint";
    } else {
      throw new Error(`Unsupported source_type: ${body.source_type}`);
    }

    const mime = mimeFromName(body.title, body.mime_type);
    if (!SUPPORTED_MIME.has(mime)) {
      // record a skipped row so we don't repeatedly try
      const { data: row } = await admin.from("knowledge_documents").upsert({
        user_id: userId, organization_id: organizationId, connection_id: body.connection_id,
        title: body.title, source_type: body.source_type, source_ref: body.source_ref || null,
        external_id: body.external_id,
        content: "", chunk_count: 0,
        metadata: { mime_type: mime, ...(body.extra_metadata || {}) },
        extracted_metadata: {},
        extraction_status: "skipped",
        extraction_error: `Unsupported mime: ${mime}`,
        status: "indexed",
      }, { onConflict: "user_id,connection_id,source_type,external_id" }).select("id").single();
      return new Response(JSON.stringify({ document_id: row?.id, status: "skipped", reason: "unsupported_mime", mime }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Create / claim row in extracting state
    const { data: claim, error: claimErr } = await admin.from("knowledge_documents").upsert({
      user_id: userId, organization_id: organizationId, connection_id: body.connection_id,
      title: body.title, source_type: body.source_type, source_ref: body.source_ref || null,
      external_id: body.external_id,
      content: "",
      metadata: { mime_type: mime, ...(body.extra_metadata || {}) },
      extraction_status: "extracting",
      status: "processing",
    }, { onConflict: "user_id,connection_id,source_type,external_id" }).select("id").single();
    if (claimErr || !claim) throw new Error(`Claim row failed: ${claimErr?.message}`);
    documentId = claim.id;

    // Download
    const dl = await callGraphBinary(userId, body.connection_id, api, endpoint, MAX_BYTES);
    if (!dl.ok || !dl.bytes) {
      throw new Error(`Download failed: ${dl.error?.code} ${dl.error?.message}`);
    }

    // Extract
    const rawText = await extractText(dl.bytes, mime, body.title);
    if (!rawText || rawText.trim().length < MIN_TEXT_CHARS) {
      await admin.from("knowledge_documents").update({
        extraction_status: "skipped", extraction_error: "Empty or unreadable text",
        status: "indexed", chunk_count: 0,
      }).eq("id", documentId);
      return new Response(JSON.stringify({ document_id: documentId, status: "skipped", reason: "empty_text" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Metadata (invoice-style)
    const extractedMeta = extractInvoiceMetadata(rawText);

    // Chunk + embed
    const chunks = chunkText(rawText);
    if (!chunks.length) throw new Error("No chunks produced");

    const allEmb: number[][] = [];
    for (let i = 0; i < chunks.length; i += 100) {
      const batch = chunks.slice(i, i + 100);
      const emb = await embedBatch(batch);
      allEmb.push(...emb);
    }

    // Wipe any old chunks for this document (idempotent re-runs)
    await admin.from("knowledge_chunks").delete().eq("document_id", documentId);

    const rows = chunks.map((content, idx) => ({
      document_id: documentId,
      user_id: userId,
      organization_id: organizationId,
      connection_id: body.connection_id,
      chunk_index: idx,
      content,
      embedding: allEmb[idx] as unknown as string,
      token_count: Math.ceil(content.length / 4),
    }));
    for (let i = 0; i < rows.length; i += 50) {
      const { error: chunkErr } = await admin.from("knowledge_chunks").insert(rows.slice(i, i + 50));
      if (chunkErr) throw new Error(`Chunk insert: ${chunkErr.message}`);
    }

    await admin.from("knowledge_documents").update({
      content: rawText.slice(0, 200000),
      chunk_count: chunks.length,
      extracted_metadata: extractedMeta,
      extraction_status: "completed",
      extraction_error: null,
      status: "indexed",
      indexed_at: new Date().toISOString(),
    }).eq("id", documentId);

    return new Response(JSON.stringify({
      document_id: documentId,
      status: "completed",
      chunk_count: chunks.length,
      bytes: dl.bytes.byteLength,
      extracted_metadata: extractedMeta,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("m365-extract-file error:", e);
    if (documentId && admin) {
      await admin.from("knowledge_documents").update({
        extraction_status: "failed",
        extraction_error: e instanceof Error ? e.message : String(e),
        status: "failed",
        error_message: e instanceof Error ? e.message : String(e),
      }).eq("id", documentId);
    }
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error", document_id: documentId }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
