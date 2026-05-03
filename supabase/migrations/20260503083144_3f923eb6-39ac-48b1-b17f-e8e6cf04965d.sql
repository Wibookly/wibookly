
REVOKE EXECUTE ON FUNCTION public.enforce_llm_limits(uuid, uuid, text, numeric, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.record_llm_spend(uuid, uuid, uuid, text, text, text, integer, integer, numeric, jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.enforce_llm_limits(uuid, uuid, text, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_llm_spend(uuid, uuid, uuid, text, text, text, integer, integer, numeric, jsonb) TO service_role;
