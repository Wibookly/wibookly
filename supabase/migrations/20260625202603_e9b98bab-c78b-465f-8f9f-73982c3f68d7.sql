
-- =========================================================================
-- Phase 1: Organizations foundation + backfill
-- Canonical org (has all existing data): 0a91e605-1324-40dd-bdb5-ffa1b39bda44
-- =========================================================================

-- 1. Enums ----------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.org_environment_type AS ENUM ('microsoft','google','none');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.org_status AS ENUM ('active','suspended');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Extend organizations -------------------------------------------------
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS legal_name       text,
  ADD COLUMN IF NOT EXISTS address_street   text,
  ADD COLUMN IF NOT EXISTS address_city     text,
  ADD COLUMN IF NOT EXISTS address_state    text,
  ADD COLUMN IF NOT EXISTS address_zip      text,
  ADD COLUMN IF NOT EXISTS address_country  text,
  ADD COLUMN IF NOT EXISTS phone            text,
  ADD COLUMN IF NOT EXISTS contact_email    text,
  ADD COLUMN IF NOT EXISTS environment_type public.org_environment_type NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS plan_id          uuid,  -- FK deferred to Phase 6 (no plans table yet)
  ADD COLUMN IF NOT EXISTS status           public.org_status NOT NULL DEFAULT 'active';

-- 3. Designate Organization 1 (canonical org with all data) ---------------
UPDATE public.organizations
   SET name           = 'Energyforward',
       legal_name     = COALESCE(legal_name, 'Energy Forward AI'),
       contact_email  = COALESCE(contact_email, 'arahimi@energyforward.com'),
       environment_type = 'microsoft',
       status         = 'active',
       updated_at     = now()
 WHERE id = '0a91e605-1324-40dd-bdb5-ffa1b39bda44';

-- 4. Add organization_id (nullable) to 21 tenant-scoped tables ------------
ALTER TABLE public.ai_chat_messages            ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.chat_messages               ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.daily_brief_tasks           ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.extraction_regression_log   ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.graph_health                ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.m365_api_health             ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.m365_sync_jobs              ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.m365_sync_state             ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.meeting_action_items        ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.meeting_copilot_preferences ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.meeting_copilot_settings    ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.meeting_sessions            ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.meeting_suggestions         ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.meeting_transcripts         ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.oauth_token_vault           ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.email_send_log              ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.email_send_state            ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.email_unsubscribe_tokens    ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.tool_diagnostics            ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.user_ai_profiles            ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.user_client_status          ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);

-- 5. Backfill organization_id (single-tenant: all rows belong to Org 1) ---
DO $$
DECLARE
  org1 uuid := '0a91e605-1324-40dd-bdb5-ffa1b39bda44';
BEGIN
  UPDATE public.ai_chat_messages            SET organization_id = org1 WHERE organization_id IS NULL;
  UPDATE public.chat_messages               SET organization_id = org1 WHERE organization_id IS NULL;
  UPDATE public.daily_brief_tasks           SET organization_id = org1 WHERE organization_id IS NULL;
  UPDATE public.extraction_regression_log   SET organization_id = org1 WHERE organization_id IS NULL;
  UPDATE public.graph_health                SET organization_id = org1 WHERE organization_id IS NULL;
  UPDATE public.m365_api_health             SET organization_id = org1 WHERE organization_id IS NULL;
  UPDATE public.m365_sync_jobs              SET organization_id = org1 WHERE organization_id IS NULL;
  UPDATE public.m365_sync_state             SET organization_id = org1 WHERE organization_id IS NULL;
  UPDATE public.meeting_action_items        SET organization_id = org1 WHERE organization_id IS NULL;
  UPDATE public.meeting_copilot_preferences SET organization_id = org1 WHERE organization_id IS NULL;
  UPDATE public.meeting_copilot_settings    SET organization_id = org1 WHERE organization_id IS NULL;
  UPDATE public.meeting_sessions            SET organization_id = org1 WHERE organization_id IS NULL;
  UPDATE public.meeting_suggestions         SET organization_id = org1 WHERE organization_id IS NULL;
  UPDATE public.meeting_transcripts         SET organization_id = org1 WHERE organization_id IS NULL;
  UPDATE public.oauth_token_vault           SET organization_id = org1 WHERE organization_id IS NULL;
  UPDATE public.email_send_log              SET organization_id = org1 WHERE organization_id IS NULL;
  UPDATE public.email_send_state            SET organization_id = org1 WHERE organization_id IS NULL;
  UPDATE public.email_unsubscribe_tokens    SET organization_id = org1 WHERE organization_id IS NULL;
  UPDATE public.tool_diagnostics            SET organization_id = org1 WHERE organization_id IS NULL;
  UPDATE public.user_ai_profiles            SET organization_id = org1 WHERE organization_id IS NULL;
  UPDATE public.user_client_status          SET organization_id = org1 WHERE organization_id IS NULL;
END $$;

-- 6. Enforce NOT NULL now that every row has a value ----------------------
ALTER TABLE public.ai_chat_messages            ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.chat_messages               ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.daily_brief_tasks           ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.extraction_regression_log   ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.graph_health                ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.m365_api_health             ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.m365_sync_jobs              ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.m365_sync_state             ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.meeting_action_items        ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.meeting_copilot_settings    ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.meeting_sessions            ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.meeting_suggestions         ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.oauth_token_vault           ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.email_send_log              ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.email_send_state            ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.email_unsubscribe_tokens    ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.tool_diagnostics            ALTER COLUMN organization_id SET NOT NULL;
-- Leave nullable (currently empty — no data to validate NOT NULL against safely):
--   meeting_copilot_preferences, meeting_transcripts, user_ai_profiles, user_client_status

-- 7. Helpful indexes ------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_org            ON public.ai_chat_messages(organization_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_org               ON public.chat_messages(organization_id);
CREATE INDEX IF NOT EXISTS idx_daily_brief_tasks_org           ON public.daily_brief_tasks(organization_id);
CREATE INDEX IF NOT EXISTS idx_meeting_sessions_org            ON public.meeting_sessions(organization_id);
CREATE INDEX IF NOT EXISTS idx_meeting_suggestions_org         ON public.meeting_suggestions(organization_id);
CREATE INDEX IF NOT EXISTS idx_oauth_token_vault_org           ON public.oauth_token_vault(organization_id);
CREATE INDEX IF NOT EXISTS idx_m365_api_health_org             ON public.m365_api_health(organization_id);
CREATE INDEX IF NOT EXISTS idx_m365_sync_jobs_org              ON public.m365_sync_jobs(organization_id);
