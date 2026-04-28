
-- Add helpers for the feature.follow_up_reminder permission lifecycle.
-- Pauses pending trackers for users in a group when the permission is disabled,
-- and resumes them when the permission is re-enabled.

CREATE OR REPLACE FUNCTION public.count_followup_impact(_group_id uuid)
RETURNS TABLE(affected_users integer, pending_reminders integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH members AS (
    SELECT DISTINCT user_id
    FROM public.user_group_memberships
    WHERE group_id = _group_id
  ),
  -- Users in this group who would lose access only if NO other group still grants the feature
  losing_users AS (
    SELECT m.user_id
    FROM members m
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.user_group_memberships ugm
      JOIN public.group_features gf
        ON gf.group_id = ugm.group_id
       AND gf.feature_key = 'feature.follow_up_reminder'
       AND gf.is_enabled = true
      WHERE ugm.user_id = m.user_id
        AND ugm.group_id <> _group_id
    )
  )
  SELECT
    (SELECT COUNT(*)::int FROM losing_users),
    COALESCE((
      SELECT COUNT(*)::int
      FROM public.follow_up_trackers t
      WHERE t.user_id IN (SELECT user_id FROM losing_users)
        AND t.status = 'pending'
    ), 0);
$$;

CREATE OR REPLACE FUNCTION public.pause_followups_without_permission()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _count integer := 0;
BEGIN
  WITH losers AS (
    SELECT t.id
    FROM public.follow_up_trackers t
    WHERE t.status = 'pending'
      AND NOT public.has_feature(t.user_id, 'feature.follow_up_reminder')
  )
  UPDATE public.follow_up_trackers
  SET status = 'paused_no_permission',
      updated_at = now()
  WHERE id IN (SELECT id FROM losers);
  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END;
$$;

CREATE OR REPLACE FUNCTION public.resume_followups_with_permission()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _count integer := 0;
BEGIN
  WITH winners AS (
    SELECT t.id
    FROM public.follow_up_trackers t
    WHERE t.status = 'paused_no_permission'
      AND public.has_feature(t.user_id, 'feature.follow_up_reminder')
  )
  UPDATE public.follow_up_trackers
  SET status = 'pending',
      updated_at = now()
  WHERE id IN (SELECT id FROM winners);
  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END;
$$;
