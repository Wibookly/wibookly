
-- Per-org daily budget + concurrency limits
CREATE TABLE IF NOT EXISTS public.org_agent_budget (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  daily_usd_cap numeric(10,2) NOT NULL DEFAULT 25.00,
  max_concurrent_runs int NOT NULL DEFAULT 5,
  current_day date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  spent_today_usd numeric(10,4) NOT NULL DEFAULT 0,
  paused boolean NOT NULL DEFAULT false,
  paused_reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.org_agent_budget ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins view org budget" ON public.org_agent_budget
  FOR SELECT USING (
    organization_id = public.get_user_organization_id(auth.uid())
    AND public.has_role_in_org(auth.uid(), 'admin'::app_role, organization_id)
  );

CREATE POLICY "admins update org budget" ON public.org_agent_budget
  FOR UPDATE USING (
    organization_id = public.get_user_organization_id(auth.uid())
    AND public.has_role_in_org(auth.uid(), 'admin'::app_role, organization_id)
  );

CREATE POLICY "service role manages budget" ON public.org_agent_budget
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Short prompt cache (5-min dedup of identical asks)
CREATE TABLE IF NOT EXISTS public.agent_response_cache (
  prompt_hash text PRIMARY KEY,
  organization_id uuid NOT NULL,
  reply_html text NOT NULL,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  provider text,
  model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes')
);
CREATE INDEX IF NOT EXISTS idx_agent_cache_expires ON public.agent_response_cache(expires_at);

ALTER TABLE public.agent_response_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role manages cache" ON public.agent_response_cache
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Concurrency: try to grab a per-conversation advisory lock (non-blocking)
CREATE OR REPLACE FUNCTION public.try_acquire_conversation_lock(_conversation_id text)
RETURNS boolean LANGUAGE sql AS $$
  SELECT pg_try_advisory_xact_lock(hashtextextended(COALESCE(_conversation_id,''), 0));
$$;

-- Budget: reset daily, check cap, and reserve. Returns true if allowed.
CREATE OR REPLACE FUNCTION public.check_and_reserve_budget(_org_id uuid, _est_cost_usd numeric DEFAULT 0.05)
RETURNS TABLE(allowed boolean, reason text, spent numeric, cap numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _row public.org_agent_budget;
  _today date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  INSERT INTO public.org_agent_budget(organization_id) VALUES (_org_id)
    ON CONFLICT (organization_id) DO NOTHING;

  SELECT * INTO _row FROM public.org_agent_budget WHERE organization_id = _org_id FOR UPDATE;

  IF _row.current_day <> _today THEN
    UPDATE public.org_agent_budget
       SET current_day = _today, spent_today_usd = 0, updated_at = now()
     WHERE organization_id = _org_id
     RETURNING * INTO _row;
  END IF;

  IF _row.paused THEN
    RETURN QUERY SELECT false, COALESCE(_row.paused_reason,'paused_by_admin'), _row.spent_today_usd, _row.daily_usd_cap;
    RETURN;
  END IF;

  IF (_row.spent_today_usd + _est_cost_usd) > _row.daily_usd_cap THEN
    RETURN QUERY SELECT false, 'daily_budget_exceeded', _row.spent_today_usd, _row.daily_usd_cap;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, 'ok'::text, _row.spent_today_usd, _row.daily_usd_cap;
END;
$$;

-- Record actual spend after run
CREATE OR REPLACE FUNCTION public.record_agent_spend(_org_id uuid, _cost_usd numeric)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.org_agent_budget
     SET spent_today_usd = spent_today_usd + COALESCE(_cost_usd,0),
         updated_at = now()
   WHERE organization_id = _org_id;
$$;

-- Cache helpers
CREATE OR REPLACE FUNCTION public.cache_get_response(_hash text)
RETURNS TABLE(reply_html text, attachments jsonb, provider text, model text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT reply_html, attachments, provider, model
  FROM public.agent_response_cache
  WHERE prompt_hash = _hash AND expires_at > now()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.cache_put_response(
  _hash text, _org_id uuid, _reply_html text, _attachments jsonb, _provider text, _model text
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.agent_response_cache(prompt_hash, organization_id, reply_html, attachments, provider, model, expires_at)
  VALUES (_hash, _org_id, _reply_html, _attachments, _provider, _model, now() + interval '5 minutes')
  ON CONFLICT (prompt_hash) DO UPDATE
    SET reply_html = EXCLUDED.reply_html,
        attachments = EXCLUDED.attachments,
        provider = EXCLUDED.provider,
        model = EXCLUDED.model,
        expires_at = EXCLUDED.expires_at;
  DELETE FROM public.agent_response_cache WHERE expires_at < now() - interval '1 hour';
$$;
