-- Add unique constraint on user_id and provider for upsert to work
ALTER TABLE public.provider_connections
ADD CONSTRAINT provider_connections_user_provider_unique 
UNIQUE (user_id, provider);