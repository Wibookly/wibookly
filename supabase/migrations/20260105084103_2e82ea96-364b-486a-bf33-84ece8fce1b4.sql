-- Add connection_id to ai_activity_logs for per-email filtering
ALTER TABLE public.ai_activity_logs 
ADD COLUMN connection_id UUID REFERENCES public.provider_connections(id) ON DELETE SET NULL;

-- Create index for faster queries by connection
CREATE INDEX idx_ai_activity_logs_connection_id ON public.ai_activity_logs(connection_id);

-- Update RLS policy to include connection_id check (optional, keeps existing org-level policy)
-- The existing policy already restricts by organization_id which is sufficient