
-- 1. Extend app_role enum with super_admin, org_admin, dept_admin
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'super_admin';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'org_admin';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'dept_admin';

-- 2. user_roles: allow scoping a dept_admin to specific departments
ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS departments text[] NOT NULL DEFAULT ARRAY[]::text[];

-- 3. user_profiles: keep M365-sourced job title separate from user-edited title
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS job_title_m365 text,
  ADD COLUMN IF NOT EXISTS department_source text;
  -- department_source: 'm365' | 'manual' | NULL

-- 4. discovered_tenant_users: store department + office from Graph
ALTER TABLE public.discovered_tenant_users
  ADD COLUMN IF NOT EXISTS department text,
  ADD COLUMN IF NOT EXISTS office_location text;

-- 5. Helper RPCs (text-cast role to avoid enum-in-same-tx limitation)

CREATE OR REPLACE FUNCTION public.is_org_admin(_user_id uuid, _organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND organization_id = _organization_id
      AND role::text IN ('admin','org_admin','super_admin')
  )
  OR public.is_super_admin(
    (SELECT email FROM public.user_profiles WHERE user_id = _user_id LIMIT 1)
  );
$$;

CREATE OR REPLACE FUNCTION public.is_dept_admin(_user_id uuid, _organization_id uuid, _department text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND organization_id = _organization_id
      AND role::text = 'dept_admin'
      AND _department = ANY(departments)
  )
  OR public.is_org_admin(_user_id, _organization_id);
$$;

-- Set of user_ids the caller may report on.
-- super_admin → all users
-- org_admin   → all users in their org(s)
-- dept_admin  → only users in their assigned departments within their org(s)
-- otherwise   → just themselves
CREATE OR REPLACE FUNCTION public.admin_visible_user_ids(_caller uuid)
RETURNS TABLE(user_id uuid, organization_id uuid, department text, email text, full_name text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH caller_email AS (
    SELECT email FROM public.user_profiles WHERE user_id = _caller LIMIT 1
  ),
  is_super AS (
    SELECT public.is_super_admin(COALESCE((SELECT email FROM caller_email), '')) AS v
  ),
  org_admin_orgs AS (
    SELECT organization_id FROM public.user_roles
    WHERE user_id = _caller AND role::text IN ('admin','org_admin','super_admin')
  ),
  dept_admin_scopes AS (
    SELECT organization_id, unnest(departments) AS dept
    FROM public.user_roles
    WHERE user_id = _caller AND role::text = 'dept_admin'
  )
  SELECT up.user_id, up.organization_id, up.department, up.email, up.full_name
  FROM public.user_profiles up
  WHERE
    (SELECT v FROM is_super) = true
    OR up.organization_id IN (SELECT organization_id FROM org_admin_orgs)
    OR EXISTS (
      SELECT 1 FROM dept_admin_scopes d
      WHERE d.organization_id = up.organization_id
        AND lower(coalesce(up.department,'')) = lower(coalesce(d.dept,''))
    )
    OR up.user_id = _caller;
$$;

-- 6. Activity reporting RPCs

-- Per-user aggregated activity within a window, scoped to caller's visibility.
CREATE OR REPLACE FUNCTION public.admin_activity_report(
  _start timestamptz,
  _end   timestamptz,
  _department text DEFAULT NULL,
  _user_id uuid DEFAULT NULL
)
RETURNS TABLE(
  user_id uuid,
  email text,
  full_name text,
  department text,
  total_actions bigint,
  ai_drafts bigint,
  auto_replies bigint,
  chats bigint,
  daily_briefs bigint,
  email_agent bigint,
  meeting_copilot bigint,
  follow_up bigint,
  tokens_in bigint,
  tokens_out bigint,
  cost_usd numeric,
  last_active timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH scope AS (
    SELECT * FROM public.admin_visible_user_ids(auth.uid())
  )
  SELECT
    s.user_id,
    s.email,
    s.full_name,
    s.department,
    COUNT(l.id)::bigint AS total_actions,
    COUNT(*) FILTER (WHERE l.action = 'ai_draft')::bigint,
    COUNT(*) FILTER (WHERE l.action = 'ai_auto_reply')::bigint,
    COUNT(*) FILTER (WHERE l.action = 'ai_chat')::bigint,
    COUNT(*) FILTER (WHERE l.action = 'daily_brief')::bigint,
    COUNT(*) FILTER (WHERE l.action = 'email_agent')::bigint,
    COUNT(*) FILTER (WHERE l.action IN ('meeting_copilot','meeting_copilot_prep','meeting_copilot_summary'))::bigint,
    COUNT(*) FILTER (WHERE l.action = 'follow_up_reminder')::bigint,
    COALESCE(SUM(l.prompt_tokens),0)::bigint,
    COALESCE(SUM(l.completion_tokens),0)::bigint,
    COALESCE(SUM(l.cost_usd),0)::numeric,
    MAX(l.created_at)
  FROM scope s
  LEFT JOIN public.ai_usage_logs l
    ON l.user_id = s.user_id
   AND l.created_at >= _start
   AND l.created_at <  _end
  WHERE (_department IS NULL OR lower(coalesce(s.department,'')) = lower(_department))
    AND (_user_id IS NULL OR s.user_id = _user_id)
  GROUP BY s.user_id, s.email, s.full_name, s.department
  ORDER BY total_actions DESC;
$$;

-- Daily activity time series scoped to caller, grouped by action.
CREATE OR REPLACE FUNCTION public.admin_activity_timeseries(
  _start timestamptz,
  _end   timestamptz,
  _department text DEFAULT NULL,
  _user_id uuid DEFAULT NULL
)
RETURNS TABLE(
  day date,
  action text,
  events bigint,
  cost_usd numeric
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH scope AS (
    SELECT user_id, department FROM public.admin_visible_user_ids(auth.uid())
  ),
  filtered AS (
    SELECT s.user_id
    FROM scope s
    WHERE (_department IS NULL OR lower(coalesce(s.department,'')) = lower(_department))
      AND (_user_id IS NULL OR s.user_id = _user_id)
  )
  SELECT
    (l.created_at AT TIME ZONE 'UTC')::date AS day,
    l.action,
    COUNT(*)::bigint,
    COALESCE(SUM(l.cost_usd),0)::numeric
  FROM public.ai_usage_logs l
  WHERE l.user_id IN (SELECT user_id FROM filtered)
    AND l.created_at >= _start
    AND l.created_at <  _end
  GROUP BY 1, 2
  ORDER BY 1, 2;
$$;

-- List distinct departments visible to caller (for filter dropdowns).
CREATE OR REPLACE FUNCTION public.admin_visible_departments()
RETURNS TABLE(department text, user_count bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(NULLIF(trim(department),''), '(Unassigned)') AS department,
    COUNT(*)::bigint
  FROM public.admin_visible_user_ids(auth.uid())
  GROUP BY 1
  ORDER BY 1;
$$;

-- Roles management RPC: list assignable users (callable by org_admin / super_admin).
CREATE OR REPLACE FUNCTION public.admin_list_org_users(_organization_id uuid)
RETURNS TABLE(
  user_id uuid,
  email text,
  full_name text,
  department text,
  roles text[],
  departments_admin text[]
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    up.user_id,
    up.email,
    up.full_name,
    up.department,
    COALESCE(
      (SELECT array_agg(DISTINCT ur.role::text)
       FROM public.user_roles ur
       WHERE ur.user_id = up.user_id AND ur.organization_id = _organization_id),
      ARRAY[]::text[]
    ) AS roles,
    COALESCE(
      (SELECT array_agg(DISTINCT d)
       FROM public.user_roles ur, unnest(ur.departments) d
       WHERE ur.user_id = up.user_id
         AND ur.organization_id = _organization_id
         AND ur.role::text = 'dept_admin'),
      ARRAY[]::text[]
    ) AS departments_admin
  FROM public.user_profiles up
  WHERE up.organization_id = _organization_id
    AND public.is_org_admin(auth.uid(), _organization_id)
  ORDER BY up.full_name NULLS LAST, up.email;
$$;

-- Grants
GRANT EXECUTE ON FUNCTION public.is_org_admin(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_dept_admin(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_visible_user_ids(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_activity_report(timestamptz, timestamptz, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_activity_timeseries(timestamptz, timestamptz, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_visible_departments() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_org_users(uuid) TO authenticated;
