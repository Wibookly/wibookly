-- Create table to track processed emails for AI drafting
-- This prevents creating duplicate drafts for the same email
CREATE TABLE public.processed_emails (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  email_id TEXT NOT NULL, -- Gmail message ID or Outlook message ID
  category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, -- 'google' or 'microsoft'
  action_type TEXT NOT NULL, -- 'draft' or 'auto_reply'
  draft_id TEXT, -- ID of the created draft in Gmail/Outlook
  sent_at TIMESTAMPTZ, -- When auto-reply was sent (null for drafts)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Unique constraint to prevent duplicate processing
  CONSTRAINT unique_email_processing UNIQUE (user_id, email_id, category_id, action_type)
);

-- Create indexes for efficient lookups
CREATE INDEX idx_processed_emails_user_category ON public.processed_emails(user_id, category_id);
CREATE INDEX idx_processed_emails_email_id ON public.processed_emails(email_id);
CREATE INDEX idx_processed_emails_created_at ON public.processed_emails(created_at DESC);

-- Enable RLS
ALTER TABLE public.processed_emails ENABLE ROW LEVEL SECURITY;

-- Users can only see their own processed emails
CREATE POLICY "Users can view their own processed emails"
ON public.processed_emails
FOR SELECT
USING (auth.uid() = user_id);

-- Only service role can insert/update (edge functions handle this)
CREATE POLICY "Service role can manage processed emails"
ON public.processed_emails
FOR ALL
USING (true)
WITH CHECK (true);

-- Grant access
ALTER TABLE public.processed_emails FORCE ROW LEVEL SECURITY;