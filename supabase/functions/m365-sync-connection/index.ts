// m365-sync-connection: per-connection delta sync for mail attachments + OneDrive files.
// Triggered by m365-sync-all (cron) or directly from the admin panel.
//
// Auth: caller must present the service-role bearer plus
//   x-internal-user-id  (uuid)  and JSON body { connection_id, sources?, sync_type? }
// OR be a logged-in user invoking with their own JWT (the function will validate ownership).
//
// Sources implemented: 'mail' (attachment polling, $top=50 newest with hasAttachments=true),
// 'onedrive' (Graph delta on /me/drive/root). 'sharepoint' is a no-op stub for now.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callGraph } from "../_shared/graph-call.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-user-id",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAIL_PAGE_SIZE = 50;
const ONEDRIVE_MAX_PAGES = 20; // safety cap per run (~5000 items max)
const EXTRACT_CONCURRENCY = 3;

type Source = "mail" | "onedrive" | "sharepoint";
type SyncType = "full" | "delta" | "manual";

interface SyncBody {
  connection_id: string;
  sources?: Source[];
  sync_type?: SyncType;
  force_full?: boolean;
}

async function resolveUser(req: Request): Promise<{ userId: string; admin: ReturnType<typeof createClient> } | Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const token = authHeader.slice(7);
  const internalUserId = req.headers.get("x-internal-user-id");
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  if (token === SUPABASE_SERVICE_ROLE_KEY && internalUserId) {
    return { userId: internalUserId, admin };
  }
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data?.user) {
    return new Response(JSON.stringify({ error: "Invalid token" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  return { userId: data.user.id, admin };
}

async function invokeExtract(userId: string, payload: Record<string, any>): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/m365-extract-file`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "x-internal-user-id": userId,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `extract ${res.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function processWithConcurrency<T>(items: T[], limit: number, worker: (it: T) => Promise<void>) {
  let i = 0;
  const runners: Promise<void>[] = [];
  const next = async () => {
    while (i < items.length) {
      const idx = i++;
      try { await worker(items[idx]); } catch { /* swallow per-item */ }
    }
  };
  for (let k = 0; k < Math.min(limit, items.length); k++) runners.push(next());
  await Promise.all(runners);
}

/** Sync mail attachments for the inbox (best-effort delta-ish poll). */
async function syncMail(userId: string, connectionId: string, admin: any, force: boolean) {
  let processed = 0, failed = 0;
  // Get last_sync_at for incremental filter.
  const { data: state } = await admin.from("m365_sync_state")
    .select("last_sync_at").eq("connection_id", connectionId).eq("source", "mail").maybeSingle();
  const since = !force && state?.last_sync_at ? new Date(state.last_sync_at).toISOString() : null;

  const filterParts = ["hasAttachments eq true"];
  if (since) filterParts.push(`receivedDateTime ge ${since}`);
  const endpoint =
    `/me/mailFolders/inbox/messages?$top=${MAIL_PAGE_SIZE}` +
    `&$select=id,subject,from,receivedDateTime,hasAttachments` +
    `&$orderby=receivedDateTime desc` +
    `&$filter=${encodeURIComponent(filterParts.join(" and "))}`;

  const res = await callGraph<{ value: any[] }>(userId, connectionId, "mail", endpoint);
  if (!res.ok) {
    if (res.error?.kind === "rate_limited") throw new Error("RATE_LIMITED");
    throw new Error(`mail list failed: ${res.error?.code} ${res.error?.message}`);
  }
  const messages = res.data?.value ?? [];

  // For each message, list attachments and enqueue extract for each supported file.
  const tasks: Array<{ msg: any; att: any }> = [];
  for (const msg of messages) {
    const ar = await callGraph<{ value: any[] }>(
      userId, connectionId, "mail",
      `/me/messages/${encodeURIComponent(msg.id)}/attachments?$select=id,name,contentType,size,@odata.type`
    );
    if (!ar.ok) { failed++; continue; }
    for (const att of ar.data?.value ?? []) {
      // Skip inline / item attachments
      if (att["@odata.type"] && !att["@odata.type"].includes("fileAttachment")) continue;
      tasks.push({ msg, att });
    }
  }

  await processWithConcurrency(tasks, EXTRACT_CONCURRENCY, async ({ msg, att }) => {
    const r = await invokeExtract(userId, {
      connection_id: connectionId,
      source_type: "mail_attachment",
      external_id: `${msg.id}:${att.id}`,
      title: att.name || "attachment",
      mime_type: att.contentType,
      message_id: msg.id,
      attachment_id: att.id,
      source_ref: msg.id,
      extra_metadata: {
        subject: msg.subject,
        from: msg.from?.emailAddress?.address,
        received: msg.receivedDateTime,
        size: att.size,
      },
    });
    if (r.ok) processed++; else failed++;
  });

  // Update state
  await admin.from("m365_sync_state").upsert({
    user_id: userId, connection_id: connectionId, source: "mail",
    last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }, { onConflict: "connection_id,source" });

  return { processed, failed };
}

/** Sync OneDrive root using Graph delta. */
async function syncOneDrive(userId: string, connectionId: string, admin: any, force: boolean) {
  let processed = 0, failed = 0;

  const { data: state } = await admin.from("m365_sync_state")
    .select("delta_link").eq("connection_id", connectionId).eq("source", "onedrive").maybeSingle();
  let url: string | null = force || !state?.delta_link
    ? "/me/drive/root/delta?$select=id,name,file,folder,deleted,parentReference,size,lastModifiedDateTime"
    : state.delta_link;

  let nextDelta: string | null = null;
  const tasks: any[] = [];
  const deletedIds: string[] = [];

  for (let page = 0; page < ONEDRIVE_MAX_PAGES && url; page++) {
    // Delta links from Graph come as absolute URLs; convert to path-only for callGraph.
    const pathOnly = url.startsWith("https://graph.microsoft.com/v1.0")
      ? url.slice("https://graph.microsoft.com/v1.0".length)
      : url;
    const res = await callGraph<any>(userId, connectionId, "onedrive", pathOnly);
    if (!res.ok) {
      if (res.error?.kind === "rate_limited") throw new Error("RATE_LIMITED");
      throw new Error(`onedrive delta failed: ${res.error?.code} ${res.error?.message}`);
    }
    const value = res.data?.value ?? [];
    for (const item of value) {
      if (item.deleted) { deletedIds.push(item.id); continue; }
      if (!item.file) continue; // skip folders
      tasks.push(item);
    }
    if (res.data?.["@odata.deltaLink"]) {
      nextDelta = res.data["@odata.deltaLink"];
      url = null;
    } else if (res.data?.["@odata.nextLink"]) {
      url = res.data["@odata.nextLink"];
    } else {
      url = null;
    }
  }

  // Cascade-delete removed items from knowledge_documents
  if (deletedIds.length) {
    await admin.from("knowledge_documents").delete()
      .eq("user_id", userId).eq("connection_id", connectionId).eq("source_type", "onedrive")
      .in("external_id", deletedIds);
  }

  await processWithConcurrency(tasks, EXTRACT_CONCURRENCY, async (item: any) => {
    const r = await invokeExtract(userId, {
      connection_id: connectionId,
      source_type: "onedrive",
      external_id: item.id,
      title: item.name || "file",
      mime_type: item.file?.mimeType,
      drive_item_id: item.id,
      source_ref: item.parentReference?.path || null,
      extra_metadata: {
        size: item.size,
        modified: item.lastModifiedDateTime,
        parent: item.parentReference?.path,
      },
    });
    if (r.ok) processed++; else failed++;
  });

  await admin.from("m365_sync_state").upsert({
    user_id: userId, connection_id: connectionId, source: "onedrive",
    delta_link: nextDelta ?? state?.delta_link ?? null,
    last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }, { onConflict: "connection_id,source" });

  return { processed, failed, deleted: deletedIds.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const resolved = await resolveUser(req);
  if (resolved instanceof Response) return resolved;
  const { userId, admin } = resolved;

  let body: SyncBody;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!body?.connection_id) {
    return new Response(JSON.stringify({ error: "connection_id required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Verify ownership
  const { data: conn } = await admin.from("provider_connections")
    .select("id,user_id,provider,is_connected").eq("id", body.connection_id).maybeSingle();
  if (!conn || conn.user_id !== userId) {
    return new Response(JSON.stringify({ error: "Connection not found" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sources: Source[] = body.sources?.length ? body.sources : ["mail", "onedrive"];
  const syncType: SyncType = body.sync_type ?? "delta";
  const force = !!body.force_full || syncType === "full";
  const results: Record<string, any> = {};

  for (const source of sources) {
    const { data: job } = await admin.from("m365_sync_jobs").insert({
      user_id: userId, connection_id: body.connection_id, source, sync_type: syncType,
      status: "running", started_at: new Date().toISOString(),
    }).select("id").single();

    try {
      let r: any = { processed: 0, failed: 0 };
      if (source === "mail") r = await syncMail(userId, body.connection_id, admin, force);
      else if (source === "onedrive") r = await syncOneDrive(userId, body.connection_id, admin, force);
      else if (source === "sharepoint") r = { processed: 0, failed: 0, note: "not_implemented" };

      await admin.from("m365_sync_jobs").update({
        status: "complete", items_processed: r.processed, items_failed: r.failed,
        completed_at: new Date().toISOString(),
      }).eq("id", job!.id);
      results[source] = r;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const rateLimited = msg === "RATE_LIMITED";
      await admin.from("m365_sync_jobs").update({
        status: "failed", error_message: msg,
        retry_after: rateLimited ? new Date(Date.now() + 60_000).toISOString() : null,
        completed_at: new Date().toISOString(),
      }).eq("id", job!.id);
      results[source] = { error: msg };
    }
  }

  return new Response(JSON.stringify({ ok: true, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
