// unanet-search — LIVE, narrow lookups for AI Chat.
// Only endpoints in the shared client's read allowlist are reachable; anything
// else raises UnanetSecurityError and is logged as an anomaly.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import {
  CORS_HEADERS, adminClient, requireSession, enforceGates, handleError, json,
  getUnanetClientForOrg,
} from '../_shared/unanet.ts';

const KIND_MAP: Record<string, { path: string; buildBody: (q: string) => Record<string, unknown> }> = {
  projects: { path: '/platform/projects/search', buildBody: (q) => ({ nameContains: q }) },
  timesheets: { path: '/platform/timesheets/search', buildBody: (q) => ({ notesContains: q }) },
  invoices: { path: '/platform/invoices/search', buildBody: (q) => ({ numberContains: q }) },
  employees: { path: '/platform/employees/search', buildBody: (q) => ({ nameContains: q }) },
  customers: { path: '/platform/customers/search', buildBody: (q) => ({ nameContains: q }) },
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  try {
    const session = await requireSession(req);
    const admin = adminClient();
    await enforceGates(admin, session);

    const body = await req.json().catch(() => ({}));
    const query = String(body?.query ?? '').trim();
    const kind = String(body?.kind ?? 'projects');
    const count = Math.min(50, Math.max(1, Number(body?.count ?? 10)));

    if (kind === 'dashboard_summary') {
      // Summarise from our synced records; do NOT hit Unanet on page load.
      const { data: rows } = await admin
        .from('unanet_records')
        .select('record_type, business_date')
        .eq('organization_id', session.organizationId);
      const summary = {
        active_projects: rows?.filter((r) => r.record_type === 'project').length ?? 0,
        open_timesheets: rows?.filter((r) => r.record_type === 'timesheet').length ?? 0,
        pending_approvals: 0, // to be refined once approval endpoints are surfaced
        utilization_pct: null as number | null,
      };
      return json({ summary });
    }

    const spec = KIND_MAP[kind];
    if (!spec) return json({ error: `unknown kind: ${kind}`, results: [] }, 400);
    if (!query) return json({ results: [] });

    const client = await getUnanetClientForOrg(admin, session.organizationId);
    const resp = await client.post(spec.path, { ...spec.buildBody(query), offset: 0, limit: count });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return json({ error: `Unanet ${spec.path} HTTP ${resp.status}: ${text.slice(0, 200)}`, results: [] }, resp.status);
    }
    const j = await resp.json().catch(() => ({} as any));
    const results = (j?.results ?? []).slice(0, count).map((r: any) => ({
      title: r?.name ?? r?.number ?? r?.id ?? '(unnamed)',
      snippet: [r?.description, r?.status, r?.customer?.name].filter(Boolean).join(' — '),
    }));
    return json({ kind, query, count, results, domain: client.baseUrl });
  } catch (e) {
    return handleError(e);
  }
});
