import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface CreateUserInput {
  email: string;
  password: string;
  full_name: string;
  group_ids?: string[];
  domain_id?: string | null;
  auto_connect_microsoft?: boolean;
}

interface CreateUserResult {
  success: boolean;
  user_id?: string;
  error?: string;
}

async function createSingleUser(adminClient: SupabaseClient, input: CreateUserInput): Promise<CreateUserResult> {
  const email = input.email.trim().toLowerCase();
  const emailDomain = email.split('@')[1];
  if (!emailDomain) return { success: false, error: 'Invalid email' };
  if (!input.password || input.password.length < 6) return { success: false, error: 'Password must be at least 6 characters' };

  // Resolve target domain. If `domain_id` is supplied, use it (and validate the email matches).
  // Otherwise look it up by the email's domain part.
  let domainData: { id: string; domain: string; organization_name: string | null } | null = null;

  if (input.domain_id) {
    const { data } = await adminClient
      .from('allowed_domains')
      .select('id, domain, organization_name')
      .eq('id', input.domain_id)
      .eq('is_active', true)
      .maybeSingle();
    if (!data) return { success: false, error: 'Selected domain not found or inactive' };
    if (data.domain.toLowerCase() !== emailDomain) {
      return { success: false, error: `Email must end in @${data.domain}` };
    }
    domainData = data;
  } else {
    const { data } = await adminClient
      .from('allowed_domains')
      .select('id, domain, organization_name')
      .eq('domain', emailDomain)
      .eq('is_active', true)
      .maybeSingle();
    if (!data) return { success: false, error: `Domain ${emailDomain} is not authorized` };
    domainData = data;
  }

  // Find existing org for this domain (avoid duplicates)
  const orgName = domainData.organization_name || domainData.domain;
  let { data: org } = await adminClient
    .from('organizations')
    .select('id')
    .ilike('name', orgName)
    .maybeSingle();

  if (!org) {
    const { data: created, error: orgErr } = await adminClient
      .from('organizations')
      .insert({ name: orgName })
      .select('id')
      .single();
    if (orgErr) return { success: false, error: `Org create failed: ${orgErr.message}` };
    org = created;
  }

  const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    user_metadata: {
      full_name: input.full_name,
      // Marker read by the client after first sign-in to auto-launch the Outlook OAuth flow.
      auto_connect_microsoft: input.auto_connect_microsoft !== false,
      domain_id: domainData.id,
    },
  });
  if (createError || !newUser?.user) return { success: false, error: createError?.message || 'Failed to create auth user' };

  const userId = newUser.user.id;

  const rollback = async (reason: string): Promise<CreateUserResult> => {
    await adminClient.from('user_group_memberships').delete().eq('user_id', userId);
    await adminClient.from('user_roles').delete().eq('user_id', userId);
    await adminClient.from('organization_members').delete().eq('user_id', userId);
    await adminClient.from('user_profiles').delete().eq('user_id', userId);
    await adminClient.auth.admin.deleteUser(userId);
    return { success: false, error: reason };
  };

  const { error: profileErr } = await adminClient.from('user_profiles').insert({
    user_id: userId,
    email,
    full_name: input.full_name,
    organization_id: org!.id,
    domain_id: domainData.id,
  });
  if (profileErr) return await rollback(`Profile create failed: ${profileErr.message}`);

  const { error: memberErr } = await adminClient.from('organization_members').insert({
    user_id: userId, organization_id: org!.id, role: 'member',
  });
  if (memberErr) return await rollback(`Membership create failed: ${memberErr.message}`);

  const { error: roleErr } = await adminClient.from('user_roles').insert({
    user_id: userId, organization_id: org!.id, role: 'member',
  });
  if (roleErr) return await rollback(`Role create failed: ${roleErr.message}`);

  if (input.group_ids && input.group_ids.length > 0) {
    // Validate that each chosen group either belongs to this domain or is unscoped (global).
    const { data: validGroups } = await adminClient
      .from('permission_groups')
      .select('id, domain_id')
      .in('id', input.group_ids);
    const allowedGroupIds = (validGroups || [])
      .filter((g: any) => !g.domain_id || g.domain_id === domainData!.id)
      .map((g: any) => g.id);
    if (allowedGroupIds.length > 0) {
      const memberships = allowedGroupIds.map(gid => ({
        group_id: gid, user_id: userId, organization_id: org!.id,
      }));
      const { error: groupErr } = await adminClient.from('user_group_memberships').insert(memberships);
      if (groupErr) return await rollback(`Group assignment failed: ${groupErr.message}`);
    }
  }

  return { success: true, user_id: userId };
}



serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Verify the caller is the super admin
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const token = authHeader.replace('Bearer ', '');

    // Validate JWT locally via claims (resilient to server-side session invalidation
    // after key rotation — getUser() would fail with session_not_found in that case).
    let callerEmail: string | null = null;
    const { data: claimsData, error: claimsError } = await adminClient.auth.getClaims(token);
    if (!claimsError && claimsData?.claims?.email) {
      callerEmail = String(claimsData.claims.email).toLowerCase();
    } else {
      // Fallback to getUser for older tokens
      const { data: { user: caller }, error: authError } = await adminClient.auth.getUser(token);
      if (!authError && caller?.email) {
        callerEmail = caller.email.toLowerCase();
      }
    }

    if (!callerEmail) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Only super admin can use this
    if (callerEmail !== 'arahimi@energyforward.com') {
      return new Response(JSON.stringify({ error: 'Forbidden: Super admin access required' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { action, ...payload } = await req.json();

    switch (action) {
      case 'list_users': {
        // List all user profiles
        const { data: profiles, error } = await adminClient
          .from('user_profiles')
          .select('id, user_id, email, full_name, title, organization_id, domain_id, created_at')
          .order('created_at', { ascending: false });

        if (error) throw error;

        // Get feature access for all users
        const { data: features } = await adminClient
          .from('user_feature_access')
          .select('user_id, feature_key, is_enabled');

        // Get group memberships for all users
        const { data: memberships } = await adminClient
          .from('user_group_memberships')
          .select('user_id, group_id');

        // Get auth user metadata (disabled status)
        const { data: { users: authUsers } } = await adminClient.auth.admin.listUsers();

        const enrichedProfiles = (profiles || []).map((p: any) => {
          const authUser = authUsers?.find((u: any) => u.id === p.user_id);
          const userFeatures = (features || []).filter((f: any) => f.user_id === p.user_id);
          const userGroups = (memberships || []).filter((m: any) => m.user_id === p.user_id).map((m: any) => m.group_id);
          return {
            ...p,
            is_disabled: authUser?.banned_until ? new Date(authUser.banned_until) > new Date() : false,
            features: userFeatures,
            group_ids: userGroups,
          };
        });

        return new Response(JSON.stringify({ users: enrichedProfiles }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      case 'list_domains': {
        const { data: doms, error } = await adminClient
          .from('allowed_domains')
          .select('id, domain, organization_name, is_active')
          .order('domain');
        if (error) throw error;
        return new Response(JSON.stringify({ domains: doms || [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      case 'set_user_domain': {
        const { user_id, domain_id } = payload;
        if (!user_id) {
          return new Response(JSON.stringify({ error: 'user_id is required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        const { error } = await adminClient
          .from('user_profiles')
          .update({ domain_id: domain_id || null })
          .eq('user_id', user_id);
        if (error) throw error;
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }


      case 'create_user': {
        const { email, password, full_name, group_ids, domain_id, auto_connect_microsoft } = payload;
        if (!email || !password || !full_name) {
          return new Response(JSON.stringify({ error: 'email, password, and full_name are required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        const result = await createSingleUser(adminClient, { email, password, full_name, group_ids, domain_id, auto_connect_microsoft });
        if (!result.success) {
          return new Response(JSON.stringify({ error: result.error }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        return new Response(JSON.stringify({ success: true, user_id: result.user_id }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      case 'bulk_create_users': {
        const { users } = payload as { users: Array<CreateUserInput> };
        if (!Array.isArray(users) || users.length === 0) {
          return new Response(JSON.stringify({ error: 'users array is required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        if (users.length > 200) {
          return new Response(JSON.stringify({ error: 'Maximum 200 users per batch' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const results: Array<{ email: string; success: boolean; error?: string; user_id?: string }> = [];
        for (const u of users) {
          if (!u.email || !u.password || !u.full_name) {
            results.push({ email: u.email || '(missing)', success: false, error: 'Missing email, password, or full_name' });
            continue;
          }
          const r = await createSingleUser(adminClient, u);
          results.push({ email: u.email, success: r.success, error: r.error, user_id: r.user_id });
        }

        const successCount = results.filter(r => r.success).length;
        return new Response(JSON.stringify({ success: true, results, summary: { total: users.length, succeeded: successCount, failed: users.length - successCount } }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }



      case 'disable_user': {
        const { user_id } = payload;
        if (!user_id) {
          return new Response(JSON.stringify({ error: 'user_id is required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Ban until far future = disabled
        const { error } = await adminClient.auth.admin.updateUserById(user_id, {
          ban_duration: '876000h', // ~100 years
        });

        if (error) throw error;

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      case 'enable_user': {
        const { user_id } = payload;
        if (!user_id) {
          return new Response(JSON.stringify({ error: 'user_id is required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const { error } = await adminClient.auth.admin.updateUserById(user_id, {
          ban_duration: 'none',
        });

        if (error) throw error;

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      case 'reset_password': {
        const { user_id, new_password } = payload;
        if (!user_id || !new_password) {
          return new Response(JSON.stringify({ error: 'user_id and new_password are required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        if (new_password.length < 6) {
          return new Response(JSON.stringify({ error: 'Password must be at least 6 characters' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const { error: resetError } = await adminClient.auth.admin.updateUserById(user_id, {
          password: new_password,
        });

        if (resetError) throw resetError;

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      case 'delete_user': {
        const { user_id } = payload;
        if (!user_id) {
          return new Response(JSON.stringify({ error: 'user_id is required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Delete profile, memberships, roles first
        await adminClient.from('user_feature_access').delete().eq('user_id', user_id);
        await adminClient.from('user_roles').delete().eq('user_id', user_id);
        await adminClient.from('organization_members').delete().eq('user_id', user_id);
        await adminClient.from('user_profiles').delete().eq('user_id', user_id);

        // Delete auth user
        const { error } = await adminClient.auth.admin.deleteUser(user_id);
        if (error) throw error;

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      case 'set_feature': {
        const { user_id, feature_key, is_enabled } = payload;
        if (!user_id || !feature_key) {
          return new Response(JSON.stringify({ error: 'user_id and feature_key are required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Get user's org
        const { data: profile } = await adminClient
          .from('user_profiles')
          .select('organization_id')
          .eq('user_id', user_id)
          .single();

        if (!profile) {
          return new Response(JSON.stringify({ error: 'User profile not found' }), {
            status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const { error } = await adminClient
          .from('user_feature_access')
          .upsert({
            user_id,
            organization_id: profile.organization_id,
            feature_key,
            is_enabled,
            granted_by: caller.id,
          }, { onConflict: 'user_id,feature_key' });

        if (error) throw error;

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      case 'get_api_keys': {
        const { data: keys } = await adminClient
          .from('api_key_config')
          .select('key_name, updated_at');

        return new Response(JSON.stringify({ keys: keys || [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      case 'set_api_key': {
        const { key_name, key_value } = payload;
        if (!key_name || !key_value) {
          return new Response(JSON.stringify({ error: 'key_name and key_value are required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const allowedKeys = ['openai_api_key', 'claude_api_key'];
        if (!allowedKeys.includes(key_name)) {
          return new Response(JSON.stringify({ error: 'Invalid key_name' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const { error } = await adminClient
          .from('api_key_config')
          .upsert({
            key_name,
            encrypted_value: key_value,
            updated_by: caller.id,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'key_name' });

        if (error) throw error;

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      case 'delete_api_key': {
        const { key_name: delKeyName } = payload;
        if (!delKeyName) {
          return new Response(JSON.stringify({ error: 'key_name is required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const { error } = await adminClient
          .from('api_key_config')
          .delete()
          .eq('key_name', delKeyName);

        if (error) throw error;

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      case 'list_groups': {
        const { data: groups, error } = await adminClient
          .from('permission_groups')
          .select('id, name, description, organization_id, domain_id, created_at')
          .order('name');
        if (error) throw error;

        const { data: groupFeatures } = await adminClient
          .from('group_features')
          .select('group_id, feature_key, is_enabled');

        const { data: members } = await adminClient
          .from('user_group_memberships')
          .select('group_id, user_id');

        const enriched = (groups || []).map((g: any) => ({
          ...g,
          features: (groupFeatures || []).filter((f: any) => f.group_id === g.id),
          member_count: (members || []).filter((m: any) => m.group_id === g.id).length,
        }));

        return new Response(JSON.stringify({ groups: enriched }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      case 'create_group': {
        const { name, description, organization_id, domain_id } = payload;
        if (!name || !organization_id) {
          return new Response(JSON.stringify({ error: 'name and organization_id are required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        const { data, error } = await adminClient
          .from('permission_groups')
          .insert({
            name: name.trim(),
            description: description?.trim() || null,
            organization_id,
            domain_id: domain_id || null,
            created_by: caller.id,
          })
          .select()
          .single();
        if (error) {
          const msg = error.code === '23505' ? 'A group with that name already exists' : error.message;
          return new Response(JSON.stringify({ error: msg }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        return new Response(JSON.stringify({ success: true, group: data }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }


      case 'update_group': {
        const { group_id, name, description } = payload;
        if (!group_id) {
          return new Response(JSON.stringify({ error: 'group_id is required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        const update: Record<string, any> = {};
        if (name !== undefined) update.name = name.trim();
        if (description !== undefined) update.description = description?.trim() || null;
        const { error } = await adminClient
          .from('permission_groups')
          .update(update)
          .eq('id', group_id);
        if (error) throw error;
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      case 'delete_group': {
        const { group_id } = payload;
        if (!group_id) {
          return new Response(JSON.stringify({ error: 'group_id is required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        const { error } = await adminClient
          .from('permission_groups')
          .delete()
          .eq('id', group_id);
        if (error) throw error;
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      case 'set_group_feature': {
        const { group_id, feature_key, is_enabled } = payload;
        if (!group_id || !feature_key) {
          return new Response(JSON.stringify({ error: 'group_id and feature_key are required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        const { error } = await adminClient
          .from('group_features')
          .upsert({ group_id, feature_key, is_enabled: !!is_enabled }, { onConflict: 'group_id,feature_key' });
        if (error) throw error;
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      case 'set_user_groups': {
        const { user_id, group_ids } = payload as { user_id: string; group_ids: string[] };
        if (!user_id || !Array.isArray(group_ids)) {
          return new Response(JSON.stringify({ error: 'user_id and group_ids array are required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        const { data: profile } = await adminClient
          .from('user_profiles')
          .select('organization_id')
          .eq('user_id', user_id)
          .maybeSingle();
        if (!profile) {
          return new Response(JSON.stringify({ error: 'User profile not found' }), {
            status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Replace memberships
        await adminClient.from('user_group_memberships').delete().eq('user_id', user_id);
        if (group_ids.length > 0) {
          const rows = group_ids.map((gid: string) => ({
            group_id: gid, user_id, organization_id: profile.organization_id, created_by: caller.id,
          }));
          const { error } = await adminClient.from('user_group_memberships').insert(rows);
          if (error) throw error;
        }
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // ============================================================
      //  Discovered Tenant Users (M365 directory sync)
      // ============================================================

      case 'list_discovered_users': {
        const { domain_id } = payload;
        let q = adminClient
          .from('discovered_tenant_users')
          .select('id, domain_id, organization_id, ms_user_id, email, display_name, job_title, is_licensed, account_enabled, status, invited_user_id, invited_at, last_seen_at, updated_at')
          .order('display_name', { ascending: true });
        if (domain_id) q = q.eq('domain_id', domain_id);
        const { data, error } = await q;
        if (error) throw error;
        return new Response(JSON.stringify({ users: data || [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      case 'sync_discovered_users': {
        // Trigger the discover-tenant-users edge function. We just proxy the call so
        // the admin UI only has to know about /admin-api.
        const { domain_id } = payload;
        if (!domain_id) {
          return new Response(JSON.stringify({ error: 'domain_id is required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        const resp = await fetch(`${supabaseUrl}/functions/v1/discover-tenant-users`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': authHeader,
          },
          body: JSON.stringify({ domain_id }),
        });
        const body = await resp.json().catch(() => ({}));
        return new Response(JSON.stringify(body), {
          status: resp.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'invite_discovered_user': {
        // Sends a welcome email with a one-time SSO/magic-link invitation token.
        // Used when the discovered user is "discovered" (not yet active in InboxIQ).
        const { discovered_id, mode = 'sso_magic_link', group_id } = payload;
        if (!discovered_id) {
          return new Response(JSON.stringify({ error: 'discovered_id is required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const { data: discovered, error: dErr } = await adminClient
          .from('discovered_tenant_users')
          .select('id, domain_id, organization_id, email, display_name')
          .eq('id', discovered_id)
          .maybeSingle();
        if (dErr || !discovered) {
          return new Response(JSON.stringify({ error: 'Discovered user not found' }), {
            status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Resolve org name for the email greeting
        const { data: org } = await adminClient
          .from('organizations').select('name').eq('id', discovered.organization_id).maybeSingle();

        // Create invitation token
        const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
        const { data: invitation, error: iErr } = await adminClient
          .from('user_invitations')
          .insert({
            organization_id: discovered.organization_id,
            domain_id: discovered.domain_id,
            email: discovered.email,
            full_name: discovered.display_name,
            mode,
            token,
            invited_by: caller.id,
            group_id: group_id || null,
          })
          .select('id, token')
          .single();
        if (iErr) throw iErr;

        // Mark discovered user as invited
        await adminClient
          .from('discovered_tenant_users')
          .update({ status: 'invited', invited_at: new Date().toISOString() })
          .eq('id', discovered_id);

        // Build invitation URL — must match the Azure redirect URI we registered.
        // Sender = M365 tenant; we use send-transactional-email with the welcome-sso template.
        const appOrigin = req.headers.get('origin') || 'https://inboxiq.energyforward.com';
        const invitationUrl = `${appOrigin}/auth/accept-invitation?token=${invitation.token}`;

        try {
          const sendResp = await fetch(`${supabaseUrl}/functions/v1/send-transactional-email`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${serviceRoleKey}`,
            },
            body: JSON.stringify({
              templateName: mode === 'temp_password' ? 'welcome-temp-password' : 'welcome-sso',
              recipientEmail: discovered.email,
              idempotencyKey: `invite-${invitation.id}`,
              templateData: {
                fullName: discovered.display_name || '',
                invitationUrl,
                organizationName: org?.name || '',
              },
            }),
          });
          const sendBody = await sendResp.json().catch(() => ({}));
          if (!sendResp.ok) {
            console.error('Welcome email send failed', sendBody);
          }
        } catch (sendErr) {
          console.error('Welcome email send threw', sendErr);
        }

        return new Response(JSON.stringify({ success: true, invitation_id: invitation.id, invitation_url: invitationUrl }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      case 'resend_discovered_invitation': {
        // Same as invite, but always uses the latest unused invitation if one exists.
        const { discovered_id } = payload;
        if (!discovered_id) {
          return new Response(JSON.stringify({ error: 'discovered_id is required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        const { data: discovered } = await adminClient
          .from('discovered_tenant_users')
          .select('email, domain_id, organization_id, display_name')
          .eq('id', discovered_id).maybeSingle();
        if (!discovered) {
          return new Response(JSON.stringify({ error: 'Discovered user not found' }), {
            status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        const { data: existing } = await adminClient
          .from('user_invitations')
          .select('id, token, expires_at, used_at')
          .eq('email', discovered.email)
          .is('used_at', null)
          .gt('expires_at', new Date().toISOString())
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        let invitation = existing;
        if (!invitation) {
          const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
          const { data: created, error: iErr } = await adminClient
            .from('user_invitations')
            .insert({
              organization_id: discovered.organization_id,
              domain_id: discovered.domain_id,
              email: discovered.email,
              full_name: discovered.display_name,
              mode: 'sso_magic_link',
              token,
              invited_by: caller.id,
            })
            .select('id, token, expires_at, used_at')
            .single();
          if (iErr) throw iErr;
          invitation = created;
        }

        const { data: org } = await adminClient
          .from('organizations').select('name').eq('id', discovered.organization_id).maybeSingle();

        const appOrigin = req.headers.get('origin') || 'https://inboxiq.energyforward.com';
        const invitationUrl = `${appOrigin}/auth/accept-invitation?token=${invitation.token}`;

        await fetch(`${supabaseUrl}/functions/v1/send-transactional-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({
            templateName: 'welcome-sso',
            recipientEmail: discovered.email,
            idempotencyKey: `resend-${invitation.id}-${Date.now()}`,
            templateData: {
              fullName: discovered.display_name || '',
              invitationUrl,
              organizationName: org?.name || '',
            },
          }),
        }).catch((e) => console.error('Resend email failed', e));

        await adminClient
          .from('discovered_tenant_users')
          .update({ status: 'invited', invited_at: new Date().toISOString() })
          .eq('id', discovered_id);

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      case 'enable_discovered_user': {
        // Ensures an auth user + profile exists immediately (no email sent).
        // Useful when the admin wants to provision the account but invite later.
        const { discovered_id } = payload;
        if (!discovered_id) {
          return new Response(JSON.stringify({ error: 'discovered_id is required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        const { data: discovered } = await adminClient
          .from('discovered_tenant_users')
          .select('id, email, display_name, domain_id, organization_id')
          .eq('id', discovered_id).maybeSingle();
        if (!discovered) {
          return new Response(JSON.stringify({ error: 'Discovered user not found' }), {
            status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Find or create auth user
        const { data: existingUsers } = await adminClient.auth.admin.listUsers();
        let authUser = existingUsers?.users?.find((u) => u.email?.toLowerCase() === discovered.email.toLowerCase());

        if (!authUser) {
          const tempPassword = crypto.randomUUID() + '!Aa1';
          const { data: created, error: cErr } = await adminClient.auth.admin.createUser({
            email: discovered.email,
            password: tempPassword,
            email_confirm: true,
            user_metadata: {
              full_name: discovered.display_name,
              auto_connect_microsoft: true,
              domain_id: discovered.domain_id,
            },
          });
          if (cErr || !created?.user) throw new Error(cErr?.message || 'Failed to create auth user');
          authUser = created.user;
        }

        // Profile + membership
        const { data: existingProfile } = await adminClient
          .from('user_profiles').select('id').eq('user_id', authUser.id).maybeSingle();
        if (!existingProfile) {
          await adminClient.from('user_profiles').insert({
            user_id: authUser.id,
            email: discovered.email,
            full_name: discovered.display_name,
            organization_id: discovered.organization_id,
            domain_id: discovered.domain_id,
            microsoft_auto_connect: true,
            requires_outlook_connect: true,
          });
          await adminClient.from('organization_members').insert({
            user_id: authUser.id, organization_id: discovered.organization_id, role: 'member',
          });
          await adminClient.from('user_roles').insert({
            user_id: authUser.id, organization_id: discovered.organization_id, role: 'member',
          });
        }

        await adminClient
          .from('discovered_tenant_users')
          .update({ status: 'active', invited_user_id: authUser.id })
          .eq('id', discovered_id);

        return new Response(JSON.stringify({ success: true, user_id: authUser.id }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      case 'check_azure_permissions': {
        // Best-effort self-check: tries to obtain a Graph app-only token for each
        // domain that has a tenant id, and probes /users with $top=1 to confirm
        // User.Read.All has been consented.
        const { data: doms } = await adminClient
          .from('allowed_domains')
          .select('id, domain, microsoft_tenant_id, microsoft_consent_granted')
          .eq('is_active', true);

        const clientId = Deno.env.get('MICROSOFT_CLIENT_ID');
        const clientSecret = Deno.env.get('MICROSOFT_CLIENT_SECRET');
        const credentialsConfigured = Boolean(clientId && clientSecret);

        const results: any[] = [];
        for (const d of doms || []) {
          if (!d.microsoft_tenant_id) {
            results.push({ domain: d.domain, status: 'no_tenant_id', message: 'Tenant ID not set' });
            continue;
          }
          if (!credentialsConfigured) {
            results.push({ domain: d.domain, status: 'no_credentials', message: 'Azure client credentials not configured' });
            continue;
          }
          try {
            const tokenResp = await fetch(`https://login.microsoftonline.com/${d.microsoft_tenant_id}/oauth2/v2.0/token`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                client_id: clientId!,
                client_secret: clientSecret!,
                grant_type: 'client_credentials',
                scope: 'https://graph.microsoft.com/.default',
              }),
            });
            if (!tokenResp.ok) {
              const errBody = await tokenResp.text();
              let msg = `Token request failed (${tokenResp.status})`;
              try {
                const parsed = JSON.parse(errBody);
                if (parsed.error_description) msg = parsed.error_description.split('.')[0];
              } catch { /* */ }
              results.push({ domain: d.domain, status: 'token_failed', message: msg });
              continue;
            }
            const { access_token } = await tokenResp.json();
            const probe = await fetch('https://graph.microsoft.com/v1.0/users?$top=1&$select=id', {
              headers: { Authorization: `Bearer ${access_token}` },
            });
            if (probe.ok) {
              results.push({ domain: d.domain, status: 'ok', message: 'All required permissions verified' });
            } else {
              const errBody = await probe.text();
              let msg = `Graph call failed (${probe.status})`;
              try {
                const parsed = JSON.parse(errBody);
                if (parsed?.error?.code === 'Authorization_RequestDenied') {
                  msg = 'Missing User.Read.All application permission or admin consent not granted';
                } else if (parsed?.error?.message) {
                  msg = parsed.error.message;
                }
              } catch { /* */ }
              results.push({ domain: d.domain, status: 'permission_missing', message: msg });
            }
          } catch (e) {
            results.push({ domain: d.domain, status: 'error', message: e instanceof Error ? e.message : String(e) });
          }
        }

        return new Response(JSON.stringify({ results, credentials_configured: credentialsConfigured }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
  } catch (error: unknown) {
    console.error('Admin API error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
