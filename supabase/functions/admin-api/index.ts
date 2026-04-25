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
    const { data: { user: caller }, error: authError } = await adminClient.auth.getUser(token);
    if (authError || !caller?.email) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Only super admin can use this
    if (caller.email.toLowerCase() !== 'arahimi@energyforward.com') {
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
          .select('id, user_id, email, full_name, title, organization_id, created_at')
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

      case 'create_user': {
        const { email, password, full_name, group_ids } = payload;
        if (!email || !password || !full_name) {
          return new Response(JSON.stringify({ error: 'email, password, and full_name are required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        const result = await createSingleUser(adminClient, { email, password, full_name, group_ids });
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
        const { users } = payload as { users: Array<{ email: string; password: string; full_name: string; group_ids?: string[] }> };
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
          .select('id, name, description, organization_id, created_at')
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
        const { name, description, organization_id } = payload;
        if (!name || !organization_id) {
          return new Response(JSON.stringify({ error: 'name and organization_id are required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        const { data, error } = await adminClient
          .from('permission_groups')
          .insert({ name: name.trim(), description: description?.trim() || null, organization_id, created_by: caller.id })
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
