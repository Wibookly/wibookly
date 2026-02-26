import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

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

        // Get auth user metadata (disabled status)
        const { data: { users: authUsers } } = await adminClient.auth.admin.listUsers();

        const enrichedProfiles = (profiles || []).map((p: any) => {
          const authUser = authUsers?.find((u: any) => u.id === p.user_id);
          const userFeatures = (features || []).filter((f: any) => f.user_id === p.user_id);
          return {
            ...p,
            is_disabled: authUser?.banned_until ? new Date(authUser.banned_until) > new Date() : false,
            features: userFeatures,
          };
        });

        return new Response(JSON.stringify({ users: enrichedProfiles }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      case 'create_user': {
        const { email, password, full_name } = payload;
        if (!email || !password || !full_name) {
          return new Response(JSON.stringify({ error: 'email, password, and full_name are required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Validate domain
        const domain = email.split('@')[1]?.toLowerCase();
        const { data: domainData } = await adminClient
          .from('allowed_domains')
          .select('id, organization_name')
          .eq('domain', domain)
          .eq('is_active', true)
          .maybeSingle();

        if (!domainData) {
          return new Response(JSON.stringify({ error: `Domain ${domain} is not authorized. Add it first.` }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Create auth user with email confirmed
        const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name },
        });

        if (createError) throw createError;

        // Create organization for the user
        const orgName = domainData.organization_name || `${domain} Organization`;
        const { data: org, error: orgError } = await adminClient
          .from('organizations')
          .insert({ name: orgName })
          .select()
          .single();

        // Use service role to bypass RLS for setup
        if (org) {
          // Create user profile
          await adminClient.from('user_profiles').insert({
            user_id: newUser.user.id,
            email,
            full_name,
            organization_id: org.id,
          });

          // Create org membership
          await adminClient.from('organization_members').insert({
            user_id: newUser.user.id,
            organization_id: org.id,
            role: 'member',
          });

          // Create user role
          await adminClient.from('user_roles').insert({
            user_id: newUser.user.id,
            organization_id: org.id,
            role: 'member',
          });
        }

        return new Response(JSON.stringify({ success: true, user_id: newUser.user.id }), {
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

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
  } catch (error: unknown) {
    console.error('Admin API error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
