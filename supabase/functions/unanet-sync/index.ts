// unanet-sync — pull a bounded business-date window from Unanet and upsert
// into public.unanet_records. Idempotent by (organization_id, record_type, unanet_id).
// Guardrails:
//   - Read-only paths only (enforced by shared client's allowlist).
//   - Hard cap on total records per run.
//   - Records sync run in unanet_sync_runs.
// Triggered by:
//   - pg_cron nightly, or
//   - manual "Refresh now" from the admin UI, or
//   - post-connect kickoff.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import {
  CORS_HEADERS, adminClient, requireSession, enforceGates, handleError, json,
  getUnanetClientForOrg,
} from '../_shared/unanet.ts';

const MAX_RECORDS_PER_RUN = 20_000;   // hard guardrail
const WINDOW_DAYS = 62;               // current + prior accounting period

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  try {
    const url = new URL(req.url);
    const cronKey = req.headers.get('x-cron-key');

    // Two entry modes: (a) authenticated org admin -> current org only,
    //                  (b) internal cron with CRON_SECRET -> all orgs.
    if (cronKey && cronKey === Deno.env.get('CRON_SECRET')) {
      const admin = adminClient();
      const { data: orgs } = await admin
        .from('unanet_connections')
        .select('organization_id')
        .eq('status', 'active');
      const results: Record<string, unknown> = {};
      for (const { organization_id } of orgs ?? []) {
        try {
          results[organization_id] = await runSyncForOrg(organization_id, 'cron');
        } catch (e) {
          results[organization_id] = { error: e instanceof Error ? e.message : 'unknown error' };
        }
      }
      return json({ ok: true, results });
    }

    const session = await requireSession(req);
    const admin = adminClient();
    await enforceGates(admin, session);

    const body = await req.json().catch(() => ({}));
    const triggeredBy = body?.reason === 'connect' ? 'connect' : 'manual';
    const result = await runSyncForOrg(session.organizationId, triggeredBy as 'manual' | 'connect');
    return json(result);
  } catch (e) {
    return handleError(e);
  }
});

async function runSyncForOrg(organizationId: string, triggeredBy: 'cron' | 'manual' | 'connect') {
  const admin = adminClient();
  const today = new Date();
  const windowStart = new Date(today.getTime() - WINDOW_DAYS * 24 * 3600 * 1000);
  const startISO = windowStart.toISOString().slice(0, 10);
  const endISO = today.toISOString().slice(0, 10);

  const { data: runRow, error: runErr } = await admin
    .from('unanet_sync_runs')
    .insert({
      organization_id: organizationId,
      triggered_by: triggeredBy,
      status: 'running',
      window_start: startISO,
      window_end: endISO,
    })
    .select('id')
    .single();
  if (runErr) throw new Error(runErr.message);
  const runId = runRow!.id;

  let upserted = 0;
  let capped = false;
  let status: 'success' | 'partial' | 'failed' = 'success';
  let errMsg: string | null = null;

  try {
    const client = await getUnanetClientForOrg(admin, organizationId);

    // Sync sources. Each block is wrapped so one endpoint failing degrades
    // the run to "partial" instead of failing the whole sync.
    const remaining = () => MAX_RECORDS_PER_RUN - upserted;

    async function syncSource(recordType: string, path: string, body: Record<string, unknown>, pickId: (r: any) => string, pickDate?: (r: any) => string | null) {
      if (remaining() <= 0) { capped = true; return; }
      try {
        const { results, capped: pageCapped } = await client.searchAll(path, body, { maxRecords: remaining() });
        if (pageCapped) capped = true;
        if (!results.length) return;
        const rows = results.map((r) => ({
          organization_id: organizationId,
          record_type: recordType,
          unanet_id: pickId(r),
          payload: r,
          business_date: pickDate ? pickDate(r) : null,
          synced_at: new Date().toISOString(),
        })).filter((row) => row.unanet_id);

        // upsert in chunks to keep request bodies reasonable
        for (let i = 0; i < rows.length; i += 500) {
          const chunk = rows.slice(i, i + 500);
          const { error } = await admin
            .from('unanet_records')
            .upsert(chunk, { onConflict: 'organization_id,record_type,unanet_id' });
          if (error) throw new Error(`${recordType} upsert failed: ${error.message}`);
          upserted += chunk.length;
        }
      } catch (e) {
        console.warn(`[unanet-sync] ${recordType} skipped:`, e instanceof Error ? e.message : e);
        status = 'partial';
      }
    }

    await syncSource(
      'project',
      '/platform/projects/search',
      { modifiedFrom: startISO, modifiedTo: endISO },
      (r) => String(r?.id ?? r?.projectId ?? ''),
      (r) => r?.modifiedDate ?? r?.startDate ?? null,
    );
    await syncSource(
      'timesheet',
      '/platform/timesheets/search',
      { dateFrom: startISO, dateTo: endISO },
      (r) => String(r?.id ?? r?.timesheetId ?? ''),
      (r) => r?.workDate ?? r?.periodEnd ?? null,
    );
    await syncSource(
      'invoice',
      '/platform/invoices/search',
      { dateFrom: startISO, dateTo: endISO },
      (r) => String(r?.id ?? r?.invoiceId ?? ''),
      (r) => r?.invoiceDate ?? null,
    );
    await syncSource(
      'employee',
      '/platform/employees/search',
      { activeOnly: true },
      (r) => String(r?.id ?? r?.employeeId ?? ''),
      () => null,
    );

    // Mark the connection healthy on success.
    await admin
      .from('unanet_connections')
      .update({ status: 'active', last_verified_at: new Date().toISOString(), last_error: null })
      .eq('organization_id', organizationId);
  } catch (e) {
    status = 'failed';
    errMsg = e instanceof Error ? e.message : 'unknown error';
    await admin
      .from('unanet_connections')
      .update({ status: 'failing', last_error: errMsg })
      .eq('organization_id', organizationId);
  }

  await admin
    .from('unanet_sync_runs')
    .update({
      status,
      records_upserted: upserted,
      records_capped: capped,
      finished_at: new Date().toISOString(),
      error: errMsg,
    })
    .eq('id', runId);

  return { run_id: runId, status, records_upserted: upserted, capped, window: { start: startISO, end: endISO }, error: errMsg };
}
