// discover-tenant-users
// Pulls licensed users from a customer's Microsoft 365 tenant directory
// using app-only (client credentials) auth against Microsoft Graph, and
// upserts them into discovered_tenant_users. Super admin only.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPER_ADMIN_EMAIL = 'arahimi@energyforward.com';

interface AssignedPlan {
  service: string;
  capabilityStatus: string;
  servicePlanId?: string;
}

interface GraphUser {
  id: string;
  userPrincipalName: string | null;
  mail: string | null;
  displayName: string | null;
  jobTitle: string | null;
  department: string | null;
  officeLocation: string | null;
  accountEnabled: boolean;
  assignedLicenses: { skuId: string }[];
  assignedPlans?: AssignedPlan[];
  userType?: string | null;
}


// True if the user has an active Exchange Online (mailbox) service plan.
// This filters out Teams-only / Power BI-only / etc. licenses that cannot
// receive email and therefore should not be enabled in InboxIQ.
function hasActiveExchangeLicense(u: GraphUser): boolean {
  if (!Array.isArray(u.assignedPlans)) return false;
  return u.assignedPlans.some(
    (p) =>
      p.capabilityStatus === 'Enabled' &&
      typeof p.service === 'string' &&
      p.service.toLowerCase() === 'exchange',
  );
}

async function getAppOnlyToken(tenantId: string): Promise<{ token?: string; error?: string }> {
  const clientId = Deno.env.get('MICROSOFT_CLIENT_ID')?.trim();
  const clientSecret = Deno.env.get('MICROSOFT_CLIENT_SECRET')?.trim();
  if (!clientId || !clientSecret) {
    return { error: 'Microsoft client credentials are not configured' };
  }

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
    scope: 'https://graph.microsoft.com/.default',
  });

  const resp = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!resp.ok) {
    const txt = await resp.text();
    let errMsg = `Token request failed (${resp.status})`;
    try {
      const parsed = JSON.parse(txt);
      if (parsed.error_description) errMsg = parsed.error_description;
      if (parsed.error === 'invalid_client') {
        errMsg = 'Microsoft rejected the app credentials. Check MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET.';
      }
      if (parsed.error_codes?.includes?.(7000215)) {
        errMsg = 'Microsoft rejected the client secret value. Use the Azure secret Value, not the Secret ID.';
      }
      if (parsed.error_codes?.includes?.(700016)) {
        errMsg = 'Microsoft could not find this application in the target tenant. The frontend consent flow may be using a different app registration than the backend.';
      }
      if (parsed.error === 'unauthorized_client') {
        errMsg = 'The app does not have admin consent in this tenant. Ask the tenant admin to grant consent first.';
      }
    } catch { /* ignore */ }
    return { error: errMsg };
  }

  const data = await resp.json();
  return { token: data.access_token as string };
}

async function fetchAllUsers(token: string): Promise<{ users?: GraphUser[]; error?: string }> {
  const users: GraphUser[] = [];
  let url: string | null =
    'https://graph.microsoft.com/v1.0/users' +
    '?$select=id,userPrincipalName,mail,displayName,jobTitle,department,officeLocation,accountEnabled,assignedLicenses,assignedPlans,userType' +
    '&$top=999';


  while (url) {
    const resp: Response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, ConsistencyLevel: 'eventual' },
    });
    if (!resp.ok) {
      const txt = await resp.text();
      let errMsg = `Graph users call failed (${resp.status})`;
      try {
        const parsed = JSON.parse(txt);
        if (parsed?.error?.message) errMsg = parsed.error.message;
        if (parsed?.error?.code === 'Authorization_RequestDenied') {
          errMsg = 'The Azure app is missing the User.Read.All application permission, or admin consent has not been granted.';
        }
      } catch { /* ignore */ }
      return { error: errMsg };
    }
    const json: any = await resp.json();
    users.push(...(json.value as GraphUser[]));
    url = (json['@odata.nextLink'] as string | undefined) ?? null;
  }

  return { users };
}

// Fetch a user's profile photo from Graph and return a small data: URI we can
// store directly in the database. Returns null if the user has no photo or
// the app lacks User.ReadBasic.All / User.Read.All permission.
async function fetchUserPhotoDataUri(token: string, userId: string): Promise<string | null> {
  try {
    // 96x96 is the smallest sized photo Graph guarantees; falls back to default.
    const sizes = ['96x96', '120x120', '240x240'];
    for (const size of sizes) {
      const res = await fetch(
        `https://graph.microsoft.com/v1.0/users/${userId}/photos/${size}/$value`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (res.status === 404) continue; // try next size
      if (!res.ok) return null;
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length === 0) return null;
      // Encode to base64 in chunks to avoid stack overflow on large blobs.
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < buf.length; i += chunk) {
        binary += String.fromCharCode.apply(null, buf.subarray(i, i + chunk) as unknown as number[]);
      }
      const b64 = btoa(binary);
      const ct = res.headers.get('content-type') ?? 'image/jpeg';
      return `data:${ct};base64,${b64}`;
    }
    // Fallback: default photo endpoint
    const fallback = await fetch(
      `https://graph.microsoft.com/v1.0/users/${userId}/photo/$value`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!fallback.ok) return null;
    const buf = new Uint8Array(await fallback.arrayBuffer());
    if (buf.length === 0) return null;
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < buf.length; i += chunk) {
      binary += String.fromCharCode.apply(null, buf.subarray(i, i + chunk) as unknown as number[]);
    }
    const ct = fallback.headers.get('content-type') ?? 'image/jpeg';
    return `data:${ct};base64,${btoa(binary)}`;
  } catch (err) {
    console.warn(`fetchUserPhotoDataUri(${userId}) failed:`, err);
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user: caller } } = await adminClient.auth.getUser(token);
    if (!caller?.email || caller.email.toLowerCase() !== SUPER_ADMIN_EMAIL) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { domain_id } = await req.json();
    if (!domain_id) {
      return new Response(JSON.stringify({ error: 'domain_id is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { data: domain, error: dErr } = await adminClient
      .from('allowed_domains')
      .select('id, domain, organization_name, microsoft_tenant_id, microsoft_consent_granted')
      .eq('id', domain_id)
      .maybeSingle();

    if (dErr || !domain) {
      return new Response(JSON.stringify({ error: 'Domain not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!domain.microsoft_tenant_id) {
      return new Response(JSON.stringify({
        error: 'No Microsoft tenant id on this domain. Ask the tenant admin to complete authorization first.'
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (!domain.microsoft_consent_granted) {
      return new Response(JSON.stringify({
        error: 'Tenant admin consent has not been granted for this domain yet.'
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Resolve organization for this domain
    const orgName = domain.organization_name || domain.domain;
    let { data: org } = await adminClient
      .from('organizations').select('id').ilike('name', orgName).maybeSingle();
    if (!org) {
      const { data: created, error: oErr } = await adminClient
        .from('organizations').insert({ name: orgName }).select('id').single();
      if (oErr || !created) {
        return new Response(JSON.stringify({ error: `Failed to ensure organization: ${oErr?.message}` }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      org = created;
    }

    // Get app-only token for the customer's tenant
    const tokenRes = await getAppOnlyToken(domain.microsoft_tenant_id);
    if (tokenRes.error || !tokenRes.token) {
      return new Response(JSON.stringify({ error: tokenRes.error || 'Failed to obtain access token' }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Pull all users from Graph
    const usersRes = await fetchAllUsers(tokenRes.token);
    if (usersRes.error || !usersRes.users) {
      return new Response(JSON.stringify({ error: usersRes.error || 'Failed to fetch tenant users' }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Filter: active members on the matching domain who can receive mail.
    // We accept the user if ANY of these mailbox signals is present:
    //   - they have an Exchange Online service plan, OR
    //   - Microsoft populated the `mail` field (a real mailbox), OR
    //   - they have at least one assigned license (Business Basic, E3, etc.)
    // This avoids silently dropping legitimately licensed users when their
    // assignedPlans payload is incomplete or uses a non-standard SKU.
    const domainLower = domain.domain.toLowerCase();
    const filtered = usersRes.users.filter((u) => {
      const email = (u.mail || u.userPrincipalName || '').toLowerCase();
      if (!email.endsWith('@' + domainLower)) return false;
      if (u.userType && u.userType.toLowerCase() === 'guest') return false;
      if (!u.accountEnabled) return false;
      const hasMailbox = !!u.mail;
      const hasExchange = hasActiveExchangeLicense(u);
      const hasAnyLicense = Array.isArray(u.assignedLicenses) && u.assignedLicenses.length > 0;
      return hasMailbox || hasExchange || hasAnyLicense;
    });

    // Fetch profile photos in parallel with bounded concurrency so a 100-user
    // tenant doesn't blow the function timeout. Photos are stored as data URIs
    // so we don't need to round-trip through storage on every user load.
    const PHOTO_CONCURRENCY = 8;
    const photoByMsId = new Map<string, string | null>();
    for (let i = 0; i < filtered.length; i += PHOTO_CONCURRENCY) {
      const batch = filtered.slice(i, i + PHOTO_CONCURRENCY);
      const results = await Promise.all(
        batch.map((u) => fetchUserPhotoDataUri(tokenRes.token!, u.id).then((p) => [u.id, p] as const)),
      );
      for (const [id, photo] of results) photoByMsId.set(id, photo);
    }

    // Build payload — preserve existing invited_user_id / status by upserting on (domain_id, ms_user_id)
    const rows = filtered.map((u) => ({
      domain_id: domain.id,
      organization_id: org!.id,
      ms_user_id: u.id,
      email: (u.mail || u.userPrincipalName || '').toLowerCase(),
      display_name: u.displayName,
      job_title: u.jobTitle,
      profile_photo_url: photoByMsId.get(u.id) ?? null,
      is_licensed: true,
      account_enabled: u.accountEnabled,
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    if (rows.length > 0) {
      // Insert/update in chunks of 500 to be safe
      const chunkSize = 500;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const { error: upErr } = await adminClient
          .from('discovered_tenant_users')
          .upsert(chunk, { onConflict: 'domain_id,ms_user_id', ignoreDuplicates: false });
        if (upErr) {
          console.error('Upsert failed', upErr);
          return new Response(JSON.stringify({ error: `Failed to save discovered users: ${upErr.message}` }), {
            status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      }

      // Propagate the freshly-fetched photo + display_name + job_title onto any
      // user_profiles that already exist for these discovered accounts, so the
      // app sidebar avatar and email signature pick up the M365 photo on next
      // login without requiring the user to manually upload one.
      for (const r of rows) {
        await adminClient
          .from('user_profiles')
          .update({
            profile_photo_url: r.profile_photo_url,
            full_name: r.display_name ?? undefined,
            title: r.job_title ?? undefined,
          })
          .eq('email', r.email);
      }
    }

    await adminClient
      .from('allowed_domains')
      .update({ last_directory_sync_at: new Date().toISOString() })
      .eq('id', domain.id);

    // Diagnostics: count how many users matched the configured domain at all,
    // so the admin can tell the difference between "wrong domain" and "no licenses".
    const domainMatchCount = usersRes.users.filter((u) => {
      const email = (u.mail || u.userPrincipalName || '').toLowerCase();
      return email.endsWith('@' + domainLower);
    }).length;

    return new Response(JSON.stringify({
      success: true,
      total_in_tenant: usersRes.users.length,
      domain_matched: domainMatchCount,
      configured_domain: domain.domain,
      licensed_on_domain: filtered.length,
      synced_at: new Date().toISOString(),
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (e) {
    console.error('discover-tenant-users error', e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
