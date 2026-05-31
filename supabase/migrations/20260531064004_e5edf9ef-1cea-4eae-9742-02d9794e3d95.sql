REVOKE EXECUTE ON FUNCTION public.admin_visible_user_ids(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_activity_report(timestamptz, timestamptz, text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_activity_timeseries(timestamptz, timestamptz, text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_visible_departments() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_list_org_users(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_org_admin(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_dept_admin(uuid, uuid, text) FROM PUBLIC, anon;