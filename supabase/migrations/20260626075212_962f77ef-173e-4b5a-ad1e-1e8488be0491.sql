
-- Phase 6: expand activity log enum & subscription metadata
ALTER TYPE public.helm_action_type ADD VALUE IF NOT EXISTS 'subscription_renewed';
ALTER TYPE public.helm_action_type ADD VALUE IF NOT EXISTS 'subscription_created';
ALTER TYPE public.helm_action_type ADD VALUE IF NOT EXISTS 'item_completed';
ALTER TYPE public.helm_action_type ADD VALUE IF NOT EXISTS 'section_emailed';
ALTER TYPE public.helm_action_type ADD VALUE IF NOT EXISTS 'big3_set';
ALTER TYPE public.helm_action_type ADD VALUE IF NOT EXISTS 'focus_block_created';
ALTER TYPE public.helm_action_type ADD VALUE IF NOT EXISTS 'morning_prep';

ALTER TABLE public.helm_subscriptions
  ADD COLUMN IF NOT EXISTS client_state text,
  ADD COLUMN IF NOT EXISTS change_type text DEFAULT 'created,updated',
  ADD COLUMN IF NOT EXISTS notification_url text,
  ADD COLUMN IF NOT EXISTS connection_id uuid REFERENCES public.provider_connections(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS helm_subscriptions_expiry_idx ON public.helm_subscriptions (expires_at);
CREATE INDEX IF NOT EXISTS activity_log_user_created_idx ON public.activity_log (user_id, created_at DESC);
