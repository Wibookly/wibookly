// chat-agent — SSE adapter between the /chat UI (chat_conversations + chat_messages)
// and the agent-orchestrator tool loop (ai_chat_conversations + ai_chat_messages).
//
// Why this exists:
// - /chat persists into chat_conversations/chat_messages and expects SSE streaming
//   (`conversation`, `token`, `blocked`, `done`, `error`).
// - agent-orchestrator persists into ai_chat_conversations/ai_chat_messages and
//   returns a single JSON blob.
// This adapter keeps the user-facing tables and SSE contract stable while
// delegating reasoning + tool use to agent-orchestrator. The two conversation
// IDs are stitched together via chat_conversations.agent_conversation_id.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

interface AttachmentRef { path: string; name: string; mime_type?: string }

interface Body {
  message: string;
  conversation_id?: string | null;
  connectionId?: string | null;
  connection_id?: string | null;
  folder_id?: string | null;
  attachments?: string[];
  attachment_refs?: AttachmentRef[];
  stream?: boolean;
  web_search?: boolean;
  deep?: boolean;
  user_location?: { city?: string; region?: string; country?: string; timezone?: string };
}

function sseEvent(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return new Response(JSON.stringify({ error: "Invalid token" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const user = userData.user;

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const message = (body.message || "").trim();
  const connection_id = body.connection_id || body.connectionId || null;
  if (!message) {
    return new Response(JSON.stringify({ error: "message required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!connection_id) {
    return new Response(JSON.stringify({ error: "No active Microsoft 365 connection. Connect from Integrations to chat with your inbox and files." }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Resolve org
  const { data: profile } = await admin
    .from("user_profiles")
    .select("organization_id")
    .eq("user_id", user.id)
    .maybeSingle();
  const organization_id = profile?.organization_id;
  if (!organization_id) {
    return new Response(JSON.stringify({ error: "No organization assigned" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Load or create conversation in the user-facing table
  let conversation_id = body.conversation_id || null;
  let agent_conversation_id: string | null = null;

  if (conversation_id) {
    const { data: conv } = await admin
      .from("chat_conversations")
      .select("id, agent_conversation_id, user_id")
      .eq("id", conversation_id)
      .maybeSingle();
    if (!conv || conv.user_id !== user.id) {
      return new Response(JSON.stringify({ error: "Conversation not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    agent_conversation_id = conv.agent_conversation_id ?? null;
  } else {
    const { data: conv, error: convErr } = await admin
      .from("chat_conversations")
      .insert({
        user_id: user.id,
        organization_id,
        folder_id: body.folder_id ?? null,
        title: message.slice(0, 60),
      })
      .select("id")
      .single();
    if (convErr || !conv) {
      return new Response(JSON.stringify({ error: convErr?.message || "Could not create conversation" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    conversation_id = conv.id;
  }

  // Persist user message immediately (UI shows it via reload after stream completes)
  await admin.from("chat_messages").insert({
    conversation_id,
    user_id: user.id,
    role: "user",
    content: message,
    attachments: body.attachments && body.attachments.length ? body.attachments : null,
  });

  // Build SSE stream
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (d: unknown) => controller.enqueue(enc.encode(sseEvent(d)));

      try {
        send({ type: "conversation", conversation_id });
        send({ type: "phase", label: "Thinking" });

        // Extract text from uploaded attachments so the model can actually read them.
        let augmentedMessage = message;
        const refs = Array.isArray(body.attachment_refs) ? body.attachment_refs : [];
        if (refs.length) {
          send({ type: "phase", label: `Reading ${refs.length} attached file${refs.length > 1 ? 's' : ''}` });
          const { extractAttachmentText } = await import("../_shared/extract-attachment-text.ts");
          const MAX_CHARS_PER_FILE = 40000;
          const blocks: string[] = [];
          for (const ref of refs) {
            try {
              const { data: blob, error: dlErr } = await admin.storage
                .from("chat-attachments")
                .download(ref.path);
              if (dlErr || !blob) throw new Error(dlErr?.message || "download failed");
              const bytes = new Uint8Array(await blob.arrayBuffer());
              const raw = await extractAttachmentText(bytes, ref.mime_type || blob.type || "", ref.name);
              const cleaned = (raw || "").replace(/\r\n/g, "\n").trim();
              if (!cleaned) {
                blocks.push(`[Attached file: ${ref.name}] (no extractable text)`);
                continue;
              }
              const truncated = cleaned.length > MAX_CHARS_PER_FILE
                ? cleaned.slice(0, MAX_CHARS_PER_FILE) + `\n\n…[truncated, ${cleaned.length - MAX_CHARS_PER_FILE} more chars]`
                : cleaned;
              blocks.push(`[Attached file: ${ref.name}]\n${truncated}`);
            } catch (e) {
              blocks.push(`[Attached file: ${ref.name}] (could not read: ${(e as Error).message})`);
            }
          }
          if (blocks.length) {
            augmentedMessage =
              `The user attached ${blocks.length} file(s). Use their contents as primary context when answering.\n\n` +
              blocks.join("\n\n---\n\n") +
              `\n\n---\nUser message:\n${message}`;
          }
        }

        // Announce the upcoming work so the UI can show a meaningful phase label.
        if (body.deep) {
          send({ type: "phase", label: "Researching deeply" });
        } else if (body.web_search) {
          send({ type: "phase", label: "Searching the web" });
        } else {
          send({ type: "phase", label: "Searching your workspace" });
        }


        // Invoke the agent orchestrator (non-streaming). Pass the linked agent
        // conversation_id so its own tool-call history stays continuous across
        // turns within the same /chat thread.
        const orchResp = await fetch(`${SUPABASE_URL}/functions/v1/agent-orchestrator`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: authHeader,
            apikey: ANON_KEY,
          },
          body: JSON.stringify({
            agent: "qa",
            connection_id,
            user_message: augmentedMessage,
            conversation_id: agent_conversation_id || undefined,
            web_search: !!body.web_search,
            deep: !!body.deep,
            user_location: body.user_location || undefined,
          }),
        });

        const orchText = await orchResp.text();
        let orch: any = {};
        try { orch = JSON.parse(orchText); } catch { orch = { error: orchText.slice(0, 500) }; }

        if (!orchResp.ok || orch.error) {
          if (orch.blocked) {
            send({ type: "blocked", reason: orch.reason || "Daily limit reached" });
          } else {
            send({ type: "error", message: orch.error || `agent ${orchResp.status}` });
          }
          send({ type: "done" });
          controller.close();
          return;
        }

        // Save the orchestrator conversation id back so future turns stay linked.
        if (orch.conversation_id && orch.conversation_id !== agent_conversation_id) {
          await admin
            .from("chat_conversations")
            .update({ agent_conversation_id: orch.conversation_id, updated_at: new Date().toISOString() })
            .eq("id", conversation_id);
        } else {
          await admin
            .from("chat_conversations")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", conversation_id);
        }

        const reply: string = orch.reply || "";
        const citations = Array.isArray(orch.citations) ? orch.citations : [];

        // Chunk the reply so the existing typing-effect UX keeps working even
        // though the orchestrator is non-streaming. ~24 char chunks with a tiny
        // delay produces a smooth flow without dragging out long answers.
        const CHUNK = 24;
        for (let i = 0; i < reply.length; i += CHUNK) {
          send({ type: "token", content: reply.slice(i, i + CHUNK) });
          if (i % (CHUNK * 4) === 0) {
            await new Promise((r) => setTimeout(r, 12));
          }
        }

        if (citations.length) {
          send({ type: "citations", citations });
        }

        // Persist assistant message with citations
        await admin.from("chat_messages").insert({
          conversation_id,
          user_id: user.id,
          role: "assistant",
          content: reply,
          model_used: orch.model || null,
          prompt_tokens: orch.usage?.tokens_in ?? null,
          completion_tokens: orch.usage?.tokens_out ?? null,
          citations: citations.length ? citations : null,
        });

        // Mirror the full transcript to the user's OneDrive › "InboxIQ Chat".
        // Best-effort: failure (missing scope, no token) must not break chat.
        try {
          const { data: convRow } = await admin
            .from("chat_conversations")
            .select("title")
            .eq("id", conversation_id)
            .maybeSingle();
          const { data: msgs } = await admin
            .from("chat_messages")
            .select("role, content, created_at, citations")
            .eq("conversation_id", conversation_id)
            .order("created_at", { ascending: true });

          const baseName = (convRow?.title || "InboxIQ Chat").slice(0, 80);
          const md =
            `# ${baseName}\n\n` +
            (msgs || [])
              .map((m: any) => {
                const who = m.role === "user" ? "**You**" : "**InboxIQ**";
                const ts = m.created_at ? ` _(${new Date(m.created_at).toISOString()})_` : "";
                return `### ${who}${ts}\n\n${m.content || ""}\n`;
              })
              .join("\n---\n\n");
          const json = JSON.stringify(
            { conversation_id, title: baseName, messages: msgs || [] },
            null,
            2,
          );

          const { saveToOneDrive } = await import("../_shared/onedrive-save.ts");
          const [mdRes, jsonRes] = await Promise.all([
            saveToOneDrive({
              userId: user.id,
              connectionId: connection_id,
              baseName,
              ext: "md",
              content: md,
              contentType: "text/markdown",
              subfolder: conversation_id!,
              overwrite: true,
            }),
            saveToOneDrive({
              userId: user.id,
              connectionId: connection_id,
              baseName,
              ext: "json",
              content: json,
              contentType: "application/json",
              subfolder: conversation_id!,
              overwrite: true,
            }),
          ]);
          if (mdRes.ok || jsonRes.ok) {
            send({
              type: "onedrive",
              md: mdRes.ok ? { path: mdRes.path, webUrl: mdRes.webUrl } : null,
              json: jsonRes.ok ? { path: jsonRes.path, webUrl: jsonRes.webUrl } : null,
            });
          } else {
            send({ type: "onedrive_error", message: mdRes.error || jsonRes.error || "OneDrive save failed" });
          }
        } catch (e) {
          send({ type: "onedrive_error", message: (e as Error).message });
        }

        send({ type: "done" });
        controller.close();
      } catch (e) {
        try { send({ type: "error", message: (e as Error).message }); send({ type: "done" }); } catch { }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
});
